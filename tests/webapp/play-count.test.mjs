import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayCounter, PLAY_THRESHOLD } from '../../webapp/play-count.js';

// Feeds position samples as if timeupdate fired every `step` seconds of real time.
function listen(counter, id, from, to, duration, { step = 0.25, clock }) {
  for (let pos = from; pos <= to + 1e-9; pos += step) {
    clock.t += step * 1000;
    counter.sample(id, pos, duration, clock.t);
  }
}

const setup = () => {
  const counted = [];
  const clock = { t: 0 };
  const counter = createPlayCounter({ onCount: (id) => counted.push(id) });
  return { counted, clock, counter };
};

test('threshold is 99%', () => assert.equal(PLAY_THRESHOLD, 0.99));

test('counts once after 99% of the track was really heard', () => {
  const { counted, clock, counter } = setup();
  listen(counter, 7, 0, 98.5, 100, { clock });
  assert.deepEqual(counted, []);
  listen(counter, 7, 98.75, 100, 100, { clock });
  assert.deepEqual(counted, [7]);
});

test('a skipped track halfway does not count', () => {
  const { counted, clock, counter } = setup();
  listen(counter, 7, 0, 50, 100, { clock });
  listen(counter, 8, 0, 10, 100, { clock });
  assert.deepEqual(counted, []);
});

test('seeking to the end does not count the skipped part', () => {
  const { counted, clock, counter } = setup();
  listen(counter, 7, 0, 5, 100, { clock });
  // The position jumps 90 seconds while only 0.25s of real time passes.
  clock.t += 250;
  counter.sample(7, 95, 100, clock.t);
  listen(counter, 7, 95.25, 100, 100, { clock });
  assert.deepEqual(counted, []);
});

test('many small forward seeks do not add up either', () => {
  const { counted, clock, counter } = setup();
  for (let pos = 0; pos <= 100; pos += 4) {
    clock.t += 250;
    counter.sample(7, pos, 100, clock.t);
  }
  assert.deepEqual(counted, []);
});

test('paused time does not count', () => {
  const { counted, clock, counter } = setup();
  listen(counter, 7, 0, 10, 100, { clock });
  counter.pause();
  clock.t += 600_000;
  counter.sample(7, 99.5, 100, clock.t);
  assert.deepEqual(counted, []);
});

test('repeating the same track counts each full play', () => {
  const { counted, clock, counter } = setup();
  listen(counter, 7, 0, 100, 100, { clock });
  counter.restart();
  listen(counter, 7, 0, 100, 100, { clock });
  assert.deepEqual(counted, [7, 7]);
});

test('a fresh counter (after a reload) starts from zero', () => {
  const { counted, clock, counter } = setup();
  listen(counter, 7, 0, 60, 100, { clock });
  const again = setup();
  again.clock.t = clock.t;
  listen(again.counter, 7, 60, 100, 100, { clock: again.clock });
  assert.deepEqual([...counted, ...again.counted], []);
});

test('unknown duration never counts', () => {
  const { counted, clock, counter } = setup();
  listen(counter, 7, 0, 100, 0, { clock });
  assert.deepEqual(counted, []);
});

test('faster playback speed is still real listening', () => {
  const { counted, clock, counter } = setup();
  // 1.5x speed: position moves 0.375s per 0.25s of real time.
  for (let pos = 0; pos <= 100; pos += 0.375) {
    clock.t += 250;
    counter.sample(7, pos, 100, clock.t);
  }
  assert.deepEqual(counted, [7]);
});
