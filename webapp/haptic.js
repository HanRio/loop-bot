// 아이폰 진동. 텔레그램 미니앱의 HapticFeedback을 쓰고, 텔레그램 밖(브라우저)에서는 아무 일도 하지 않는다.
const feedback = () => window.Telegram?.WebApp?.HapticFeedback;

function run(fn) {
  try {
    fn(feedback());
  } catch {
    // 진동을 지원하지 않는 옛 텔레그램은 조용히 넘어간다. 진동이 없어도 동작은 같다.
  }
}

export const haptic = {
  tap: () => run((f) => f?.impactOccurred('light')),
  tick: () => run((f) => f?.selectionChanged()),
  warning: () => run((f) => f?.notificationOccurred('warning')),
  error: () => run((f) => f?.notificationOccurred('error')),
};
