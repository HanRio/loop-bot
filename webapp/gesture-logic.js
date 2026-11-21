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

// 가사 집중 화면 넘김. dy는 내용을 내리는 양(손가락을 위로 밀거나 휠을 아래로 굴리면 +).
// 살짝만 밀어도 넘어가고, 돌아올 때는 가사가 맨 위일 때만 돌아온다(가사를 거슬러 읽는 중이면 가사만 움직인다).
const FOCUS_SWIPE = 24;
export function focusSwipe({ dy, focused, linesAtTop }) {
  if (!focused && dy >= FOCUS_SWIPE) return true;
  if (focused && dy <= -FOCUS_SWIPE && linesAtTop) return false;
  return null;
}
