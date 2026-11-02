// 화면 상태와 재생 흐름. 그리기는 render.js, 네트워크는 api.js, 재생은 audio.js가 맡는다.
import { createApi } from './api.js';
import { createPlayer } from './audio.js';
import { nextTrack, prevTrack } from './queue.js';
import { createSaver } from './saver.js';
import { $, renderPicker, renderQueue, renderLibrary, renderBar, setNotice, setVisible } from './render.js';

const API_BASE = 'https://rrpmpqxoqxlwrmflpiyi.supabase.co/functions/v1/loopbot-api';
const IS_LOCAL = location.hostname === 'localhost';
const NEW_PLAYLIST = 'new';
const REPEAT_ORDER = ['all', 'one', 'off'];
const KEY_PLAYLIST = 'loopbot.player.playlist';
const KEY_REPEAT = 'loopbot.player.repeat';
const COPY = {
  openFromMenu: '메뉴 버튼으로 다시 열어주세요',
  reopen: '미니앱을 다시 열어주세요',
  loadFailed: '목록을 불러오지 못했어요',
  saveFailed: '저장하지 못했어요. 다시 시도할게요',
  trackFailed: '받지 못했어요',
  noPlayable: '재생할 곡이 없어요',
  playlistName: '플레이리스트 이름',
  deletePlaylistConfirm: '이 플레이리스트를 지울까요?',
  deleteTrackConfirm: '라이브러리에서 지울까요? 모든 플레이리스트에서 빠져요',
};

const tg = window.Telegram?.WebApp;
try {
  tg?.ready();
  tg?.expand();
  // 목록을 끌 때 세로 스와이프로 미니앱이 닫히지 않게 한다.
  tg?.disableVerticalSwipes?.();
} catch {
  // 텔레그램 밖이거나 오래된 버전이면 그냥 연다.
}

const model = { library: [], playlists: [], activeId: null, viewedId: null };
const playback = {
  playingPlaylistId: null,
  currentTrackId: null,
  currentTitle: '',
  loadedId: null,
  lastIndex: 0,
  repeat: 'all',
  unplayable: new Set(),
  failures: 0,
};
// 플레이리스트마다 저장기 하나. 목록을 바꾸기 전에는 모두 비운다.
const savers = new Map();
let api;
let player;

const readLocal = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writeLocal = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 저장 공간이 막혀도 재생은 된다.
  }
};

// 재생 중인 목록이 지워졌으면 빈 목록이 되어 다음 곡이 없고 멈춘다.
const playlistIds = (id) => model.playlists.find((p) => p.id === id)?.track_ids ?? [];
const viewedIds = () => playlistIds(model.viewedId);
const playingIds = () => playlistIds(playback.playingPlaylistId ?? model.viewedId);
const viewedPlaylist = () => model.playlists.find((p) => p.id === model.viewedId);
const titleOf = (id) => model.library.find((t) => t.id === id)?.title ?? '';
const titleMap = () => new Map(model.library.map((t) => [t.id, t.title]));
const barState = () => ({
  title: playback.currentTitle,
  position: player?.position() ?? 0,
  duration: player?.duration() ?? 0,
  playing: player?.isPlaying() ?? false,
  repeat: playback.repeat,
});

function renderAll() {
  const ids = viewedIds();
  renderPicker(model.playlists, model.viewedId, NEW_PLAYLIST);
  renderQueue(ids, { titles: titleMap(), currentId: playback.currentTrackId, unplayable: playback.unplayable }, {
    onPlay: onPlayRow,
    onRemove: onRemoveFromQueue,
  });
  renderLibrary(model.library, new Set(ids), { onAdd: onAddToQueue, onDelete: onDeleteTrack });
  renderBar(barState());
}

function showSaveNotice(text) {
  setNotice('save-notice', text);
}

function reportError(err) {
  showSaveNotice(err.code === 'expired' ? COPY.reopen : COPY.saveFailed);
}

function showFatal(text) {
  setNotice('fatal', text);
  setVisible('fatal', true);
}

// 저장기는 플레이리스트마다 하나. 저장이 끝나면 대기 중인 저장이 없을 때만 알림을 지운다.
const anyPending = () => [...savers.values()].some((s) => s.pending());
const flushAll = () => Promise.all([...savers.values()].map((s) => s.flush()));

function saverFor(id) {
  if (!savers.has(id)) {
    savers.set(
      id,
      createSaver((value) => api.savePlaylist(value.id, value.name, value.track_ids), {
        onError: reportError,
        onSaved: () => {
          if (!anyPending()) showSaveNotice('');
        },
      }),
    );
  }
  return savers.get(id);
}

