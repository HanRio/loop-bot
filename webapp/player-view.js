// 전체 플레이어 그리기 (v2 Noir 모양). 커버·스펙트럼·파형 시크바·버튼·볼륨을 실제 곡 값으로 칠한다. 글자는 모두 textContent로 넣는다.
import { $ } from './dom.js';
import { moodFor } from './ui-logic.js';
import { coverUrl, formatTime, waveform } from './v2-logic.js';

const BAR_COUNT = 72;
const SPECTRUM_BARS = 56;
const FADE_MS = 650;
const SEEK_STEP = 5;
const SEEK_PAGE = 30;
const SVG_NS = 'http://www.w3.org/2000/svg';
const REPEAT_LABEL = { all: '반복: 전체', one: '반복: 한 곡', off: '반복: 끔' };

// 래퍼런스 아이콘 그대로. 모양은 이 파일의 상수에서만 온다.
const FILLED = { play: ['M8 5.6v12.8a1 1 0 0 0 1.52.85l10.3-6.4a1 1 0 0 0 0-1.7L9.52 4.75A1 1 0 0 0 8 5.6z'],
  pause: ['M6 6.2A1.2 1.2 0 0 1 7.2 5h1.6A1.2 1.2 0 0 1 10 6.2v11.6A1.2 1.2 0 0 1 8.8 19H7.2A1.2 1.2 0 0 1 6 17.8z', 'M14 6.2A1.2 1.2 0 0 1 15.2 5h1.6A1.2 1.2 0 0 1 18 6.2v11.6a1.2 1.2 0 0 1-1.2 1.2h-1.6a1.2 1.2 0 0 1-1.2-1.2z'],
  prev: ['M4 6a1 1 0 0 1 1-1h.4a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z', 'M20 6.4v11.2a1 1 0 0 1-1.55.83L10 12.83a1 1 0 0 1 0-1.66l8.45-5.6A1 1 0 0 1 20 6.4z'],
  next: ['M17.6 6a1 1 0 0 1 1-1h.4a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-.4a1 1 0 0 1-1-1z', 'M4 6.4v11.2a1 1 0 0 0 1.55.83L14 12.83a1 1 0 0 0 0-1.66L5.55 5.57A1 1 0 0 0 4 6.4z'] };
