// 랭킹 탭: 이번 주·이번 달 내 기록, 전체 곡 순위, 유저 순위. 글자는 모두 textContent로 넣는다.
import { $ } from './dom.js';

const PERIODS = [['week', '이번 주'], ['month', '이번 달']];
const EMPTY_MINE = '아직 끝까지 들은 곡이 없어요.';
const EMPTY_ALL = '아직 기록이 없어요.';
const FAILED = '순위를 불러오지 못했어요.';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const COUNT_UP_MS = 700;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// 숫자가 0에서 목표까지 올라간다. 움직임 줄이기 설정이면 바로 보여 준다.
function countUp(node, to) {
  const label = (n) => `${n}회`;
  if (reducedMotion()) {
    node.textContent = label(to);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / COUNT_UP_MS);
    node.textContent = label(Math.round(to * (1 - (1 - t) ** 3)));
    if (t < 1 && node.isConnected) requestAnimationFrame(step);
  };
  node.textContent = label(0);
  requestAnimationFrame(step);
}

// 줄 뒤에 1위 대비 비율만큼 옅은 막대가 깔린다.
function rankRow(rank, title, count, top, isMe = false) {
  const li = el('li', 'row rank');
  li.classList.toggle('me', isMe);
  li.style.setProperty('--w', String(count / top));
  li.append(el('span', 'n', String(rank).padStart(2, '0')));
  const text = el('span', 't');
  text.append(el('b', null, title));
  const c = el('span', 'c');
  countUp(c, count);
  li.append(text, c);
  return li;
}

// 1~3위 시상대. 2위-1위-3위 순서로 세우고, 기둥 높이는 1위 대비 비율이다.
function podium(items, top) {
  const box = el('li', 'podium');
  const order = [1, 0, 2].filter((i) => i < items.length);
  box.append(...order.map((i) => {
    const item = items[i];
    const col = el('div', 'pod');
    col.classList.toggle('me', item.is_me);
    const c = el('span', 'c');
    countUp(c, item.count);
    const pillar = el('div', 'pillar');
    pillar.style.setProperty('--h', String(Math.max(0.45, item.count / top)));
    pillar.append(el('span', 'n', String(i + 1)));
    col.append(el('b', null, item.name), c, pillar);
    return col;
  }));
  return box;
}

export function createRanking({ api }) {
  const pane = $('tab-ranking');
  let period = 'week';
  let seq = 0;

  const seg = el('div', 'seg glass');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', '기간');
  const segButtons = PERIODS.map(([key, label]) => {
    const button = el('button', null, label);
    button.type = 'button';
    button.addEventListener('click', () => {
      if (period === key) return;
      period = key;
      load();
    });
    return button;
  });
  seg.append(...segButtons);

  const sections = [['mine', '내 기록', EMPTY_MINE], ['tracks', '전체 곡', EMPTY_ALL], ['users', '많이 들은 사람', EMPTY_ALL]]
    .map(([key, heading, emptyText]) => ({ key, heading: el('h2', null, heading), list: el('ul', 'rows'), empty: el('p', 'empty', emptyText) }));
  const notice = el('p', 'empty', FAILED);
  notice.hidden = true;

  pane.replaceChildren(
    el('h1', null, '랭킹'),
    seg,
    notice,
    ...sections.flatMap((s) => [s.heading, s.list, s.empty]),
  );

  // data가 null이면 불러오기 실패다.
  function paint(data) {
    notice.hidden = data !== null;
    for (const s of sections) {
      const items = data?.[s.key] ?? [];
      const top = items[0]?.count ?? 1;
      if (s.key === 'users') {
        const named = items.map((u) => ({ ...u, name: u.is_me ? `${u.name} (나)` : u.name }));
        s.list.replaceChildren(...(named.length ? [podium(named.slice(0, 3), top)] : []),
          ...named.slice(3).map((u, i) => rankRow(i + 4, u.name, u.count, top, u.is_me)));
      } else {
        s.list.replaceChildren(...items.map((item, i) => rankRow(i + 1, item.title, item.count, top)));
      }
      s.empty.hidden = data === null || items.length > 0;
      s.heading.hidden = data === null;
    }
  }

  // 늦게 온 응답이 새 기간을 덮지 않게 마지막 요청만 그린다.
  async function load() {
    const mine = ++seq;
    // 받는 동안은 앞 목록을 그대로 두고 고른 기간만 먼저 바꾼다.
    segButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(PERIODS[i][0] === period)));
    let data;
    try {
      data = await api.ranking(period);
    } catch {
      data = null;
    }
    if (mine === seq) paint(data);
  }

  return { load };
}
