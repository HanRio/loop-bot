// 넓은 화면의 두 칸 배치. 패널 손잡이를 끌어 옮기고, 칸 사이 구분선을 끌어 너비를 바꾼다. 정한 배치는 기억한다.
// 좁은 화면에서는 기본 배치를 쓰고, 칸 래퍼는 CSS에서 펼쳐져 예전처럼 쌓인다.
import { DEFAULT_DESK, clampRatio, movePane, parseDesk } from './desk-layout.js';
import { $ } from './render.js';
import { readLocal, removeLocal, writeLocal } from './store.js';

export const WIDE_QUERY = '(min-width: 760px)';
const DESK_KEY = 'loopbot.player.desk';
const KEY_STEP = 0.02;

function clearDrop(deskEl) {
  for (const node of deskEl.querySelectorAll('[data-drop]')) delete node.dataset.drop;
}

export function createDesk({ root, onChange, onApplied }) {
  const wide = matchMedia(WIDE_QUERY);
  let desk = parseDesk(readLocal(DESK_KEY));
  // 마지막으로 applyAll에 넘어온 카드들. 여러 번 돌 수 있게 배열로 둔다.
  let cards = [];
  // 끌고 있는 것. 패널이면 {kind:'pane'}, 구분선이면 {kind:'divider'}.
  let drag = null;

  const isWide = () => wide.matches;

  // 같은 칸 안의 순서는 CSS order로만 바꾼다. DOM에서 옮긴 iframe은 처음부터 다시 뜨기 때문이다.
  function placeColumn(column, names, panes) {
    names.forEach((name, i) => {
      const node = panes[name];
      if (node.parentNode !== column) column.append(node);
      node.style.order = i;
    });
  }

  function applyCard(card) {
    const layout = isWide() ? desk : DEFAULT_DESK;
    placeColumn(card.columns.a, layout.a, card.panes);
    placeColumn(card.columns.b, layout.b, card.panes);
    const hasVisible = (column) => [...column.children].some((pane) => !pane.hidden);
    card.desk.classList.toggle('single', !hasVisible(card.columns.a) || !hasVisible(card.columns.b));
    card.columns.a.classList.toggle('follows', !card.columns.a.contains(card.panes.sheet));
    card.columns.b.classList.toggle('follows', !card.columns.b.contains(card.panes.sheet));
  }

  function applyAll(next) {
    if (next) cards = [...next];
    document.documentElement.style.setProperty('--desk-ratio', desk.ratio);
    for (const card of cards) applyCard(card);
    // 옮긴 사진 띠는 가로 위치를 잃는다. 스크롤 이벤트가 쪽 번호를 덮어쓰기 전에 되돌린다.
    onApplied();
  }

  function save(next) {
    desk = next;
    writeLocal(DESK_KEY, JSON.stringify(desk));
  }

  function startPaneDrag(event, grip) {
    const pane = grip.closest('.desk-pane');
    const card = cards.find((c) => c.desk === pane.closest('.desk'));
    if (!card) return;
    grip.setPointerCapture(event.pointerId);
    document.body.classList.add('desk-dragging');
    drag = { kind: 'pane', card, name: pane.dataset.pane, target: null, where: null };
  }

  function startResize(event, divider) {
    divider.setPointerCapture(event.pointerId);
    document.body.classList.add('desk-dragging');
    drag = { kind: 'divider', box: divider.parentElement.getBoundingClientRect(), ratio: desk.ratio };
  }

  function onPointerDown(event) {
    if (drag || event.button !== 0 || !isWide()) return;
    const grip = event.target.closest('.pane-grip');
    const divider = event.target.closest('.desk-divider');
    if (grip) startPaneDrag(event, grip);
    else if (divider) startResize(event, divider);
  }

  // 손가락 아래 패널의 위쪽 절반이면 앞에, 아래쪽 절반이면 뒤에 놓는다. 같은 카드의 다른 패널만 목표가 된다.
  function movePaneDrag(event) {
    const over = document.elementFromPoint(event.clientX, event.clientY)?.closest('.desk-pane');
    const valid = over && over.dataset.pane !== drag.name && drag.card.desk.contains(over) ? over : null;
    clearDrop(drag.card.desk);
    drag.target = valid ? valid.dataset.pane : null;
    drag.where = null;
    if (!valid) return;
    const rect = valid.getBoundingClientRect();
    drag.where = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    valid.dataset.drop = drag.where;
  }

  function resizeDrag(event) {
    drag.ratio = clampRatio((event.clientX - drag.box.left) / drag.box.width);
    document.documentElement.style.setProperty('--desk-ratio', drag.ratio);
  }

  function onPointerMove(event) {
    if (!drag) return;
    if (drag.kind === 'divider') resizeDrag(event);
    else movePaneDrag(event);
  }

  function endDrag() {
    if (!drag) return;
    if (drag.kind === 'pane') clearDrop(drag.card.desk);
    else document.documentElement.style.setProperty('--desk-ratio', desk.ratio);
    document.body.classList.remove('desk-dragging');
    drag = null;
  }

  function onPointerUp() {
    if (!drag) return;
    const finished = drag;
    if (finished.kind === 'divider') {
      save({ ...desk, ratio: finished.ratio });
    } else if (finished.target) {
      save(movePane(desk, finished.name, finished.target, finished.where));
      applyAll();
    }
    endDrag();
  }

  function onKeyDown(event) {
    const divider = event.target.closest('.desk-divider');
    if (!divider) return;
    const step = event.key === 'ArrowLeft' ? -KEY_STEP : event.key === 'ArrowRight' ? KEY_STEP : 0;
    if (!step) return;
    event.preventDefault();
    save({ ...desk, ratio: clampRatio(desk.ratio + step) });
    applyAll();
  }

  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', endDrag);
  root.addEventListener('lostpointercapture', endDrag);
  root.addEventListener('keydown', onKeyDown);

  $('desk-reset').addEventListener('click', () => {
    desk = DEFAULT_DESK;
    removeLocal(DESK_KEY);
    applyAll();
    onChange();
  });

  wide.addEventListener('change', () => {
    applyAll();
    onChange();
  });

  return { isWide, applyCard, applyAll };
}
