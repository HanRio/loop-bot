// 콘티 탭: 고른 목록의 곡 순서. 내 목록만 끌어서 순서를 바꾸고 곡을 뺀다. 글자는 모두 textContent로 넣는다.
import { swipeable } from './swipe-row.js';
import { moodFor } from './ui-logic.js';
import { $ } from './dom.js';
import { icon, iconButton, openMenu, pressable } from './menus.js';

const NO_TRACK_TEXT = '곡이 없어요. 라이브러리에서 곡을 담아 보세요.';
const UNPLAYABLE_TEXT = '채팅 재생만 가능';
const NOW_TEXT = '지금 재생 중';
const PAUSED_TEXT = '일시 정지 중';
const REMOVE_LABEL = '목록에서 빼기';

// 곡 색: 시안과 같이 팔레트의 첫 색에서 셋째 색으로 번지는 띠.
const art = (id) => {
  const [first, , third] = moodFor(id);
  return `linear-gradient(150deg, ${first}, ${third})`;
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function moveItem(ids, from, to) {
  const next = ids.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

function dragHandle() {
  const handle = el('span', 'drag');
  handle.append(icon('grip'));
  handle.setAttribute('role', 'img');
  handle.setAttribute('aria-label', '끌어서 순서 바꾸기');
  // 손잡이를 눌렀다 뗀 것은 재생으로 치지 않는다.
  handle.addEventListener('click', (event) => event.stopPropagation());
  return handle;
}

function rowSubtext(view, id) {
  if (view.unplayable.has(id)) return UNPLAYABLE_TEXT;
  if (id !== view.currentId) return '';
  return view.playing ? NOW_TEXT : PAUSED_TEXT;
}

export function createConti({ onPlay, onReorder, onRemove, onOpenLists, onListMenu, onSettings }) {
  const pane = $('tab-conti');
  let view = null;
  let sortable = null;

  const kicker = el('p', 'kicker');
  const title = el('h1');
  const openListsButton = el('button', 'chip', '목록 바꾸기');
  openListsButton.type = 'button';
  openListsButton.addEventListener('click', () => onOpenLists());
  const listMenuButton = iconButton('more', '목록 메뉴', () => onListMenu());
  const settingsButton = iconButton('person', '설정', () => onSettings());
  const actions = el('div', 'acts');
  actions.append(openListsButton, listMenuButton, settingsButton);
  const titleBox = el('div');
  titleBox.append(kicker, title);
  const head = el('div', 'head');
  head.append(titleBox, actions);
  const count = el('h2');
  const list = el('ol', 'rows');
  const empty = el('p', 'empty', NO_TRACK_TEXT);

  pane.replaceChildren(head, count, list, empty);

  // 줄 하나. 내 목록이면 끌기 손잡이와 ⋯(목록에서 빼기)를 붙인다. 공유 목록은 읽기만 한다.
  function trackRow(id, index, next) {
    const li = el('li', 'row');
    li.dataset.id = String(id);
    li.classList.toggle('now', id === next.currentId);
    if (id === next.currentId) li.setAttribute('aria-current', 'true');
    li.classList.toggle('off', next.unplayable.has(id));

    const thumb = el('span', 'thumb');
    thumb.style.background = art(id);
    const text = el('span', 't');
    text.append(el('b', null, next.titles.get(id) ?? ''));
    const sub = rowSubtext(next, id);
    if (sub) text.append(el('span', null, sub));

    pressable(text, `${next.titles.get(id) ?? ''} 재생`);
    li.append(el('span', 'n', String(index + 1)), thumb, text);
    if (next.isOwn) {
      li.prepend(dragHandle());
      li.append(iconButton('more', '곡 메뉴', () => openMenu([
        { label: REMOVE_LABEL, danger: true, run: () => onRemove(id) },
      ]), 'more'));
    }
    li.addEventListener('click', () => onPlay(id));
    return next.isOwn ? swipeable(li, { label: '빼기', onAction: () => onRemove(id) }) : li;
  }

  // 이전 인스턴스를 먼저 부순다. 내 목록이 아니거나 Sortable이 없으면 끌기는 켜지 않는다.
  function mountSortable(enabled) {
    sortable?.destroy();
    sortable = null;
    if (!enabled || !window.Sortable) return;
    sortable = window.Sortable.create(list, {
      handle: '.drag',
      // 다른 줄이 부드럽게 비켜나고, 끄는 줄은 불투명한 카드로 손가락을 따라온다.
      animation: 260,
      easing: 'cubic-bezier(.2, .8, .2, 1)',
      forceFallback: true,
      fallbackOnBody: true,
      fallbackTolerance: 3,
      ghostClass: 'ghost',
      chosenClass: 'chosen',
      fallbackClass: 'lift',
      onEnd: ({ oldIndex, newIndex }) => {
        // 제자리에 놓아도 다시 그리게 한다. 끄는 동안 건너뛴 렌더가 있을 수 있다.
        onReorder(moveItem(view.trackIds, oldIndex, newIndex));
      },
    });
  }

  function render(next) {
    view = next;
    kicker.textContent = next.isOwn ? '내 목록' : '공유받은 목록';
    title.textContent = next.listName;
    listMenuButton.hidden = !next.isOwn;
    count.textContent = `순서 · ${next.trackIds.length}곡`;
    list.replaceChildren(...next.trackIds.map((id, index) => trackRow(id, index, next)));
    empty.hidden = next.trackIds.length > 0;
    mountSortable(next.isOwn);
  }

  return { render };
}
