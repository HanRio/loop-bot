import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSaver } from '../../webapp/player/saver.js';

function fakeTimers() {
  const pending = new Map();
  let nextId = 1;
  return {
    setTimer(fn, ms) {
      const id = nextId;
      nextId += 1;
      pending.set(id, { fn, ms });
      return id;
    },
    clearTimer(id) {
      pending.delete(id);
    },
    count: () => pending.size,
    lastDelay: () => [...pending.values()].at(-1).ms,
    fire() {
      const [id, { fn }] = pending.entries().next().value;
      pending.delete(id);
      fn();
    },
  };
}

function controlledSave() {
  const calls = [];
  const save = (value) =>
    new Promise((resolve, reject) => {
      calls.push({ value, resolve, reject });
    });
  return { save, calls };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('createSaver saves only the last value of updates within the delay', () => {
  const timers = fakeTimers();
  const { save, calls } = controlledSave();
  const saver = createSaver(save, timers);

  saver.update(1);
  saver.update(2);
  saver.update(3);
  assert.equal(timers.count(), 1);
  assert.equal(timers.lastDelay(), 500);

  timers.fire();
  assert.deepEqual(calls.map((call) => call.value), [3]);
});

test('createSaver saves the newest value once more after an update during a save', async () => {
  const timers = fakeTimers();
  const { save, calls } = controlledSave();
  const saver = createSaver(save, timers);

  saver.update(1);
  timers.fire();
  saver.update(2);
  saver.update(3);
  assert.equal(timers.count(), 0);

  calls[0].resolve();
  await settle();
  assert.equal(timers.count(), 1);

  timers.fire();
  assert.deepEqual(calls.map((call) => call.value), [1, 3]);
});

test('createSaver reports a failed save, keeps the value, and retries after 3000 ms with the newest value', async () => {
  const timers = fakeTimers();
  const { save, calls } = controlledSave();
  const errors = [];
  const saver = createSaver(save, { ...timers, onError: (err) => errors.push(err) });
  const failure = new Error('network down');

  saver.update(7);
  timers.fire();
  calls[0].reject(failure);
  await settle();

  assert.deepEqual(errors, [failure]);
  assert.equal(saver.pending(), true);
  assert.equal(timers.lastDelay(), 3000);

  saver.update(9);
  assert.equal(timers.count(), 1);
  timers.fire();
  assert.equal(calls[1].value, 9);
});

test('createSaver flush saves the pending value now and resolves after it is saved', async () => {
  const timers = fakeTimers();
  const { save, calls } = controlledSave();
  const saver = createSaver(save, timers);

  saver.update(5);
  const done = saver.flush();
  assert.equal(calls[0].value, 5);

  calls[0].resolve();
  await done;
  assert.equal(saver.pending(), false);
  assert.equal(timers.count(), 0);
});

test('createSaver flush resolves after a failed save and leaves the value pending', async () => {
  const timers = fakeTimers();
  const { save, calls } = controlledSave();
  const saver = createSaver(save, { ...timers, onError() {} });

  saver.update(5);
  const done = saver.flush();
  calls[0].reject(new Error('down'));

  await done;
  assert.equal(saver.pending(), true);
});

test('createSaver concurrent flushes wait for the queued newer save', async () => {
  const timers = fakeTimers();
  const { save, calls } = controlledSave();
  const saver = createSaver(save, timers);

  saver.update(1);
  timers.fire();
  saver.update(2);
  const first = saver.flush();
  const second = saver.flush();
  let resolved = 0;
  first.then(() => { resolved += 1; });
  second.then(() => { resolved += 1; });

  calls[0].resolve();
  await settle();
  assert.deepEqual(calls.map((call) => call.value), [1, 2]);
  assert.equal(resolved, 0);

  calls[1].resolve();
  await Promise.all([first, second]);
  assert.equal(saver.pending(), false);
});

test('createSaver keeps retrying when onError throws', async (t) => {
  t.mock.method(console, 'error', () => {});
  const timers = fakeTimers();
  const { save, calls } = controlledSave();
  const saver = createSaver(save, {
    ...timers,
    onError() {
      throw new Error('boom');
    },
  });

  saver.update(7);
  timers.fire();
  calls[0].reject(new Error('down'));
  await settle();

  assert.equal(timers.lastDelay(), 3000);
  timers.fire();
  assert.equal(calls[1].value, 7);
});

test('createSaver treats a synchronous throw from save like a failed save', async () => {
  const timers = fakeTimers();
  const errors = [];
  const saver = createSaver(
    () => {
      throw new Error('sync');
    },
    { ...timers, onError: (err) => errors.push(err) },
  );

  saver.update(4);
  timers.fire();
  await settle();

  assert.equal(errors.length, 1);
  assert.equal(saver.pending(), true);
  assert.equal(timers.lastDelay(), 3000);
});
