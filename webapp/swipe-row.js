// 밀어서 지우기: 줄을 왼쪽으로 밀면 오른쪽에 빨간 버튼이 나온다. 한 번에 한 줄만 열린다.
import { swipeFollow, swipeSettle } from './gesture-logic.js';
import { haptic } from './haptic.js';

const ACTION_WIDTH = 88;
const DECIDE = 8; // 이만큼 움직이면 가로 밀기인지 세로 스크롤인지 정한다

let openRow = null;

function setX(li, x, animate) {
  li.classList.toggle('settling', animate);
  li.style.setProperty('--sx', `${x}px`);
  li.dataset.sx = String(x);
}

function closeOpen() {
  if (openRow) setX(openRow, 0, true);
  openRow = null;
}

export function swipeable(li, { label, onAction }) {
  li.classList.add('swipe');
  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'swipe-act';
  action.textContent = label;
  action.tabIndex = -1; // 키보드는 ⋯ 메뉴로 같은 일을 한다
  action.addEventListener('click', (event) => {
    event.stopPropagation();
    closeOpen();
    onAction();
  });
  li.append(action);

  li.addEventListener('pointerdown', (event) => {
    if (event.button > 0 || event.target.closest('.drag, .swipe-act')) return;
    if (openRow && openRow !== li) closeOpen();
    const startX = event.clientX;
    const startY = event.clientY;
    const base = Number(li.dataset.sx || 0);
    let mode = null; // 'swipe' | 'scroll'
    let x = base;
    let lastX = startX;
    let lastT = event.timeStamp;
    let velocity = 0;
    let wasPast = base <= -ACTION_WIDTH / 2;

    const move = (e) => {
      const dx = e.clientX - startX;
      if (!mode) {
        if (Math.abs(dx) < DECIDE && Math.abs(e.clientY - startY) < DECIDE) return;
        mode = Math.abs(dx) > Math.abs(e.clientY - startY) ? 'swipe' : 'scroll';
        if (mode === 'swipe') {
          try {
            li.setPointerCapture(e.pointerId);
          } catch {
            // 손가락이 이미 떨어졌으면 붙잡지 못한다. 밀기는 그래도 줄 위에서 이어진다.
          }
        }
      }
      if (mode !== 'swipe') return;
      velocity = (e.clientX - lastX) / Math.max(1, e.timeStamp - lastT);
      lastX = e.clientX;
      lastT = e.timeStamp;
      x = swipeFollow(base + dx, ACTION_WIDTH);
      const isPast = x <= -ACTION_WIDTH / 2;
      if (isPast !== wasPast) haptic.tick();
      wasPast = isPast;
      setX(li, x, false);
    };
    const end = () => {
      li.removeEventListener('pointermove', move);
      li.removeEventListener('pointerup', end);
      li.removeEventListener('pointercancel', end);
      if (mode !== 'swipe') return;
      const settled = swipeSettle({ x, velocity, width: ACTION_WIDTH });
      setX(li, settled, true);
      openRow = settled === 0 ? null : li;
      // 밀기가 끝난 손가락의 click(재생)은 막는다.
      li.addEventListener('click', (e) => e.stopImmediatePropagation(), { capture: true, once: true });
    };
    li.addEventListener('pointermove', move);
    li.addEventListener('pointerup', end);
    li.addEventListener('pointercancel', end);
  });

  // 열린 줄을 누르면 재생하지 않고 닫기만 한다.
  li.addEventListener('click', (event) => {
    if (li !== openRow || event.target === action) return;
    event.stopImmediatePropagation();
    closeOpen();
  }, { capture: true });
  return li;
}
