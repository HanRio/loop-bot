// 손가락 움직임 판단. 화면을 건드리지 않는 순수 함수라 테스트에서 바로 부른다.
const SHEET_CLOSE_MAX = 140; // 이만큼 끌어내리면 닫는다 (시트가 작으면 높이의 30%)
const SHEET_CLOSE_RATIO = 0.3;
const FLICK_SPEED = 0.5; // px/ms. 이보다 빠르게 튕기면 짧게 끌어도 닫는다
const FLICK_MIN = 24;
const UP_RESIST = 4; // 위로 끌면 1/4만 따라온다
const SWIPE_STRETCH = 3; // 버튼 폭을 넘으면 1/3만 따라온다
const SWIPE_FLICK = 0.4;

export const sheetFollow = (dy) => (dy < 0 ? dy / UP_RESIST : dy);

export function shouldCloseSheet({ dy, velocity, height }) {
  if (dy >= Math.min(SHEET_CLOSE_MAX, height * SHEET_CLOSE_RATIO)) return true;
  return velocity > FLICK_SPEED && dy > FLICK_MIN;
}

export function swipeFollow(x, width) {
  if (x >= 0) return 0;
  if (x >= -width) return x;
  return -width + (x + width) / SWIPE_STRETCH;
}

export function swipeSettle({ x, velocity, width }) {
  if (velocity < -SWIPE_FLICK) return -width;
  if (velocity > SWIPE_FLICK) return 0;
  return -x > width / 2 ? -width : 0;
}
