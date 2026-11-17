// 재생 1회를 센다. 실제로 흘러간 재생 시간만 쌓고, 곡 길이의 99%에 닿으면 한 번 알린다.
// 위치가 실제 시간보다 빨리 움직인 만큼(넘기기·seek)은 쌓지 않는다.
export const PLAY_THRESHOLD = 0.99;
// 연습 탭의 가장 빠른 속도보다 넉넉하게. 이보다 빨리 움직이면 넘긴 것으로 본다.
const MAX_RATE = 2;
// timeupdate 간격이 흔들리는 만큼 봐준다(초).
const SLACK_SEC = 0.25;

export function createPlayCounter({ onCount }) {
  let trackId = null;
  let heard = 0;
  let counted = false;
  let last = null; // { pos, at }

  function restart() {
    heard = 0;
    counted = false;
    last = null;
  }

  // 재생 중에 위치를 받을 때마다 부른다. at은 밀리초 시계.
  function sample(id, pos, duration, at) {
    if (id !== trackId) {
      trackId = id;
      restart();
    }
    if (last !== null) {
      const moved = pos - last.pos;
      const allowed = ((at - last.at) / 1000) * MAX_RATE + SLACK_SEC;
      if (moved > 0 && moved <= allowed) heard += moved;
    }
    last = { pos, at };
    if (!counted && duration > 0 && heard >= duration * PLAY_THRESHOLD) {
      counted = true;
      onCount(id);
    }
  }

  // 멈추면 다음 위치와 잇지 않는다. 멈춘 동안 흐른 시간을 재생으로 치지 않게.
  const pause = () => { last = null; };

  return { sample, pause, restart };
}
