// v2 화면 그리기. 래퍼런스의 커버·스펙트럼·파형 시크바·재생 목록을 실제 곡 값으로 칠한다. 글자는 모두 textContent로 넣는다.
import { $ } from './dom.js';
import { haptic } from './haptic.js';
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
  const ambient = $('ambient');
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

function trackRow({ id, index, title, current, playing, unplayable, media, hasMenu, selecting, selected, canDrag, outside }) {
  const li = document.createElement('li');
  li.dataset.id = String(id);
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'item';
  item.dataset.id = String(id);
  item.dataset.act = 'play';
  item.setAttribute('aria-current', String(current));
  item.disabled = unplayable && !selecting;
  item.classList.toggle('outside', outside);
  if (selecting) item.setAttribute('aria-pressed', String(selected));
  const idx = document.createElement('span');
  idx.className = 'idx mono';
  if (selecting) {
    const check = document.createElement('span');
    check.className = 'check';
    idx.append(check);
  } else if (current) {
    const eq = document.createElement('span');
    eq.className = 'eq';
    eq.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
    idx.append(eq);
  } else {
    idx.textContent = String(index + 1);
  }
  const thumb = document.createElement('span');
  thumb.className = 'thumb';
  paintArt(thumb, id, media);
  const txt = document.createElement('span');
  txt.className = 'txt';
  const t = document.createElement('span');
  t.className = 't';
  t.textContent = title;
  txt.append(t);
  if (unplayable) {
    const a = document.createElement('span');
    a.className = 'a';
    a.textContent = '재생할 수 없는 곡';
    txt.append(a);
  }
  item.append(idx, thumb, txt);
  const state = selecting ? '' : current ? (playing ? ', 재생 중' : ', 일시정지') : '';
  item.setAttribute('aria-label', `${title}${state}`);
  li.append(item);
  if (canDrag) {
    const grip = document.createElement('span');
    grip.className = 'grip';
    grip.setAttribute('role', 'img');
    grip.setAttribute('aria-label', '끌어서 순서 바꾸기');
    grip.append(icon('grip'));
    li.append(grip);
  }
  if (hasMenu && !selecting) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'more';
    more.dataset.id = String(id);
    more.dataset.act = 'menu';
    more.setAttribute('aria-label', `${title} 메뉴`);
    more.append(icon('more'));
    li.append(more);
  }
  return li;
}