const STROKED = {
  shuffle: ['M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22', 'm18 2 4 4-4 4', 'M2 6h1.9c1.5 0 2.9.9 3.6 2.2', 'M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8', 'm18 14 4 4-4 4'],
  repeat: ['m17 2 4 4-4 4', 'M3 11v-1a4 4 0 0 1 4-4h14', 'm7 22-4-4 4-4', 'M21 13v1a4 4 0 0 1-4 4H3'],
  vol: ['M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6A1.4 1.4 0 0 1 5.4 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z', 'M16 9a5 5 0 0 1 0 6', 'M19.4 18.4a9 9 0 0 0 0-12.8'],
  mute: ['M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6A1.4 1.4 0 0 1 5.4 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z', 'm22 9-6 6', 'm16 9 6 6'],
  lyrics: ['M4 6h11', 'M4 10h11', 'M4 14h7', 'M18 18.5a2 2 0 1 1-2-2 2 2 0 0 1 2 2zV6l3-1'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  grip: ['M9 7h.01', 'M15 7h.01', 'M9 12h.01', 'M15 12h.01', 'M9 17h.01', 'M15 17h.01'],
};
const SIZE = { play: 26, pause: 26, prev: 22, next: 22, shuffle: 20, repeat: 20, vol: 18, mute: 18, lyrics: 20, more: 20, grip: 18 };

export function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const size = String(SIZE[name]);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const filled = name in FILLED;
  svg.setAttribute('fill', filled ? 'currentColor' : 'none');
  if (!filled) {
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', name === 'more' || name === 'grip' ? '3' : '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
  }
  for (const d of (FILLED[name] ?? STROKED[name])) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

const setIcon = (button, name) => button.replaceChildren(icon(name));

// 곡의 겉모양: 참고 영상 썸네일이 있으면 사진(못 받으면 아래 그라데이션이 보인다), 없으면 곡 색 그라데이션.
function paintArt(node, id, media) {
  const url = coverUrl(media[id]?.video_id);
  const [a, , c] = moodFor(id ?? 0);
  const gradient = `linear-gradient(150deg, ${a}, ${c})`;
  node.classList.toggle('yt', Boolean(url));
  node.style.backgroundImage = url ? `url("${url}"), ${gradient}` : gradient;
  node.style.backgroundSize = url ? 'auto 134%, cover' : 'cover';
}

function createCover() {
  const cover = $('cover');
  const ambient = $('player-glow');
  let shown = null;
  return (id, media) => {
    const key = `${id}|${media[id]?.video_id ?? ''}`;
    if (key === shown) return;
    shown = key;
    const layer = document.createElement('div');
    layer.className = 'layer';
    paintArt(layer, id, media);
    const old = [...cover.children];
    cover.append(layer);
    void layer.offsetWidth; // 붙인 다음 프레임에 켜야 서서히 바뀐다.
    layer.classList.add('on');
    old.forEach((node) => {
      node.classList.remove('on');
      setTimeout(() => node.remove(), FADE_MS);
    });
    ambient.style.backgroundImage = layer.style.backgroundImage;
  };
}

function paintBars(seed) {
  const heights = waveform(seed, BAR_COUNT);
  for (const id of ['bars-base', 'bars-hover', 'bars-fill']) {
    $(id).replaceChildren(...heights.map((h) => {
      const span = document.createElement('span');
      span.style.height = `${(h * 100).toFixed(1)}%`;
      return span;
    }));
  }
}

// 파형 시크바. 끄는 동안은 손가락 자리를 보여 주고, 놓을 때 한 번만 옮긴다.
function createScrub({ duration, position, onSeek }) {
  const scrub = $('scrub');
  let drag = null;
  const fromX = (x) => {
    const r = scrub.getBoundingClientRect();
    return Math.max(0, Math.min(1, (x - r.left) / r.width));
  };
  const hover = (f) => {
    scrub.style.setProperty('--h', `${f * 100}%`);
    $('tip').textContent = formatTime(f * duration());
  };
  scrub.addEventListener('pointermove', (e) => {
    const f = fromX(e.clientX);
    hover(f);
    if (drag !== null) drag = f * duration();
  });
  scrub.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || duration() <= 0) return;
    try {
      scrub.setPointerCapture(e.pointerId);
    } catch {
      // 붙잡지 못해도 줄 위에서는 이어진다.
    }
    const f = fromX(e.clientX);
    hover(f);
    drag = f * duration();
    scrub.classList.add('dragging');
  });
  const release = () => {
    if (drag === null) return;
    onSeek(drag);
    drag = null;
    scrub.classList.remove('dragging');
  };
  scrub.addEventListener('pointerup', release);
  scrub.addEventListener('pointercancel', () => {
    drag = null;
    scrub.classList.remove('dragging');
  });
  scrub.addEventListener('keydown', (e) => {
    const p = position();
    const map = { ArrowRight: p + SEEK_STEP, ArrowUp: p + SEEK_STEP, ArrowLeft: p - SEEK_STEP, ArrowDown: p - SEEK_STEP,
      Home: 0, End: duration() - 1, PageUp: p + SEEK_PAGE, PageDown: p - SEEK_PAGE };
    if (!(e.key in map)) return;
    e.preventDefault();
    e.stopPropagation();
    onSeek(map[e.key]);
  });
  return function paint() {
    const d = duration();
    const p = drag ?? position();
    const pct = d > 0 ? (p / d) * 100 : 0;
    scrub.style.setProperty('--p', `${pct}%`);
    const now = formatTime(p);
    if ($('cur').textContent !== now) $('cur').textContent = now;
    scrub.setAttribute('aria-valuenow', String(Math.round(pct)));
    scrub.setAttribute('aria-valuetext', `${now} / ${formatTime(d)}`);
  };
}

// 스펙트럼. 실제 소리를 분석하면 아이폰에서 화면이 꺼질 때 재생이 멈출 수 있어, 재생 중일 때만 움직이는 장식으로 둔다.
function createSpectrum() {
  const canvas = $('spectrum');
  const g = canvas.getContext('2d');
  const levels = new Float32Array(SPECTRUM_BARS);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  new ResizeObserver(() => {
    const r = canvas.getBoundingClientRect();
    const dpr = devicePixelRatio || 1;
    canvas.width = r.width * dpr;
    canvas.height = r.height * dpr;
  }).observe(canvas);
  return function draw(playing, t) {
    let energy = 0;
    for (let i = 0; i < SPECTRUM_BARS; i += 1) {
      const tilt = 1 - (i / SPECTRUM_BARS) * 0.7;
      const wobble = 0.5 + 0.25 * Math.sin(t * 0.0047 + i * 0.9) + 0.25 * Math.sin(t * 0.0113 + i * 2.3);
      const target = playing && !reduce.matches ? tilt * wobble : playing ? tilt * 0.4 : 0;
      levels[i] = playing ? levels[i] * 0.6 + target * 0.4 : levels[i] * 0.9;
      energy = Math.max(energy, levels[i]);
    }
    const W = canvas.width;
    const H = canvas.height;
    g.clearRect(0, 0, W, H);
    const gap = W / SPECTRUM_BARS;
    const bw = Math.max(2, gap * 0.42);
    const base = H * 0.62;
    for (let i = 0; i < SPECTRUM_BARS; i += 1) {
      const v = levels[i] ** 1.6;
      const h = Math.max(bw, v * base * 0.95);
      const x = i * gap + (gap - bw) / 2;
      g.fillStyle = `rgba(237,235,230,${0.18 + v * 0.75})`;
      g.beginPath(); g.roundRect(x, base - h, bw, h, bw / 2); g.fill();
      g.fillStyle = `rgba(237,235,230,${0.04 + v * 0.12})`;
      g.beginPath(); g.roundRect(x, base + 3, bw, h * 0.45, bw / 2); g.fill();
    }
    return energy > 0.01;
  };
}

