import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createActiveSender, mergeOrder } from '../../webapp/store.js';

// 저장소 쪽 Promise 연쇄를 한 바퀴 돌린다. 가짜 타이머는 setTimeout만 막으므로 setImmediate는 그대로 돈다.
const settle = () => new Promise((resolve) => setImmediate(resolve));

// 보낸 요청을 하나씩 직접 끝낸다. 동시에 나간 요청 수도 센다.
function controlledSend() {
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const send = (id) =>
    new Promise((resolve, reject) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      calls.push({
        id,
        finish(ok) {
          inFlight -= 1;
          if (ok) resolve();
          else reject(new Error('down'));
        },
      });
    });
  return { send, calls, maxInFlight: () => maxInFlight };
}

test('createActiveSender sends the latest request only and never two at once', async () => {
  const { send, calls, maxInFlight } = controlledSend();
  const sender = createActiveSender(send, () => {});

  sender.request(1);
  sender.request(2);
  sender.request(3);
  assert.deepEqual(calls.map((c) => c.id), [1]);

  calls[0].finish(true);
  await settle();
  assert.deepEqual(calls.map((c) => c.id), [1, 3]);

  calls[1].finish(true);
  await settle();
  assert.equal(maxInFlight(), 1);
});

test('createActiveSender retries a failed selection once after 3 s, then stops quietly', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { send, calls } = controlledSend();
  const errors = [];
  const sender = createActiveSender(send, (err) => errors.push(err));

  sender.request(5);
  calls[0].finish(false);
  await settle();
  assert.equal(errors.length, 1);

  t.mock.timers.tick(2999);
  await settle();
  assert.equal(calls.length, 1);

  t.mock.timers.tick(1);
  await settle();
  assert.deepEqual(calls.map((c) => c.id), [5, 5]);

  calls[1].finish(false);
  await settle();
  t.mock.timers.tick(60000);
  await settle();
  assert.equal(calls.length, 2);
  assert.equal(errors.length, 2);
});

test('createActiveSender sends a newer selection instead of retrying the old one', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { send, calls } = controlledSend();
  const sender = createActiveSender(send, () => {});

  sender.request(5);
  calls[0].finish(false);
  await settle();

  sender.request(6);
  t.mock.timers.tick(3000);
  await settle();
  assert.deepEqual(calls.map((c) => c.id), [5, 6]);
});

test('mergeOrder keeps the dragged order, drops rows the server removed, and appends new tracks', () => {
  assert.deepEqual(mergeOrder([3, 1, 2], [1, 2, 3, 9]), [3, 1, 2, 9]);
  assert.deepEqual(mergeOrder([3, 1, 2], [1, 2]), [1, 2]);
});
