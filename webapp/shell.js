// 탭 넘김, 미니·전체 플레이어 열고 닫기. #pager는 overflow: hidden이라 밀어서는 탭이 바뀌지 않는다.
import { haptic } from './haptic.js';
import { $ } from './dom.js';
import { moodFor, tabFromScroll, indicatorX } from './ui-logic.js';

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createShell({ onTab = () => {} } = {}) {
  const app = $('app');
  const pager = $('pager');
  const indicator = $('tab-ind');
  const player = $('player');
  const buttons = [...document.querySelectorAll('nav#tabs button.tab')];
  const panes = [...pager.querySelectorAll('.pane')];

  // 화면에 그린 칸 번호. 스크롤 이벤트로만 바뀐다.
  let current = 0;
  // 탭 버튼으로 고른 칸. 포커스 때문에 브라우저가 칸을 밀면 여기로 되돌린다.
  let target = 0;
  let moving = false;

  // 스크롤 위치에 맞춰 알약, aria-current, 칸 투명도·크기를 그린다. 바뀐 칸 번호를 돌려준다.
  function paint() {
    const width = pager.clientWidth;
    const pos = width ? pager.scrollLeft / width : 0;
    const at = tabFromScroll(pager.scrollLeft, width, buttons.length);
    const tabWidth = buttons[0]?.offsetWidth ?? 0;
    if (!tabWidth) return tabFromScroll(pager.scrollLeft, width, buttons.length);

    indicator.style.width = `${tabWidth}px`;
    indicator.style.transform = `translateX(${indicatorX(pager.scrollLeft, width, tabWidth)}px)`;
    buttons.forEach((button, i) => {
      if (i === at) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    panes.forEach((pane, i) => {
      const d = Math.min(1, Math.abs(pos - i));
      pane.style.opacity = String(1 - d * 0.5);
      pane.style.transform = `scale(${1 - d * 0.05})`;
    });
    return at;
  }

  function onScroll() {
    if (Math.abs(pager.scrollLeft - target * pager.clientWidth) < 1) moving = false;
    const at = paint();
    if (at === current) return;
    current = at;
    setInert();
    onTab(at);
  }

  // 보이지 않는 칸은 키보드 포커스와 스크린리더에서 뺀다.
  function setInert() {
    panes.forEach((pane, i) => { pane.inert = i !== current; });
  }

  function goTab(i) {
    const at = Math.min(buttons.length - 1, Math.max(0, i));
    if (at !== target) haptic.tick();
    target = at;
    moving = !reducedMotion() && Math.abs(pager.scrollLeft - at * pager.clientWidth) >= 1;
    pager.scrollTo({ left: at * pager.clientWidth, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  // 탭 바 위에서 손가락을 좌우로 밀면 알약과 화면이 손가락을 따라오고, 떼면 가장 가까운 탭에 맞춰진다.
  let slid = false;
  function enableTabSlide() {
    const nav = $('tabs');
    const SLIDE_START = 8; // 이만큼 옆으로 움직여야 밀기로 본다. 그 전에 떼면 그냥 누른 것이다.
    let startX = null;
    let sliding = false;
    let shown = -1;
    const posAt = (x) => {
      const rect = buttons[0].getBoundingClientRect();
      const raw = (x - rect.left - rect.width / 2) / rect.width;
      return Math.min(buttons.length - 1, Math.max(0, raw));
    };
    nav.addEventListener('pointerdown', (event) => {
      if (!event.isPrimary) return;
      startX = event.clientX;
      sliding = false;
      slid = false;
    });
    nav.addEventListener('pointermove', (event) => {
      if (startX === null) return;
      if (!sliding) {
        if (Math.abs(event.clientX - startX) < SLIDE_START) return;
        sliding = true;
        shown = current;
        // 손가락이 바 밖으로 나가도 계속 따라오게 잡는다. 잡을 수 없는 포인터면 그냥 둔다.
        try { nav.setPointerCapture(event.pointerId); } catch { /* 이미 끝난 포인터 */ }
      }
      const pos = posAt(event.clientX);
      target = Math.round(pos);
      moving = false;
      pager.scrollLeft = pos * pager.clientWidth;
      if (target !== shown) {
        shown = target;
        haptic.tick();
      }
    });
    const end = (event) => {
      if (startX === null) return;
      startX = null;
      if (!sliding) return;
      sliding = false;
      slid = true;
      // 손을 떼면 click이 안 오는 경우(캡처 등)도 있어 잠시 뒤 표시를 푼다.
      setTimeout(() => { slid = false; }, 400);
      goTab(Math.round(posAt(event.clientX)));
    };
    nav.addEventListener('pointerup', end);
    nav.addEventListener('pointercancel', end);
  }

  function setMood(trackId) {
    const [m1, m2, m3] = moodFor(trackId);
    app.style.setProperty('--m1', m1);
    app.style.setProperty('--m2', m2);
    app.style.setProperty('--m3', m3);
  }

  function openPlayer() {
    player.classList.add('open');
    player.setAttribute('aria-hidden', 'false');
  }

  function closePlayer() {
    player.classList.remove('open');
    player.setAttribute('aria-hidden', 'true');
  }

  buttons.forEach((button) => button.addEventListener('click', (event) => {
    // 밀어서 고른 직후 따라오는 click은 무시한다. 손을 뗀 자리로 이미 갔다.
    if (slid) {
      event.preventDefault();
      slid = false;
      return;
    }
    goTab(Number(button.dataset.tab));
  }));
  enableTabSlide();
  pager.addEventListener('scroll', onScroll, { passive: true });
  // 창 크기가 바뀌면 지금 칸으로 다시 맞춘다.
  addEventListener('resize', () => {
    pager.scrollLeft = target * pager.clientWidth;
    paint();
  });
  pager.addEventListener('focusin', () => requestAnimationFrame(() => {
    if (!moving) pager.scrollLeft = target * pager.clientWidth;
  }));
  $('mini-open').addEventListener('click', openPlayer);
  $('player-close').addEventListener('click', closePlayer);

  current = paint();
  setInert();

  return {
    goTab,
    tab: () => current,
    openPlayer,
    closePlayer,
    isPlayerOpen: () => player.classList.contains('open'),
    setMood,
  };
}
