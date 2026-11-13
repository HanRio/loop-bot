// 콘티 탭: 고른 목록의 곡 순서. 내 목록만 끌어서 순서를 바꾸고 곡을 뺀다.
// 선택 모드에서는 여러 곡을 골라 재생·옮기기·삭제하고, 고른 곡을 한꺼번에 끈다. 글자는 모두 textContent로 넣는다.
import { swipeable } from './swipe-row.js';
import { $ } from './dom.js';
import { haptic } from './haptic.js';
import { icon, iconButton, openMenu, pressable } from './menus.js';

const NO_TRACK_TEXT = '곡이 없어요. 라이브러리에서 곡을 담아 보세요.';
const UNPLAYABLE_TEXT = '채팅 재생만 가능';
const NOW_TEXT = '지금 재생 중';
const PAUSED_TEXT = '일시 정지 중';
const REMOVE_LABEL = '목록에서 빼기';


function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
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

// 줄 앞 표시: 선택 중이면 체크, 재생 중인 곡은 움직이는 막대, 나머지는 흐린 순번(01, 02…).
function leadMark(id, index, view) {
  if (view.selecting) return el('span', 'n check');
  if (id === view.currentId) {
    const eq = el('span', `n eq${view.playing ? ' on' : ''}`);
    eq.setAttribute('aria-hidden', 'true');
    eq.append(el('i'), el('i'), el('i'));
    return eq;
  }
  return el('span', 'n', String(index + 1).padStart(2, '0'));
}

function rowSubtext(view, id) {
  if (view.unplayable.has(id)) return UNPLAYABLE_TEXT;
  if (id !== view.currentId) return '';
  return view.playing ? NOW_TEXT : PAUSED_TEXT;
}

export function createConti({ onPlay, onReorder, onRemove, onOpenLists, onListMenu, onSettings, onSelecting, onBulkPlay, onBulkMove, onBulkRemove }) {
  const pane = $('tab-conti');
  let view = null;
  let sortable = null;

  const kicker = el('p', 'kicker');
  const title = el('h1');
  const openListsButton = el('button', 'chip', '플리 바꾸기');
  openListsButton.type = 'button';
  openListsButton.addEventListener('click', () => onOpenLists());
  const listMenuButton = iconButton('more', '목록 메뉴', () => onListMenu());
  const settingsButton = iconButton('person', '설정', () => onSettings());
  const selectButton = el('button', 'chip', '선택');
  selectButton.type = 'button';
  selectButton.addEventListener('click', () => onSelecting(true));
  const actions = el('div', 'acts');
  actions.append(selectButton, openListsButton, listMenuButton, settingsButton);
  const titleBox = el('div');
  titleBox.append(kicker, title);
  const head = el('div', 'head');
  head.append(titleBox, actions);
  const count = el('h2');
  const list = el('ol', 'rows');
  const empty = el('p', 'empty', NO_TRACK_TEXT);

  // 선택 모드에서 목록 위에 붙는 막대. 고른 곡이 없으면 동작 버튼은 잠긴다.
  const bulkCount = el('span', 'bulk-count');
  bulkCount.setAttribute('aria-live', 'polite');
  const bulkButton = (text, run, className = 'chip') => {
    const button = el('button', className, text);
    button.type = 'button';
    button.addEventListener('click', run);
    return button;
  };
  const playButton = bulkButton('재생', () => onBulkPlay());
  const moveButton = bulkButton('옮기기', () => onBulkMove());
  const removeButton = bulkButton('삭제', () => onBulkRemove(), 'chip danger');
  const doneButton = bulkButton('완료', () => onSelecting(false), 'chip strong');
  const bulk = el('div', 'bulk glass');
  bulk.append(bulkCount, playButton, moveButton, removeButton, doneButton);

  pane.replaceChildren(head, count, bulk, list, empty);

  // 줄 하나. 내 목록이면 끌기 손잡이와 ⋯(목록에서 빼기)를 붙인다. 공유 목록은 읽기만 한다.
  function trackRow(id, index, next) {
    const li = el('li', 'row');
    li.dataset.id = String(id);
    const picked = next.selected.has(id);
    if (next.selecting) li.setAttribute('aria-pressed', String(picked));
    li.classList.toggle('now', id === next.currentId);
    if (id === next.currentId) li.setAttribute('aria-current', 'true');
    li.classList.toggle('off', next.unplayable.has(id));

    const text = el('span', 't');
    text.append(el('b', null, next.titles.get(id) ?? ''));
    const sub = rowSubtext(next, id);
    if (sub) text.append(el('span', null, sub));

    const name = next.titles.get(id) ?? '';
    pressable(text, next.selecting ? `${name} ${picked ? '선택 해제' : '선택'}` : `${name} 재생`);
    li.append(leadMark(id, index, next), text);
    if (next.isOwn) li.prepend(dragHandle());
    li.addEventListener('click', () => onPlay(id));
    if (next.selecting) return li;
    if (next.isOwn) {
      li.append(iconButton('more', '곡 메뉴', () => openMenu([
        { label: REMOVE_LABEL, danger: true, run: () => onRemove(id) },
      ]), 'more'));
    }
    return next.isOwn ? swipeable(li, { label: '빼기', onAction: () => onRemove(id) }) : li;
  }

  // 고른 곡을 끌면 같이 고른 다른 줄을 접어 끄는 줄에 싣고, 몇 곡인지 배지를 단다.
  // 높이를 숫자로 박아 두어야 0으로 줄어드는 게 보인다.
  let carried = false;
  const rowOf = (id) => list.querySelector(`li[data-id="${id}"]`);
  function liftRiders(li) {
    const id = Number(li.dataset.id);
    if (!view.selecting || !view.selected.has(id) || view.selected.size < 2) return;
    carried = true;
    const badge = el('span', 'ride-count', String(view.selected.size));
    li.append(badge);
    for (const other of view.selected) {
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
      onChoose: ({ item }) => {
        carried = false;
        haptic.tap();
        liftRiders(item);
      },
      // 끌지 않고 놓았으면 접은 줄을 편다.
      onUnchoose: () => { if (!carried) dropRiders(); },
      onEnd: ({ item }) => {
        // 제자리에 놓아도 다시 그리게 한다. 끄는 동안 건너뛴 렌더가 있을 수 있다.
        const domIds = [...list.children].map((li) => Number(li.dataset.id));
        dropRiders();
        haptic.tick();
        onReorder(domIds, Number(item.dataset.id));
      },
    });
  }

  function render(next) {
    view = next;
    kicker.textContent = next.isOwn ? '내 목록' : '공유받은 목록';
    title.textContent = next.listName;
    listMenuButton.hidden = !next.isOwn || next.selecting;
    selectButton.hidden = next.selecting || next.trackIds.length === 0;
    openListsButton.hidden = next.selecting;
    settingsButton.hidden = next.selecting;
    bulk.hidden = !next.selecting;
    pane.classList.toggle('selecting', next.selecting);
    const none = next.selected.size === 0;
    bulkCount.textContent = `${next.selected.size}곡`;
    moveButton.textContent = next.isOwn ? '옮기기' : '담기';
    removeButton.hidden = !next.isOwn;
    for (const button of [playButton, moveButton, removeButton]) button.disabled = none;
    count.textContent = `순서 · ${next.trackIds.length}곡`;
    list.replaceChildren(...next.trackIds.map((id, index) => trackRow(id, index, next)));
    empty.hidden = next.trackIds.length > 0;
    mountSortable(next.isOwn);
  }

  return { render };
}
