// 잦은 변경을 모아 한 번에 저장한다. 저장이 실패하면 값을 붙잡고 다시 시도한다.

const RETRY_DELAY_MS = 3000;

export function createSaver(
  save,
  { delayMs = 500, onError = () => {}, onSaved = () => {}, setTimer = setTimeout, clearTimer = clearTimeout } = {},
) {
  let latest;
  let dirty = false;
  let retrying = false;
  let inFlight = null;
  let timer = null;

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

  function attempt() {
    const value = latest;
    dirty = false;
    retrying = false;
    inFlight = save(value).then(
      () => {
        inFlight = null;
        onSaved(value);
        if (dirty) schedule(delayMs);
      },
      (err) => {
        inFlight = null;
        // 실패한 값은 버리지 않는다. 대기 중 update가 오면 그 값으로 바뀐다.
        dirty = true;
        retrying = true;
        onError(err);
        schedule(RETRY_DELAY_MS);
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

  async function flush() {
    if (inFlight) await inFlight;
    cancelScheduled();
    // 실패해도 reject하지 않는다. 호출한 쪽이 기다리다 멈추지 않게 하고, 값은 pending으로 남긴다.
    if (dirty) await attempt();
  }

  return {
    update,
    flush,
    pending: () => dirty || inFlight !== null,
  };
}
