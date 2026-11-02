import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = {};
globalThis.Audio = class {
  paused = true;
  duration = NaN;
  currentTime = 0;
  addEventListener() {}
  async play() {
    this.paused = false;
  }
  pause() {
    this.paused = true;
  }
};
const { createPlayer } = await import('../../webapp/audio.js');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const blob = new Blob(['x']);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup() {
  const pending = deferred();
  const player = createPlayer({ api: { file: () => pending.promise } });
  return { player, pending };
}

test('isLoading turns on during a slow download and off once the track plays', async () => {
  const { player, pending } = setup();
  const playing = player.play({ id: 1, title: 'a' });
  await wait(250);
  assert.equal(player.isLoading(), true);
  pending.resolve(blob);
  await playing;
  assert.equal(player.isLoading(), false);
});

test('isLoading stays off for a download that finishes quickly', async () => {
  const { player, pending } = setup();
  const playing = player.play({ id: 1, title: 'a' });
  pending.resolve(blob);
  await playing;
  await wait(250);
  assert.equal(player.isLoading(), false);
});

test('isLoading turns off when the download fails', async () => {
  const { player, pending } = setup();
  const playing = player.play({ id: 1, title: 'a' });
  await wait(250);
  pending.reject(new Error('down'));
  assert.equal(await playing, false);
  assert.equal(player.isLoading(), false);
});

test('cancel turns isLoading off and a late download does not turn it back on', async () => {
  const { player, pending } = setup();
  const playing = player.play({ id: 1, title: 'a' });
  await wait(250);
  player.cancel();
  assert.equal(player.isLoading(), false);
  pending.resolve(blob);
  await playing;
  assert.equal(player.isLoading(), false);
});

test('changing tracks keeps isLoading on until the newest track arrives', async () => {
  const first = deferred();
  const second = deferred();
  const files = { 1: first.promise, 2: second.promise };
  const player = createPlayer({ api: { file: (id) => files[id] } });
  const a = player.play({ id: 1, title: 'a' });
  await wait(250);
  const b = player.play({ id: 2, title: 'b' });
  first.resolve(blob);
  await a;
  assert.equal(player.isLoading(), true);
  second.resolve(blob);
  await b;
  assert.equal(player.isLoading(), false);
});