// 재생 중인 목록이 바뀌어도 지금 곡이 남아 있으면 자리를 맞춘다. 빠졌으면 lastIndex를 그대로 둔다.
function syncLastIndex() {
  const at = playingIds().indexOf(playback.currentTrackId);
  if (at !== -1) playback.lastIndex = at;
}

// 보고 있는 목록을 바꾸고 화면과 저장을 맞춘다.
function editViewed(ids) {
  const playlist = viewedPlaylist();
  if (!playlist) return;
  const updated = { ...playlist, track_ids: ids };
  model.playlists = model.playlists.map((p) => (p.id === playlist.id ? updated : p));
  if (playback.playingPlaylistId === playlist.id) syncLastIndex();
  saverFor(playlist.id).update({ id: playlist.id, name: playlist.name, track_ids: ids });
  renderAll();
}

function onRemoveFromQueue(id) {
  editViewed(viewedIds().filter((x) => x !== id));
}

function onAddToQueue(id) {
  editViewed([...viewedIds(), id]);
}

async function onDeleteTrack(id) {
  if (!confirm(COPY.deleteTrackConfirm)) return;
  try {
    await api.deleteTrack(id);
  } catch (err) {
    return reportError(err);
  }
  model.library = model.library.filter((t) => t.id !== id);
  model.playlists = model.playlists.map((p) =>
    p.track_ids.includes(id) ? { ...p, track_ids: p.track_ids.filter((x) => x !== id) } : p,
  );
  syncLastIndex();
  player.forget(id);
  renderAll();
}

async function onPickPlaylist(id) {
  if (id === model.viewedId) return;
  await flushAll();
  model.viewedId = id;
  writeLocal(KEY_PLAYLIST, String(id));
  renderAll();
  try {
    model.activeId = (await api.setActive(id)).active_id;
  } catch (err) {
    reportError(err);
  }
}

async function onNewPlaylist() {
  const name = prompt(COPY.playlistName);
  if (name === null) return renderAll();
  await flushAll();
  try {
    const playlist = await api.createPlaylist(name, []);
    model.playlists = [...model.playlists, playlist];
    model.activeId = playlist.id;
    model.viewedId = playlist.id;
    writeLocal(KEY_PLAYLIST, String(playlist.id));
  } catch (err) {
    reportError(err);
  }
  renderAll();
}

function onPickerChange() {
  const value = $('picker').value;
  if (value === NEW_PLAYLIST) return onNewPlaylist();
  return onPickPlaylist(Number(value));
}

async function onDeletePlaylist() {
  if (!confirm(COPY.deletePlaylistConfirm)) return;
  const id = model.viewedId;
  const saver = savers.get(id);
  if (saver) {
    await saver.flush();
    if (saver.pending()) return showSaveNotice(COPY.saveFailed);
  }
  let res;
  try {
    res = await api.deletePlaylist(id);
  } catch (err) {
    return reportError(err);
  }
  savers.delete(id);
  model.playlists = model.playlists.filter((p) => p.id !== id);
  model.activeId = res.active_id;
  model.viewedId = res.active_id;
  writeLocal(KEY_PLAYLIST, String(res.active_id));
  renderAll();
}

function computeNext(manual) {
  // ⏭·⏮는 한 곡 반복이어도 전체 반복처럼 움직인다.
  const repeat = manual && playback.repeat === 'one' ? 'all' : playback.repeat;
  return nextTrack({
    trackIds: playingIds(),
    currentId: playback.currentTrackId,
    lastIndex: playback.lastIndex,
    repeat,
    unplayable: playback.unplayable,
  });
}

function computePrev() {
  return prevTrack({
    trackIds: playingIds(),
    currentId: playback.currentTrackId,
    lastIndex: playback.lastIndex,
    unplayable: playback.unplayable,
  });
}

function stopPlayback(message) {
  if (player.isPlaying()) player.toggle();
  if (message) setNotice('play-notice', message);
  renderAll();
}

async function playCurrent() {
  const id = playback.currentTrackId;
  const started = await player.play({ id, title: playback.currentTitle });
  if (started) {
    playback.failures = 0;
    playback.loadedId = id;
    setNotice('play-notice', '');
    const nextId = computeNext(false);
    if (nextId !== null && nextId !== id) player.prefetch(nextId);
  }
  renderAll();
}

function moveTo(id) {
  if (id === null) return stopPlayback(COPY.noPlayable);
  playback.playingPlaylistId ??= model.viewedId;
  playback.currentTrackId = id;
  playback.currentTitle = titleOf(id);
  syncLastIndex();
  renderAll();
  return playCurrent();
}