export function createView({ position, duration, onSeek, onPlayRow, onRowMenu, onFrame, onReorder }) {
  const app = $('app');
  const paintCover = createCover();
  const paintScrub = createScrub({ duration, position, onSeek });
  const drawSpectrum = createSpectrum();
  let barsFor = undefined;
  let playing = false;
  let frame = 0;

  for (const [id, name] of [['prev', 'prev'], ['next', 'next'], ['shuffle', 'shuffle'], ['lyrics', 'lyrics']]) setIcon($(id), name);

  $('list').addEventListener('click', (e) => {
    const button = e.target.closest('button[data-act]');
    if (!button) return;
    const id = Number(button.dataset.id);
    if (button.dataset.act === 'menu') onRowMenu(id);
    else onPlayRow(id);
  });

  function tick(t) {
    paintScrub();
    onFrame();
    const active = drawSpectrum(playing, t);
    frame = (playing || active) && !document.hidden ? requestAnimationFrame(tick) : 0;
  }
  const wake = () => {
    if (!frame) frame = requestAnimationFrame(tick);
  };
  document.addEventListener('visibilitychange', wake);

  function paintPlayer(s) {
    playing = s.playing;
    app.classList.toggle('is-playing', s.playing);
    app.classList.toggle('paused', !s.playing);
    app.classList.toggle('is-loading', s.loading);
    if ($('title').textContent !== s.title) $('title').textContent = s.title;
    $('player-sub').textContent = s.sub;
    document.title = s.id === null ? '플레이리스트 v2' : `${s.title} — ${s.sub}`;
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

  // 재생기는 1초에 몇 번씩 다시 그리라고 하므로, 목록은 바뀐 것이 있을 때만 새로 만든다.
  let listKey = '';
  let selected = new Set();
  let dragging = false;
  let carried = false; // 묶음으로 끌었는지. 끈 줄이 제자리여도 묶음은 모인다.
  const list = $('list');
  const rowOf = (id) => list.querySelector(`li[data-id="${id}"]`);

  // 같이 고른 다른 줄을 접어 끄는 줄에 싣는다. 높이를 숫자로 박아 두어야 0으로 줄어드는 게 보인다.
  function liftRiders(li) {
    const id = Number(li.dataset.id);
    if (!selected.has(id) || selected.size < 2) return;
    carried = true;
    const badge = document.createElement('span');
    badge.className = 'ride-count mono';
    badge.textContent = String(selected.size);
    li.append(badge);
    for (const other of selected) {
      const row = other === id ? null : rowOf(other);
      if (!row) continue;
      row.style.height = `${row.offsetHeight}px`;
      void row.offsetHeight;
      row.classList.add('riding');
      row.style.height = '';
    }
  }
  function dropRiders() {
    list.querySelectorAll('.ride-count').forEach((n) => n.remove());
    list.querySelectorAll('li.riding').forEach((row) => row.classList.remove('riding'));
  }

  // 손잡이로만 끈다. 손가락·마우스 모두 같은 방식(forceFallback)이라 떠오르는 모양과 비켜나는 움직임이 같다.
  const sortable = window.Sortable?.create(list, {
    handle: '.grip',
    animation: 220,
    easing: 'cubic-bezier(.2,.8,.2,1)',
    forceFallback: true,
    ghostClass: 'drag-ghost',
    chosenClass: 'drag-chosen',
    fallbackClass: 'drag-flying',
    onChoose: (e) => {
      dragging = true;
      carried = false;
      haptic.tap();
      liftRiders(e.item);
    },
    onUnchoose: () => {
      // 끌지 않고 놓았으면 접은 줄을 펴고 다시 그린다.
      dragging = false;
      dropRiders();
      listKey = '';
    },
    onEnd: (e) => {
      dragging = false;
      listKey = '';
      if (e.oldIndex === e.newIndex && !carried) return dropRiders();
      haptic.tick();
      const domIds = [...list.children].map((li) => Number(li.dataset.id));
      dropRiders();
      return onReorder(domIds, Number(e.item.dataset.id));
    },
  });

  function paintList(s) {
    selected = s.selected;
    if (dragging) return;
    sortable?.option('disabled', !s.canReorder);
    const key = [s.name, s.currentId, s.playing, [...s.unplayable].join(','), s.selecting, [...s.selected].join(','),
      s.canReorder, (s.queue ?? []).join(','),
      ...s.ids.map((id) => `${id}:${s.titles.get(id)}:${s.media[id]?.video_id ?? ''}:${s.hasMenu(id)}`)].join('\u0001');
    if (key === listKey) return;
    listKey = key;
    $('list-name').textContent = s.name;
    $('count').textContent = String(s.ids.length).padStart(2, '0');
    $('empty').hidden = s.ids.length > 0;
    $('list').replaceChildren(...s.ids.map((id, index) => trackRow({
      id, index, title: s.titles.get(id) ?? '', current: id === s.currentId, playing: s.playing,
      unplayable: s.unplayable.has(id), media: s.media, hasMenu: s.hasMenu(id),
      selecting: s.selecting, selected: s.selected.has(id),
      canDrag: s.canReorder, outside: Boolean(s.queue) && !s.queue.includes(id),
    })));
    $('list').closest('.queue').classList.toggle('selecting', s.selecting);
    $('select').hidden = s.selecting || s.ids.length === 0;
    $('pick').hidden = s.selecting;
    $('bulk').hidden = !s.selecting;
    const none = s.selected.size === 0;
    $('bulk-count').textContent = `${s.selected.size}곡`;
    $('bulk-play').disabled = none;
    // 내 목록이면 옮기기(여기서는 빠짐), 공유받은 목록이면 담기(여기는 그대로).
    $('bulk-add').textContent = s.canRemove ? '옮기기' : '담기';
    $('bulk-add').disabled = none || !s.canAdd;
    $('bulk-remove').hidden = !s.canRemove;
    $('bulk-remove').disabled = none;
  }

  function paintVolume({ value, enabled }) {
    $('mute').hidden = !enabled;
    $('vol').hidden = !enabled;
    $('vol').value = String(Math.round(value * 100));
    $('vol').style.setProperty('--v', `${value * 100}%`);
    setIcon($('mute'), value === 0 ? 'mute' : 'vol');
    $('mute').setAttribute('aria-label', value === 0 ? '음소거 해제' : '음소거');
  }

  return { paintPlayer, paintList, paintVolume };
}
