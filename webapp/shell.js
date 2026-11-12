// 탭 넘김, 미니·전체 플레이어 열고 닫기. #pager는 overflow: hidden이라 밀어서는 탭이 바뀌지 않는다.
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
    target = at;
    moving = !reducedMotion() && Math.abs(pager.scrollLeft - at * pager.clientWidth) >= 1;
    pager.scrollTo({ left: at * pager.clientWidth, behavior: reducedMotion() ? 'auto' : 'smooth' });
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

  buttons.forEach((button) => button.addEventListener('click', () => goTab(Number(button.dataset.tab))));
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