// 사용자가 누른 이동. 연속 실패 횟수를 다시 센다.
function userMove(id) {
  playback.failures = 0;
  return moveTo(id);
}

function onTrackEnded() {
  moveTo(computeNext(false));
}

// 받기·재생 실패. 다른 곡이 눌렸으면 player가 이미 버렸으므로 여기 오지 않는다.
function onTrackFailed(err) {
  if (err.code === 'expired') {
    setNotice('play-notice', COPY.reopen);
    return renderAll();
  }
  if (err.code === 'too_big') {
    playback.unplayable = new Set([...playback.unplayable, playback.currentTrackId]);
  } else {
    playback.failures += 1;
    setNotice('play-notice', COPY.trackFailed);
  }
  // 목록 곡 수만큼 연속 실패하면 한 바퀴를 다 돈 것이다. 멈춘다.
  if (playback.failures >= playingIds().length) return stopPlayback();
  moveTo(computeNext(true));
}

function onPlayRow(id) {
  if (playback.unplayable.has(id)) return;
  playback.playingPlaylistId = model.viewedId;
  userMove(id);
}

function onPlayPause() {
  if (playback.currentTrackId === null) return userMove(computeNext(true));
  // 실패로 멈춘 뒤라면 지금 곡을 다시 받아 튼다. 이미 올라온 곡이면 토글만 한다.
  if (playback.currentTrackId !== playback.loadedId) return userMove(playback.currentTrackId);
  player.toggle();
  return undefined;
}

function onRepeat() {
  playback.repeat = REPEAT_ORDER[(REPEAT_ORDER.indexOf(playback.repeat) + 1) % REPEAT_ORDER.length];
  writeLocal(KEY_REPEAT, playback.repeat);
  renderAll();
}

async function refreshFromServer() {
  await flushAll();
  let state;
  try {
    state = await api.state();
  } catch (err) {
    return showSaveNotice(err.code === 'expired' ? COPY.reopen : COPY.loadFailed);
  }
  // 저장이 실패해 남은 편집은 서버 값보다 우선한다.
  const local = new Map(model.playlists.map((p) => [p.id, p]));
  model.playlists = state.playlists.map((p) => (savers.get(p.id)?.pending() ? (local.get(p.id) ?? p) : p));
  model.library = state.library;
  model.activeId = state.active_id;
  if (!model.playlists.some((p) => p.id === model.viewedId)) model.viewedId = state.active_id;
  syncLastIndex();
  renderAll();
}

async function init() {
  const initData = tg?.initData ?? '';
  if (!IS_LOCAL && !initData) return showFatal(COPY.openFromMenu);

  const makeApi = IS_LOCAL ? (await import('./fake-api.js')).createApi : createApi;
  api = makeApi(API_BASE, initData);
  player = createPlayer({
    api,
    onChange: () => renderBar(barState()),
    onTrackEnd: onTrackEnded,
    onError: onTrackFailed,
    onSkip: (dir) => (dir === 'next' ? userMove(computeNext(true)) : userMove(computePrev())),
  });

  let state;
  try {
    state = await api.state();
  } catch (err) {
    return showFatal(err.code === 'expired' ? COPY.reopen : COPY.loadFailed);
  }
  model.library = state.library;
  model.playlists = state.playlists;
  model.activeId = state.active_id;
  const remembered = Number(readLocal(KEY_PLAYLIST));
  model.viewedId = model.playlists.some((p) => p.id === remembered) ? remembered : model.activeId;
  const repeat = readLocal(KEY_REPEAT);
  playback.repeat = REPEAT_ORDER.includes(repeat) ? repeat : 'all';

  setVisible('app', true);
  setVisible('bar', true);
  renderAll();

  if (window.Sortable) {
    window.Sortable.create($('queue'), {
      handle: '.handle',
      animation: 150,
      ghostClass: 'ghost',
      onEnd: () => editViewed([...$('queue').children].map((li) => Number(li.dataset.id))),
    });
  }
  $('picker').addEventListener('change', onPickerChange);
  $('remove-playlist').addEventListener('click', onDeletePlaylist);
  $('prev').addEventListener('click', () => userMove(computePrev()));
  $('toggle').addEventListener('click', onPlayPause);
  $('next').addEventListener('click', () => userMove(computeNext(true)));
  $('repeat').addEventListener('click', onRepeat);
  $('seek').addEventListener('input', (e) => player.seek(Number(e.target.value)));
  // 백그라운드에서 돌아오면 서버 값을 새로 받는다. 재생은 건드리지 않는다.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshFromServer();
  });
}

init().catch((err) => {
  console.error(err);
  showFatal(COPY.loadFailed);
});