export function createPlayerView({ position, duration, onSeek }) {
  const root = $('player');
  const paintCover = createCover();
  const paintScrub = createScrub({ duration, position, onSeek });
  const drawSpectrum = createSpectrum();
  let barsFor;
  let playing = false;
  let frame = 0;

  for (const name of ['prev', 'next', 'shuffle', 'lyrics']) setIcon($(name), name);

  // 플레이어가 펼쳐져 있고, 재생 중이거나 스펙트럼이 아직 가라앉는 중일 때만 화면 새로 고침마다 칠한다.
  // 접혀 있으면 보이지 않으니 칠하지 않는다(폰에서 매 프레임 캔버스를 그리면 다른 화면이 버벅인다).
  const isOpen = () => root.classList.contains('open') && !document.hidden;
  function tick(t) {
    if (!isOpen()) {
      frame = 0;
      return;
    }
    paintScrub();
    const active = drawSpectrum(playing, t);
    frame = playing || active ? requestAnimationFrame(tick) : 0;
  }
  const wake = () => {
    if (!frame && isOpen()) frame = requestAnimationFrame(tick);
  };
  document.addEventListener('visibilitychange', wake);
  // 펼치는 순간 다시 칠하기 시작한다.
  new MutationObserver(wake).observe(root, { attributes: true, attributeFilter: ['class'] });

  // 재생기는 1초에 4번쯤 다시 그리라고 한다. 바뀐 것이 없으면 버튼·아이콘을 새로 만들지 않는다.
  let lastKey = '';
  function paint(s) {
    playing = s.playing;
    const key = [s.id, s.playing, s.loading, s.repeat, s.shuffle, s.lyricsOn, s.loading ? '' : duration(), s.media?.[s.id]?.video_id ?? ''].join('|');
    if (key === lastKey) return wake();
    lastKey = key;
    root.classList.toggle('is-playing', s.playing);
    root.classList.toggle('is-loading', s.loading);
    $('dur').textContent = s.loading ? '받는 중…' : formatTime(duration());
    paintCover(s.id, s.media);
    if (barsFor !== s.id) {
      barsFor = s.id;
      paintBars((s.id ?? 0) + 1);
    }
    setIcon($('play'), s.playing ? 'pause' : 'play');
    $('play').setAttribute('aria-label', s.playing ? '일시정지' : '재생');
    $('play').setAttribute('aria-busy', String(s.loading));
    $('shuffle').setAttribute('aria-pressed', String(s.shuffle));
    const repeat = $('repeat');
    repeat.setAttribute('aria-pressed', String(s.repeat !== 'off'));
    repeat.setAttribute('aria-label', REPEAT_LABEL[s.repeat]);
    repeat.replaceChildren(icon('repeat'));
    if (s.repeat === 'one') {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = '1';
      repeat.append(badge);
    }
    $('lyrics').disabled = s.id === null;
    $('lyrics').setAttribute('aria-pressed', String(s.lyricsOn));
    $('stage').classList.toggle('lyrics', s.lyricsOn && s.id !== null);
    paintScrub();
    wake();
  }

  function paintVolume({ value, enabled }) {
    $('mute').hidden = !enabled;
    $('vol').hidden = !enabled;
    $('vol').value = String(Math.round(value * 100));
    $('vol').style.setProperty('--v', `${value * 100}%`);
    setIcon($('mute'), value === 0 ? 'mute' : 'vol');
    $('mute').setAttribute('aria-label', value === 0 ? '음소거 해제' : '음소거');
  }

  return { paint, paintVolume };
}
