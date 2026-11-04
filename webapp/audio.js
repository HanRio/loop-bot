// 재생 한 곳. <audio> 하나를 계속 쓰고 src만 바꾼다. 화면이 꺼진 상태에서도 다음 곡으로 넘어가야 하기 때문이다.

export const CACHE_NAME = 'loopbot-tracks';
// 금방 끝나는 받기(캐시된 곡)는 표시하지 않아 깜빡이지 않게 한다.
const LOADING_DELAY_MS = 200;
const cacheKey = (id) => `track-${id}`;

async function openCache() {
  try {
    return 'caches' in window ? await caches.open(CACHE_NAME) : null;
  } catch {
    // 캐시를 쓸 수 없으면 캐시 없이 재생한다.
    return null;
  }
}

async function readCached(cache, id) {
  try {
    return await cache.match(cacheKey(id));
  } catch {
    return undefined;
  }
}

export function createPlayer({
  api,
  onChange = () => {},
  onTrackEnd = () => {},
  onError = () => {},
  onSkip = () => {},
}) {
  const audio = new Audio();
  const session = 'mediaSession' in navigator ? navigator.mediaSession : null;
  // 곡을 누를 때마다 번호를 올린다. 받는 중에 다른 곡이 눌렸으면 옛 요청은 버린다.
  let token = 0;
  let blobUrl = null;
  let loading = false;
  let loadingTimer = null;

  function setLoading(value) {
    clearTimeout(loadingTimer);
    if (loading !== value) {
      loading = value;
      onChange();
    }
  }

  async function fetchBlob(id) {
    const cache = await openCache();
    const hit = cache && (await readCached(cache, id));
    if (hit) return hit.blob();
    const blob = await api.file(id);
    // 저장 공간이 모자라도 이 곡은 지금 재생한다. 다음에 다시 받을 뿐이다.
    if (cache) await cache.put(cacheKey(id), new Response(blob)).catch(() => {});
    return blob;
  }

  // 같은 곡을 동시에 달라고 하면 한 번만 받는다(미리 받기와 재생이 겹치는 경우). 끝나면 목록에서 뺀다.
  const downloads = new Map();
  function getBlob(id) {
    if (!downloads.has(id)) {
      const pending = fetchBlob(id);
      downloads.set(id, pending);
      const done = () => downloads.delete(id);
      pending.then(done, done);
    }
    return downloads.get(id);
  }

  function syncSession() {
    if (!session) return;
    const duration = audio.duration;
    session.playbackState = audio.paused ? 'paused' : 'playing';
    if (Number.isFinite(duration) && duration > 0) {
      session.setPositionState?.({
        duration,
        position: Math.min(audio.currentTime, duration),
        playbackRate: 1,
      });
    }
  }

  function notify() {
    syncSession();
    onChange();
  }

  // 막히면 멈춘 모양으로 다시 그린다. 호출한 쪽은 기다리지 않는다.
  function resume() {
    return audio.play().catch(() => notify());
  }

  if (session) {
    const actions = {
      play: () => resume(),
      pause: () => audio.pause(),
      previoustrack: () => onSkip('prev'),
      nexttrack: () => onSkip('next'),
      seekto: (details) => {
        if (details.seekTime != null) audio.currentTime = details.seekTime;
      },
    };
    for (const [action, handler] of Object.entries(actions)) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // 이 브라우저가 모르는 동작은 건너뛴다.
      }
    }
  }

  for (const type of ['play', 'pause', 'timeupdate', 'durationchange', 'loadedmetadata', 'seeked']) {
    audio.addEventListener(type, notify);
  }
  audio.addEventListener('ended', () => onTrackEnd());

  // true면 재생을 시작했거나 탭을 기다리는 중이다. false면 버렸거나 실패했다(실패는 onError로 알린다).
  async function play(track) {
    const mine = ++token;
    clearTimeout(loadingTimer);
    loadingTimer = setTimeout(() => setLoading(true), LOADING_DELAY_MS);
    let blob;
    try {
      blob = await getBlob(track.id);
    } catch (err) {
      if (mine === token) {
        setLoading(false);
        onError(err);
      }
      return false;
    }
    if (mine !== token) return false;
    setLoading(false);

    const previous = blobUrl;
    blobUrl = URL.createObjectURL(blob);
    audio.src = blobUrl;
    if (previous) URL.revokeObjectURL(previous);
    if (session && typeof MediaMetadata !== 'undefined') {
      session.metadata = new MediaMetadata({ title: track.title });
    }

    try {
      await audio.play();
      return true;
    } catch (err) {
      // 탭 없이 시작하면 막힌다. 오류가 아니라 멈춘 채로 둔다.
      if (err.name === 'NotAllowedError') return true;
      // 다른 곡으로 넘어가거나 멈추면서 끊긴 재생이다.
      if (err.name === 'AbortError') return mine === token;
      if (mine === token) onError(err);
      return false;
    }
  }

  // 미리 받기는 덤이다. 실패해도 조용히 넘기고, 실제로 틀 때 다시 받아 오류를 알린다.
  async function prefetch(trackId) {
    try {
      await getBlob(trackId);
    } catch {
      // 실제 재생 때 다시 받는다.
    }
  }

  // 지운 곡의 캐시만 치운다. 지금 재생 중인 Blob URL은 그대로 둔다.
  async function forget(trackId) {
    const cache = await openCache();
    await cache?.delete(cacheKey(trackId)).catch(() => {});
  }

  // 0..1로 자른다. 숫자가 아니면 무시한다.
  function setVolume(value) {
    if (!Number.isFinite(value)) return;
    audio.volume = Math.min(1, Math.max(0, value));
  }

  // iPhone/iPad는 <audio> 볼륨 쓰기를 무시한다. 잠깐 바꿔 보고 원래 값으로 되돌린다.
  function canSetVolume() {
    const before = audio.volume;
    audio.volume = 0.5;
    const works = Math.abs(audio.volume - 0.5) < 0.01;
    audio.volume = before;
    return works;
  }

  return {
    play,
    prefetch,
    forget,
    setVolume,
    volume: () => audio.volume,
    canSetVolume,
    // 받는 중인 곡이 있으면 버린다. 멈춘 뒤에 늦게 도착한 곡이 재생되지 않게 한다.
    cancel() {
      token += 1;
      setLoading(false);
    },
    toggle() {
      if (audio.paused) return resume();
      audio.pause();
      return undefined;
    },
    seek(sec) {
      audio.currentTime = sec;
    },
    position: () => audio.currentTime,
    duration: () => (Number.isFinite(audio.duration) ? audio.duration : 0),
    isPlaying: () => !audio.paused,
    isLoading: () => loading,
  };
}
