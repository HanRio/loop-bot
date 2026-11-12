import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = {};
globalThis.Audio = class {
  paused = true;
  duration = NaN;
  currentTime = 0;
  volume = 1;
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

test('setVolume clamps to 0..1', () => {
  const player = createPlayer({ api: {} });
  player.setVolume(2);
  assert.equal(player.volume(), 1);
  player.setVolume(-1);
  assert.equal(player.volume(), 0);
});

test('setVolume ignores non-finite values', () => {
  const player = createPlayer({ api: {} });
  player.setVolume(0.4);
  player.setVolume(NaN);
  assert.equal(player.volume(), 0.4);
});

test('canSetVolume is true when the element accepts volume changes', () => {
  const player = createPlayer({ api: {} });
  assert.equal(player.canSetVolume(), true);
});

test('canSetVolume is false when the element ignores volume changes', () => {
  const Normal = globalThis.Audio;
  // iPhone/iPad처럼 볼륨 쓰기를 무시하고 항상 1을 돌려주는 요소.
  globalThis.Audio = class {
    paused = true;
    duration = NaN;
    currentTime = 0;
    get volume() {
      return 1;
    }
    set volume(_value) {}
    addEventListener() {}
  };
  try {
    const player = createPlayer({ api: {} });
    assert.equal(player.canSetVolume(), false);
  } finally {
    globalThis.Audio = Normal;
  }
});

test('canSetVolume leaves the current volume unchanged', () => {
  const player = createPlayer({ api: {} });
  player.setVolume(0.3);
  player.canSetVolume();
  assert.equal(player.volume(), 0.3);
});

// 곡을 바꿀 때 브라우저처럼 src를 넣으면 재생 속도가 기본값(1)으로 돌아가는 요소.
function playerWithAudio(options = {}) {
  const Normal = globalThis.Audio;
  let element;
  globalThis.Audio = class extends Normal {
    constructor() {
      super();
      element = this;
    }
    set src(value) {
      this.playbackRate = 1;
      this._src = value;
    }
    get src() {
      return this._src;
    }
  };
  try {
    const player = createPlayer({ api: { file: async () => blob }, ...options });
    return { player, audio: element };
  } finally {
    globalThis.Audio = Normal;
  }
}

test('setRate keeps the rate after the track changes', async () => {
  const { player, audio } = playerWithAudio();
  player.setRate(1.5);
  await player.play({ id: 1, title: 'a' });
  await player.play({ id: 2, title: 'b' });
  assert.equal(audio.playbackRate, 1.5);
  assert.equal(player.rate(), 1.5);
});

test('seek clamps the position to 0..duration', () => {
  const { player, audio } = playerWithAudio();
  audio.duration = 100;
  player.seek(150);
  assert.equal(audio.currentTime, 100);
  player.seek(-5);
  assert.equal(audio.currentTime, 0);
  player.seek(42);
  assert.equal(audio.currentTime, 42);
});
