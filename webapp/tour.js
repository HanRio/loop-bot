// 첫 방문 안내 창. 대상 주변만 밝히고 말풍선을 붙인다. 대상을 눌러야 하는 단계는 그 누름을 받아 다음으로 넘어간다.
import { askConfirm } from './menus.js';
import { writeLocal } from './store.js';
import { TOUR_DONE_KEY, TOUR_STEPS, bubbleTop } from './tour-logic.js';

// 탭이 옮겨 가는 시간(미끄러짐)이 끝난 뒤에 잰다.
const TAB_SLIDE_MS = 550;
const RING_PAD = 6;
const PLACE_TRIES = 3;
const RETRY_MS = 150;
// 눌러야 하는 단계는 대상과 말풍선 사이에 화살표 자리를 둔다.
const ARROW_GAP = 44;
const ARROW_SIZE = 28;
const POINTER_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove'];
const SKIP_CONFIRM = { message: '안내를 끝낼까요? 설정의 ‘사용법 다시 보기’에서 언제든 다시 볼 수 있어요.', action: '끝내기' };
const SVG_NS = 'http://www.w3.org/2000/svg';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// 위를 가리키는 화살표. 아래를 가리킬 때는 CSS로 뒤집는다.
function arrowIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M12 20V5M5.5 11.5L12 5l6.5 6.5');
  svg.append(path);
  return svg;
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
  let arrow;
  let bubble;
  let count;
  let text;
  let skipButton;
  let nextButton;
  let running = false;
  let confirming = false;
  let index = 0;
  let target = null;
  let moveTimer = 0;
  let advanceTimer = 0;
  let watchedDialog = null;

  function build() {
    root = el('div', 'tour');
    root.hidden = true;
    // 맨 위 층(top layer)에 올려 플리 고르기 창 위에도 말풍선이 보이게 한다. 못 쓰는 브라우저는 z-index로 둔다.
    if (root.showPopover) root.setAttribute('popover', 'manual');
    ring = el('div', 'tour-ring');
    arrow = el('div', 'tour-arrow');
    arrow.append(arrowIcon());
    bubble = el('div', 'tour-bubble');
    bubble.setAttribute('role', 'dialog');
    bubble.setAttribute('aria-live', 'polite');
    bubble.setAttribute('aria-label', '사용법 안내');
    const top = el('div', 'tour-top');
    count = el('p', 'tour-count');
    // 무심코 누르지 않게 작게, 엄지가 닿는 아래쪽이 아닌 위 구석에 둔다. 눌러도 한 번 더 묻는다.
    skipButton = el('button', 'tour-skip', '안내 그만 보기');
    skipButton.type = 'button';
    top.append(count, skipButton);
    text = el('p', 'tour-text');
    nextButton = el('button', 'tour-next', '다음');
    nextButton.type = 'button';
    bubble.append(top, text, nextButton);
    root.append(ring, arrow, bubble);
    document.body.append(root);
    skipButton.addEventListener('click', onSkip);
    nextButton.addEventListener('click', next);
  }

  // 새로 열린 창보다 위에 오도록 맨 위 층에 다시 올린다.
  function raise() {
    if (!root.showPopover) return;
    if (root.matches(':popover-open')) root.hidePopover();
    root.showPopover();
  }

  async function onSkip() {
    if (confirming) return;
    confirming = true;
    const ok = await askConfirm(SKIP_CONFIRM);
    confirming = false;
    if (ok) finish();
  }

  function next() {
    if (index >= TOUR_STEPS.length - 1) return finish();
    return show(index + 1);
  }

  function stopWatchingDialog() {
    watchedDialog?.removeEventListener('close', onDialogClose);
    watchedDialog = null;
  }

  function onDialogClose() {
    stopWatchingDialog();
    clearTimeout(advanceTimer);
    advanceTimer = setTimeout(next, 0);
  }

  function show(at) {
    index = at;
    const step = TOUR_STEPS[at];
    clearTimeout(moveTimer);
    stopWatchingDialog();
    // 화면이 옮겨 가는 동안은 말풍선을 숨겨, 지난 문장의 다음 버튼을 누르지 못하게 한다.
    bubble.style.visibility = 'hidden';
    arrow.hidden = true;
    if (step.tab !== undefined) goTab(step.tab);
    const delay = step.tab !== undefined ? TAB_SLIDE_MS : (step.wait ?? 0);
    if (!delay) return place(step, PLACE_TRIES);
    moveTimer = setTimeout(() => place(step, PLACE_TRIES), delay);
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

  // 화살표는 대상과 말풍선 사이에서 대상을 가리킨다. 말풍선이 아래에 있으면 위를, 위에 있으면 아래를 향한다.
  // 곡 줄처럼 넓은 대상은 줄 가운데 대신 곡 제목 끝을 가리킨다.
  function paintArrow(box, bubbleY) {
    const pointsUp = bubbleY >= box.bottom;
    // 제목 칸(b)은 줄 끝까지 늘어나 있으니 글자가 차지한 폭만 잰다.
    const title = target.querySelector('.t b');
    let aim = null;
    if (title) {
      const range = document.createRange();
      range.selectNodeContents(title);
      aim = range.getBoundingClientRect();
    }
    // 바로 아래 줄의 제목과 겹치지 않게 제목 끝 오른쪽에 둔다.
    const centerX = aim ? aim.right + 24 : box.left + box.width / 2;
    const x = Math.min(innerWidth - ARROW_SIZE - 8, Math.max(8, centerX - ARROW_SIZE / 2));
    const y = pointsUp ? box.bottom + 6 : box.top - 6 - ARROW_SIZE;
    arrow.classList.toggle('down', !pointsUp);
    Object.assign(arrow.style, { left: `${x}px`, top: `${y}px` });
    arrow.hidden = false;
  }

  function place(step, tries = 0) {
    const found = step.target ? document.querySelector(step.target) : null;
    target = found && isShown(found) ? found : null;
    // 대상이 조금 늦게 그려질 수 있다. 몇 번 더 찾아본 뒤에 가운데 카드로 둔다.
    if (step.target && !target && tries > 0) {
      moveTimer = setTimeout(() => place(step, tries - 1), RETRY_MS);
      return;
    }
    const waiting = Boolean(target) && Boolean(step.waitClick || step.waitClose);
    if (target && step.waitClose && target.tagName === 'DIALOG' && watchedDialog !== target) {
      stopWatchingDialog();
      watchedDialog = target;
      watchedDialog.addEventListener('close', onDialogClose);
    }
    if (document.querySelector('dialog[open]')) raise();
    count.textContent = `${index + 1} / ${TOUR_STEPS.length}`;
    // 대상이 없을 때는 누르라는 말 대신 쓰는 문장이 따로 있으면 그걸 쓴다.
    text.textContent = !target && step.fallback ? step.fallback : step.text;
    // 눌러 봐야 하는 단계는 다음 버튼 대신 화살표로 대상을 가리킨다.
    nextButton.hidden = waiting;
    nextButton.textContent = index === TOUR_STEPS.length - 1 ? '시작하기' : '다음';
    // 플리 고르기 창이 떠 있으면 그 창이 화면을 막으니 그만 보기도 감춘다.
    skipButton.hidden = Boolean(step.waitClose && target);
    if (target) revealInPane(target);
    const box = target ? paddedBox(target) : null;
    paintRing(box);
    const pointing = Boolean(box) && Boolean(step.waitClick);
    const y = bubbleTop(box, innerHeight, bubble.offsetHeight, pointing ? ARROW_GAP : 12);
    bubble.style.top = `${y}px`;
    if (pointing) paintArrow(box, y);
    else arrow.hidden = true;
    bubble.style.visibility = '';
  }

  // 말풍선, 열린 창(확인 창, 플리 고르기), 눌러야 하는 단계의 대상만 받는다.
  // 앱이 목록을 다시 그리면 잡아 둔 줄이 바뀌니 선택자로 맞춘다.
  function allowed(event) {
    if (bubble.contains(event.target)) return true;
    if (event.target.closest?.('dialog[open]')) return true;
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
    if (bubble.contains(event.target) || event.target.closest?.('dialog[open]')) return;
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
    raise();
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
    stopWatchingDialog();
    document.removeEventListener('click', onClick, true);
    for (const type of POINTER_EVENTS) document.removeEventListener(type, onPointer, true);
    removeEventListener('resize', onResize);
    writeLocal(TOUR_DONE_KEY, '1');
    if (root.showPopover && root.matches(':popover-open')) root.hidePopover();
    root.hidden = true;
    goTab(0);
  }

  return { start };
}
