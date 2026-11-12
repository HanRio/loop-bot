// 플레이어의 실시간 가사. 글자는 모두 textContent로 넣는다.
import { lineAt, parseLrc } from './lrc.js';

const STEP_MS = 500;
const LIMIT_MS = 30000;
const SAVE_DELAY_MS = 600;
const REST = '♪';
const LABEL = {
  earlier: '−0.5초', later: '+0.5초', find: '다른 가사 찾기', findBare: '가사 찾기', more: '가사 조절', less: '접기', sheetTitle: '다른 가사 찾기', search: '곡명 검색',
  close: '닫기', none: '찾은 가사가 없어요', noSynced: '싱크가 있는 가사가 아니에요', failed: '불러오지 못했어요', loading: '찾는 중이에요',
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const clampOffset = (ms) => Math.max(-LIMIT_MS, Math.min(LIMIT_MS, ms));
const syncText = (ms) => `싱크 ${(ms / 1000).toFixed(1)}초`;
const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

// 서버 응답을 화면용 값으로. 줄이 없으면 가사 없는 곡으로 본다.
function toEntry(data) {
  const lines = data.status === 'found' && data.synced ? parseLrc(data.synced) : [];
  return { lines, offsetMs: data.offset_ms ?? 0 };
}

export function createPlayerLyrics({ api, player, canEdit, onError }) {
  const box = document.getElementById('player-lyrics');
  const sub = document.getElementById('player-sub');
  const list = box.querySelector('.lyr-lines');
  const edit = box.querySelector('.lyr-edit');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const cache = new Map();
  let currentId = null;
  let active = null; // 지금 그리는 가사 {lines, offsetMs}
  let nodes = [];
  let lastIndex = -2;
  let pending = null; // {id, ms} 아직 못 보낸 싱크값
  let timer = 0;

  const offsetLabel = el('span', 'lyr-sync');
  const earlier = el('button', 'chip', LABEL.earlier);
  const later = el('button', 'chip', LABEL.later);
  const find = el('button', 'chip', LABEL.find);
  for (const b of [earlier, later, find]) b.type = 'button';
  edit.append(earlier, offsetLabel, later, find);
  // 싱크·다른 가사 찾기는 평소엔 접어 두고, 작은 버튼을 눌러야 펼친다.
  const toggle = el('button', 'chip lyr-toggle', LABEL.more);
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');
  edit.before(toggle);
  let editOpen = false;
  toggle.addEventListener('click', () => {
    editOpen = !editOpen;
    paintEdit();
  });
  // 가사가 없는 곡에서도 곡 주인은 직접 찾을 수 있게, 제목 아래에 버튼을 둔다.
  const findBare = el('button', 'chip', LABEL.findBare);
  findBare.type = 'button';
  findBare.hidden = true;
  sub.after(findBare);

  function flush() {
    clearTimeout(timer);
    if (!pending) return;
    const { id, ms } = pending;
    pending = null;
    api.saveLyricsOffset(id, ms).catch((err) => onError?.(err));
  }

  function showTitle() {
    box.hidden = true;
    findBare.hidden = currentId === null || !canEdit();
  }

  function paintEdit() {
    toggle.hidden = !canEdit();
    toggle.setAttribute('aria-expanded', String(editOpen));
    toggle.textContent = editOpen ? LABEL.less : LABEL.more;
    edit.hidden = !canEdit() || !editOpen;
    offsetLabel.textContent = syncText(active?.offsetMs ?? 0);
  }

  function paint(entry) {
    active = entry;
    if (entry.lines.length === 0) {
      showTitle();
      return;
    }
    nodes = entry.lines.map((line) => {
      const p = el('p', null, line.text || REST);
      p.addEventListener('click', () => player.seek(Math.max(0, line.t - active.offsetMs / 1000)));
      return p;
    });
    list.replaceChildren(...nodes);
    list.scrollTop = 0;
    lastIndex = -2;
    findBare.hidden = true;
    box.hidden = false;
    paintEdit();
    tick(player.position());
  }

  function tick(position) {
    if (!active || box.hidden) return;
    const index = lineAt(active.lines, position, active.offsetMs);
    if (index === lastIndex) return;
    lastIndex = index;
    nodes.forEach((node, i) => node.classList.toggle('now', i === index));
    const target = nodes[index];
    const top = target ? target.offsetTop - list.clientHeight / 2 + target.offsetHeight / 2 : 0;
    list.scrollTo({ top: Math.max(0, top), behavior: reduce.matches ? 'auto' : 'smooth' });
  }

  async function show(id) {
    if (id === currentId) {
      if (active) paintEdit();
      return;
    }
    flush();
    currentId = id;
    editOpen = false; // 곡이 바뀌면 다시 접는다.
    active = null;
    showTitle();
    if (id === null) return;
    let entry = cache.get(id);
    if (!entry) {
      try {
        entry = toEntry(await api.lyrics(id));
      } catch {
        if (currentId === id) currentId = null; // 다음 show(id)에서 다시 시도한다.
        return; // 404나 실패는 제목만 보여 준다.
      }
      if (currentId !== id) return; // 그 사이 다른 곡으로 넘어갔다.
      cache.set(id, entry);
    }
    paint(entry);
  }

  function nudge(delta) {
    if (!active || currentId === null) return;
    const entry = { ...active, offsetMs: clampOffset(active.offsetMs + delta) };
    cache.set(currentId, entry);
    active = entry;
    lastIndex = -2;
    paintEdit();
    tick(player.position());
    pending = { id: currentId, ms: entry.offsetMs };
    clearTimeout(timer);
    timer = setTimeout(flush, SAVE_DELAY_MS);
  }
  earlier.addEventListener('click', () => nudge(-STEP_MS));
  later.addEventListener('click', () => nudge(STEP_MS));

  // 후보 시트. menus.js와 같은 .menu 시트 모양을 쓴다.
  function openFinder() {
    const id = currentId;
    if (id === null) return;
    const dialog = el('dialog', 'menu');
    dialog.setAttribute('aria-label', LABEL.sheetTitle);
    const input = el('input');
    input.type = 'text';
    input.setAttribute('aria-label', LABEL.search);
    const wrap = el('label', 'search glass');
    wrap.append(input);
    const form = el('form');
    form.append(wrap);
    const status = el('p', 'kicker');
    const close = el('button', null, LABEL.close);
    close.type = 'button';
    close.addEventListener('click', () => dialog.close());
    dialog.append(el('h2', null, LABEL.sheetTitle), form, status, close);
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
    });
    dialog.addEventListener('close', () => dialog.remove(), { once: true });

    let rows = [];
    let seq = 0;
    const setRows = (next) => {
      rows.forEach((r) => r.remove());
      rows = next;
      close.before(...rows);
    };
    async function choose(candidate) {
      try {
        const entry = toEntry(await api.chooseLyrics(id, candidate.id));
        if (entry.lines.length === 0) throw new Error('no_synced');
        cache.set(id, entry);
        dialog.close();
        if (currentId === id) paint(entry);
      } catch (err) {
        status.textContent = err?.status === 422 || err?.message === 'no_synced' ? LABEL.noSynced : LABEL.failed;
      }
    }
    async function search(q) {
      seq += 1;
      const mine = seq;
      status.textContent = LABEL.loading;
      setRows([]);
      try {
        const res = await api.lyricsCandidates(id, q);
        if (mine !== seq) return;
        if (q === undefined) input.value = res.q ?? '';
        status.textContent = res.candidates.length === 0 ? LABEL.none : '';
        setRows(res.candidates.map((c) => {
          const b = el('button', null, [c.track, c.artist, clock(c.duration)].filter(Boolean).join(' · '));
          b.type = 'button';
          b.addEventListener('click', () => choose(c));
          return b;
        }));
      } catch {
        if (mine === seq) status.textContent = LABEL.failed;
      }
    }
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      search(input.value.trim());
    });
    document.body.append(dialog);
    dialog.showModal();
    search(undefined);
  }
  find.addEventListener('click', openFinder);
  findBare.addEventListener('click', openFinder);

  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  window.addEventListener('pagehide', flush);

  return { show, tick };
}
