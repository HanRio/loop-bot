// 가사 집중 화면. 플레이어에서 살짝 내리면 가사가 커지고 조작부는 작은 줄로 줄어든다. 살짝 올리면 돌아온다.
// 두 상태 사이에 멈추지 않고 '탁' 넘어가며, 넘어갈 때마다 '도로록' 진동이 온다.
import { $ } from './dom.js';
import { haptic } from './haptic.js';
import { focusSwipe } from './gesture-logic.js';

const ROLL_TICKS = 3;
const ROLL_GAP_MS = 45;
const WHEEL_IDLE_MS = 160; // 휠·트랙패드가 이만큼 멈추면 한 번의 밀기가 끝난 것으로 본다
const NO_SWIPE = '.scrub, input[type=range]';

const roll = () => {
  for (let i = 0; i < ROLL_TICKS; i += 1) setTimeout(haptic.tick, i * ROLL_GAP_MS);
};

export function createLyricsFocus() {
  const player = $('player');
  const body = $('player-body');
  const button = $('lyrics');
  const lines = () => player.querySelector('.lyr-lines');
  let focused = false;

  function set(on, { quiet = false } = {}) {
    if ((on && button.disabled) || on === focused) return;
    focused = on;
    player.classList.toggle('lyr-focus', on);
    button.setAttribute('aria-pressed', String(on));
    if (!quiet) roll();
  }

  // 가사 줄 위에서 시작한 밀기는 가사가 맨 위일 때만 돌아가기로 본다.
  const atTop = (target) => !target.closest('.lyr-lines') || lines().scrollTop <= 1;

  let startY = null;
  let startAtTop = true;
  body.addEventListener('touchstart', (event) => {
    const multi = event.touches.length !== 1;
    startY = multi || event.target.closest(NO_SWIPE) ? null : event.touches[0].clientY;
    startAtTop = atTop(event.target);
  }, { passive: true });
  body.addEventListener('touchmove', (event) => {
    if (startY === null) return;
    const next = focusSwipe({ dy: startY - event.touches[0].clientY, focused, linesAtTop: startAtTop });
    if (next === null) return;
    startY = null; // 한 번 밀 때 한 번만 넘어간다
    set(next);
  }, { passive: true });

  let wheelSum = 0;
  let wheelAtTop = true;
  let wheelDone = false;
  let wheelTimer = 0;
  body.addEventListener('wheel', (event) => {
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => { wheelSum = 0; wheelDone = false; }, WHEEL_IDLE_MS);
    if (wheelDone) return;
    if (wheelSum === 0) wheelAtTop = atTop(event.target);
    wheelSum += event.deltaY;
    const next = focusSwipe({ dy: wheelSum, focused, linesAtTop: wheelAtTop });
    if (next === null) return;
    wheelDone = true;
    set(next);
  }, { passive: true });

  // 아래에 살짝 보이는 '가사' 손잡이를 눌러도 넘어간다.
  $('lyr-sheet').addEventListener('click', () => { if (!focused) set(true); });
  // 열 때는 늘 플레이어 조작부부터 보여 준다.
  $('mini-open').addEventListener('click', () => set(false, { quiet: true }));

  return { toggle: () => set(!focused) };
}
