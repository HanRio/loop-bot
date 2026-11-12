// 곡 줄 제목이 한 줄을 넘으면 처음엔 …으로 줄이고, 잠시 뒤 제목을 왼쪽으로 흘려 끝까지 보여 준다.
// 탭 모듈은 건드리지 않고 #pager 안의 변화를 지켜보며 새 줄마다 붙인다.

const WAIT_MS = 1800;
const END_HOLD_MS = 1200;
const PX_PER_SECOND = 20;
const SELECTOR = '.row .t > b';

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 글자를 따로 떼어 움직이면 폰에서 굵기·크기가 달라 보여서, 제목 칸 자체의 가로 스크롤을 옮긴다.
function slide(title, over) {
  const duration = (over / PX_PER_SECOND) * 1000;
  return new Promise((resolve) => {
    const start = performance.now();
    const step = (now) => {
      if (!title.isConnected) return resolve();
      const t = Math.min(1, (now - start) / duration);
      title.scrollLeft = over * t;
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

async function cycle(title) {
  while (title.isConnected) {
    await sleep(WAIT_MS);
    const over = title.scrollWidth - title.clientWidth;
    if (!title.isConnected) return;
    if (over <= 0 || reducedMotion()) continue;
    title.classList.add('run');
    await slide(title, over);
    await sleep(END_HOLD_MS);
    title.scrollLeft = 0;
    title.classList.remove('run');
  }
}

function attach(title) {
  if (title.dataset.scroll) return;
  title.dataset.scroll = '1';
  cycle(title);
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
