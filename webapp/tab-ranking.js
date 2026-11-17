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

function rankRow(rank, title, count, isMe = false) {
  const li = el('li', 'row rank');
  li.classList.toggle('me', isMe);
  li.append(el('span', 'n', String(rank).padStart(2, '0')));
  const text = el('span', 't');
  text.append(el('b', null, title));
  li.append(text, el('span', 'c', `${count}회`));
  return li;
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
      s.list.replaceChildren(...items.map((item, i) => (
        s.key === 'users' ? rankRow(i + 1, item.is_me ? `${item.name} (나)` : item.name, item.count, item.is_me)
          : rankRow(i + 1, item.title, item.count)
      )));
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
