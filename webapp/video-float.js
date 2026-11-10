// 넓은 화면에서 열린 영상 패널을 화면 위에 띄운다. 칸은 제자리에 높이만 잡고, 패널이 그 칸의 자리를 따라간다.
import { floatRect } from './desk-layout.js';

// 스크롤은 안쪽 칸에서도 일어나므로 캡처 단계에서 받는다. 스크롤 막기는 하지 않는다.
const SCROLL_OPTIONS = { capture: true, passive: true };

// 전체 화면에서 텔레그램 상단 버튼 아래에 붙도록 안전 영역만큼 내린다.
function topInset() {
  const tg = window.Telegram?.WebApp;
  return (tg?.safeAreaInset?.top || 0) + (tg?.contentSafeAreaInset?.top || 0);
}

export function createVideoFloat(panel) {
  let slot = null;
  let frame = 0;
  const resize = 'ResizeObserver' in window ? new ResizeObserver(schedule) : null;

  function update() {
    frame = 0;
    if (!slot) return;
    const rect = floatRect(slot.getBoundingClientRect(), innerHeight, topInset());
    slot.style.height = `${rect.height}px`;
    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    panel.style.width = `${rect.width}px`;
  }

  // 한 프레임에 한 번만 맞춘다.
  function schedule() {
    if (!frame) frame = requestAnimationFrame(update);
  }

  function detach() {
    slot = null;
    panel.classList.remove('floating');
    panel.style.left = '';
    panel.style.top = '';
    panel.style.width = '';
    resize?.disconnect();
    window.removeEventListener('scroll', schedule, SCROLL_OPTIONS);
    window.removeEventListener('resize', schedule);
  }

  function attach(next) {
    if (!next) {
      detach();
      return;
    }
    if (next !== slot) {
      slot = next;
      resize?.disconnect();
      resize?.observe(next);
    }
    panel.classList.add('floating');
    window.addEventListener('scroll', schedule, SCROLL_OPTIONS);
    window.addEventListener('resize', schedule);
    schedule();
  }

  return { attach };
}
