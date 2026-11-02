// 잦은 변경을 모아 한 번에 저장한다. 저장이 실패하면 값을 붙잡고 다시 시도한다.

const RETRY_DELAY_MS = 3000;

// 콜백이 던져도 저장 흐름은 멈추지 않는다. 예외는 콘솔에 남긴다.
function notify(callback, arg) {
  try {
    callback(arg);
  } catch (err) {
    console.error(err);
  }
}

export function createSaver(
  save,
  { delayMs = 500, onError = () => {}, onSaved = () => {}, setTimer = setTimeout, clearTimer = clearTimeout } = {},
) {
  let latest;
  let dirty = false;
  let retrying = false;
  let inFlight = null;
  let timer = null;
  // cancel할 때마다 올린다. 옛 요청이 끝나도 그 결과는 상태를 건드리지 않는다.
  let generation = 0;

  function cancelScheduled() {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  function schedule(ms) {
    cancelScheduled();
    timer = setTimer(() => {
      timer = null;
      attempt();
    }, ms);
  }

  // 결과는 항상 resolve된다. true면 저장 성공, false면 실패(값은 dirty로 남는다).
  function attempt() {
    const value = latest;
    const mine = generation;
    dirty = false;
    retrying = false;
    // Promise executor 안에서 부르면 save의 동기 throw도 거부로 바뀐다.
    inFlight = new Promise((resolve) => resolve(save(value))).then(
      () => {
        if (mine !== generation) return true;
        inFlight = null;
        if (dirty) schedule(delayMs);
        notify(onSaved, value);
        return true;
      },
      (err) => {
        if (mine !== generation) return false;
        inFlight = null;
        // 실패한 값은 버리지 않는다. 대기 중 update가 오면 그 값으로 바뀐다.
        dirty = true;
        retrying = true;
        // 재시도 예약을 콜백보다 먼저 한다. 콜백이 던져도 재시도는 남는다.
        schedule(RETRY_DELAY_MS);
        notify(onError, err);
        return false;
      },
    );
    return inFlight;
  }

  function update(value) {
    latest = value;
    dirty = true;
    // 재시도 대기 중에는 타이머를 건드리지 않는다. 재시도 시각을 미루지 않기 위해서다.
    if (inFlight === null && !retrying) schedule(delayMs);
  }

  // 저장 중이면 기다리고, 그 뒤 새 값이 남아 있으면 한 번 더 저장한다. 실패하면 거기서 멈춘다.
  // 실패해도 reject하지 않는다. 호출한 쪽이 기다리다 멈추지 않게 하고, 값은 pending으로 남긴다.
  async function flush() {
    let ok = true;
    while (ok && (inFlight !== null || dirty)) {
      if (inFlight !== null) {
        ok = await inFlight;
      } else {
        cancelScheduled();
        ok = await attempt();
      }
    }
  }

  // 대기 중인 값과 재시도를 모두 버린다. 이미 나간 요청은 끝나도 무시한다.
  function cancel() {
    generation += 1;
    cancelScheduled();
    latest = undefined;
    dirty = false;
    retrying = false;
    inFlight = null;
  }

  return {
    update,
    flush,
    cancel,
    pending: () => dirty || inFlight !== null,
  };
}
