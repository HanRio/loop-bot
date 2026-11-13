// 시트 손잡이: 모든 아래 시트(.menu, .template-dialog) 위에 손잡이를 달고, 손잡이나 제목을 끌어내리면 닫는다.
import { sheetFollow, shouldCloseSheet } from './gesture-logic.js';

const SHEETS = 'dialog.menu, dialog.template-dialog';
const CLOSE_MS = 220;

function addGrabber(dialog) {
  if (!dialog.matches?.(SHEETS) || dialog.querySelector(':scope > .grabber')) return;
  const grabber = document.createElement('div');
  grabber.className = 'grabber';
  grabber.setAttribute('aria-hidden', 'true');
  dialog.prepend(grabber);
}

function startDrag(event) {
  const handle = event.target.closest?.('.grabber, dialog > h2');
  const sheet = handle?.closest(SHEETS);
  if (!sheet?.open || event.button > 0) return;
  const startY = event.clientY;
  let lastY = startY;
  let lastT = event.timeStamp;
  let velocity = 0;
  try {
    sheet.setPointerCapture(event.pointerId);
  } catch {
    // 손가락이 이미 떨어졌으면 붙잡지 못한다. 끌기는 그래도 시트 위에서 이어진다.
  }
  sheet.style.transition = 'none';

  const move = (e) => {
    const dt = Math.max(1, e.timeStamp - lastT);
    velocity = (e.clientY - lastY) / dt;
    lastY = e.clientY;
    lastT = e.timeStamp;
    sheet.style.transform = `translateY(${sheetFollow(e.clientY - startY)}px)`;
  };
  const end = () => {
    sheet.removeEventListener('pointermove', move);
    sheet.removeEventListener('pointerup', end);
    sheet.removeEventListener('pointercancel', end);
    const dy = lastY - startY;
    if (shouldCloseSheet({ dy, velocity, height: sheet.offsetHeight })) {
      sheet.style.transition = `transform ${CLOSE_MS}ms ease-in`;
      sheet.style.transform = `translateY(${sheet.offsetHeight + 40}px)`;
      setTimeout(() => {
        sheet.close();
        sheet.style.transition = '';
        sheet.style.transform = '';
      }, CLOSE_MS);
      return;
    }
    // 덜 끌었으면 제자리로 튕겨 돌아간다.
    sheet.style.transition = 'transform .35s var(--spring)';
    sheet.style.transform = '';
  };
  sheet.addEventListener('pointermove', move);
  sheet.addEventListener('pointerup', end);
  sheet.addEventListener('pointercancel', end);
}

export function enableSheetDrag() {
  document.querySelectorAll(SHEETS).forEach(addGrabber);
  // 메뉴 시트는 열 때마다 새로 만들어 body에 붙는다.
  new MutationObserver((records) => {
    records.forEach((r) => r.addedNodes.forEach(addGrabber));
  }).observe(document.body, { childList: true });
  document.addEventListener('pointerdown', startDrag);
}
