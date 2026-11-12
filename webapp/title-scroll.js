// 곡 줄 제목이 한 줄을 넘으면 처음엔 …으로 줄이고, 잠시 뒤 제목을 왼쪽으로 흘려 끝까지 보여 준다.
// 탭 모듈은 건드리지 않고 #pager 안의 변화를 지켜보며 새 줄마다 붙인다.

const WAIT_MS = 1800;
const END_HOLD_MS = 1200;
const PX_PER_SECOND = 40;
const SELECTOR = '.row .t > b';

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function cycle(title, text) {
  while (title.isConnected) {
    await sleep(WAIT_MS);
    const over = title.scrollWidth - title.clientWidth;
    if (!title.isConnected) return;
    if (over <= 0 || reducedMotion()) continue;
    title.classList.add('run');
    const moving = (over / PX_PER_SECOND) * 1000;
    const total = moving + END_HOLD_MS;
    const shift = `translateX(${-over}px)`;
    await text.animate(
      [{ transform: 'translateX(0)' }, { transform: shift, offset: moving / total }, { transform: shift }],
      { duration: total, easing: 'linear' },
    ).finished.catch(() => {});
    title.classList.remove('run');
  }
}

function attach(title) {
  if (title.dataset.scroll) return;
  title.dataset.scroll = '1';
  const text = document.createElement('span');
  text.textContent = title.textContent;
  title.replaceChildren(text);
  cycle(title, text);
}

export function initTitleScroll(root) {
  let queued = false;
  const scan = () => {
    queued = false;
    root.querySelectorAll(SELECTOR).forEach(attach);
  };
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(scan);
  }).observe(root, { childList: true, subtree: true });
  scan();
}
