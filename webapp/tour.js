// 첫 방문 안내 창. 대상 주변만 밝히고 말풍선을 붙인다. 대상을 눌러야 하는 단계는 그 누름을 받아 다음으로 넘어간다.
import { writeLocal } from './store.js';
import { TOUR_DONE_KEY, TOUR_STEPS, bubbleTop } from './tour-logic.js';

// 탭이 옮겨 가는 시간(미끄러짐)이 끝난 뒤에 잰다.
const TAB_SLIDE_MS = 350;
const RING_PAD = 6;
const PLACE_TRIES = 3;
const RETRY_MS = 150;
const POINTER_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove'];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// 숨은 요소(hidden 안쪽이나 화면에 안 그려진 것)는 대상으로 치지 않는다.
function isShown(node) {
  return node.getClientRects().length > 0 && !node.closest('[hidden]');
}

// 탭 칸 안에서 위아래로만 굴려 대상을 보이게 한다. scrollIntoView는 가로 칸(#pager)까지 밀어 탭이 어긋난다.
function revealInPane(node) {
  const pane = node.closest('.pane');
  if (!pane) return;
  const box = node.getBoundingClientRect();
  const view = pane.getBoundingClientRect();
  if (box.top < view.top) pane.scrollTop -= view.top - box.top + RING_PAD * 2;
  else if (box.bottom > view.bottom) pane.scrollTop += box.bottom - view.bottom + RING_PAD * 2;
}

function paddedBox(node) {
  const rect = node.getBoundingClientRect();
  const top = rect.top - RING_PAD;
  const height = rect.height + RING_PAD * 2;
  return { top, bottom: top + height, left: rect.left - RING_PAD, width: rect.width + RING_PAD * 2, height };
}

export function createTour({ goTab }) {
  let root = null;
  let ring;
  let bubble;
  let count;
  let text;
  let nextButton;
  let running = false;
  let index = 0;
  let target = null;
  let moveTimer = 0;
  let advanceTimer = 0;

  function build() {
    root = el('div', 'tour');
    root.hidden = true;
    ring = el('div', 'tour-ring');
    bubble = el('div', 'tour-bubble');
    bubble.setAttribute('role', 'dialog');
    bubble.setAttribute('aria-live', 'polite');
    count = el('p', 'tour-count');
    text = el('p', 'tour-text');
    const buttons = el('div', 'tour-buttons');
    const skipButton = el('button', 'text-button tour-skip', '건너뛰기');
    skipButton.type = 'button';
    nextButton = el('button', 'tour-next', '다음');
    nextButton.type = 'button';
    buttons.append(skipButton, nextButton);
    bubble.append(count, text, buttons);
    root.append(ring, bubble);
    document.body.append(root);
    skipButton.addEventListener('click', finish);
    nextButton.addEventListener('click', next);
  }

  function next() {
    if (index >= TOUR_STEPS.length - 1) return finish();
    return show(index + 1);
  }

  function show(at) {
    index = at;
    const step = TOUR_STEPS[at];
    clearTimeout(moveTimer);
    // 탭이 넘어가는 동안은 말풍선을 숨겨, 지난 문장의 다음 버튼을 누르지 못하게 한다.
    bubble.style.visibility = 'hidden';
    if (step.tab === undefined) return place(step, PLACE_TRIES);
    goTab(step.tab);
    moveTimer = setTimeout(() => place(step, PLACE_TRIES), TAB_SLIDE_MS);
    return undefined;
  }

  function paintRing(box) {
    if (!box) {
      ring.classList.add('full');
      ring.removeAttribute('style');
      return;
    }
    ring.classList.remove('full');
    Object.assign(ring.style, { top: `${box.top}px`, left: `${box.left}px`, width: `${box.width}px`, height: `${box.height}px` });
  }

  function place(step, tries = 0) {
    const found = step.target ? document.querySelector(step.target) : null;
    target = found && isShown(found) ? found : null;
    // 대상이 조금 늦게 그려질 수 있다. 몇 번 더 찾아본 뒤에 가운데 카드로 둔다.
    if (step.target && !target && tries > 0) {
      moveTimer = setTimeout(() => place(step, tries - 1), RETRY_MS);
      return;
    }
    count.textContent = `${index + 1} / ${TOUR_STEPS.length}`;
    // 대상이 없을 때는 누르라는 말 대신 쓰는 문장이 따로 있으면 그걸 쓴다.
    text.textContent = !target && step.fallback ? step.fallback : step.text;
    // 대상이 없으면 가운데 카드로 두고 다음 버튼으로 넘긴다.
    nextButton.hidden = Boolean(target) && Boolean(step.waitClick);
    nextButton.textContent = index === TOUR_STEPS.length - 1 ? '시작하기' : '다음';
    if (target) revealInPane(target);
    const box = target ? paddedBox(target) : null;
    paintRing(box);
    bubble.style.top = `${bubbleTop(box, innerHeight, bubble.offsetHeight)}px`;
    bubble.style.visibility = '';
  }

  // 말풍선과, 눌러야 하는 단계의 대상만 받는다. 앱이 목록을 다시 그리면 잡아 둔 줄이 바뀌니 선택자로 맞춘다.
  function allowed(event) {
    if (bubble.contains(event.target)) return true;
    const step = TOUR_STEPS[index];
    return Boolean(step.waitClick && target && event.target.closest?.(step.target));
  }

  // 밀기·끌기(탭 바, 줄 밀기, 순서 바꾸기)도 막는다. 누름만 막으면 투어가 엉뚱한 탭으로 갈 수 있다.
  function onPointer(event) {
    if (allowed(event)) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function onClick(event) {
    if (bubble.contains(event.target)) return;
    if (allowed(event)) {
      // 앱의 누름 처리가 먼저 돌도록 다음 틱에 넘어간다.
      clearTimeout(advanceTimer);
      advanceTimer = setTimeout(next, 0);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  function onResize() {
    place(TOUR_STEPS[index]);
  }

  function start() {
    if (running) return;
    if (!root) build();
    running = true;
    root.hidden = false;
    document.addEventListener('click', onClick, true);
    for (const type of POINTER_EVENTS) document.addEventListener(type, onPointer, true);
    addEventListener('resize', onResize);
    show(0);
  }

  function finish() {
    if (!running) return;
    running = false;
    clearTimeout(moveTimer);
    clearTimeout(advanceTimer);
    document.removeEventListener('click', onClick, true);
    for (const type of POINTER_EVENTS) document.removeEventListener(type, onPointer, true);
    removeEventListener('resize', onResize);
    writeLocal(TOUR_DONE_KEY, '1');
    root.hidden = true;
    goTab(0);
  }

  return { start };
}
