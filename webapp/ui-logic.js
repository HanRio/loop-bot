// 새 화면이 쓰는 순수 계산. DOM을 건드리지 않는다.

// 시안 SONGS의 m 다섯 벌. 곡 번호로 골라 쓴다.
export const MOOD_PALETTES = [
  ['#F6C9A8', '#FBE3B8', '#F3A9B4'],
  ['#FBD98C', '#FCEFC4', '#F6B98E'],
  ['#9CC4F2', '#C9D9F5', '#B8E0EC'],
  ['#A8DCCB', '#D3EEE4', '#9FCFE0'],
  ['#C3BDEB', '#E2DEF5', '#A9C4EE'],
];

export const SPEEDS = [0.75, 0.9, 1, 1.1];

export function moodFor(trackId) {
  return MOOD_PALETTES[Math.abs(trackId) % MOOD_PALETTES.length];
}

// 밀린 위치를 가장 가까운 칸으로 바꾼다. 범위 밖이면 양 끝 칸.
export function tabFromScroll(scrollLeft, width, count) {
  if (!width) return 0;
  const index = Math.round(scrollLeft / width);
  return Math.min(count - 1, Math.max(0, index));
}

export function indicatorX(scrollLeft, width, tabWidth) {
  return width ? (scrollLeft / width) * tabWidth : 0;
}

// 구간 반복: 끝(b)에 닿으면 시작(a)으로 돌아간다.
export function loopCheck(position, loop) {
  if (!loop || loop.b <= loop.a) return null;
  return position >= loop.b ? loop.a : null;
}

// 묵상 화면이 처음 보여 줄 곡. 고른 곡 → 지금 곡 → 첫 곡 순서로 찾는다.
export function meditateTrack({ chosenId, currentId, trackIds }) {
  if (trackIds.includes(chosenId)) return chosenId;
  if (trackIds.includes(currentId)) return currentId;
  return trackIds[0] ?? null;
}
