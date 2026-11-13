import test from 'node:test';
import assert from 'node:assert/strict';
import { addTracks, coverUrl, inListOrder, moveGroup, pickNext, removeTracks, shuffleNext, waveform } from '../../webapp/v2-logic.js';

test('addTracks appends only tracks the list does not have yet, keeping the picked order', () => {
  assert.deepEqual(addTracks([1, 2], [3, 2, 4]), [1, 2, 3, 4]);
  assert.deepEqual(addTracks([], [5, 5]), [5]);
});

test('moveGroup drops the selected group where the dragged row landed, keeping their order', () => {
  // DOM 순서: 3을 끌어 맨 앞에 놓았고, 같이 고른 1·5는 원래 자리에 숨어 있다.
  assert.deepEqual(moveGroup([3, 1, 2, 4, 5], 3, new Set([1, 3, 5]), [1, 2, 3, 4, 5]), [1, 3, 5, 2, 4]);
  // 맨 뒤로 끌어도 같은 순서로 붙는다.
  assert.deepEqual(moveGroup([1, 2, 4, 5, 3], 3, new Set([1, 3]), [1, 2, 3, 4, 5]), [2, 4, 5, 1, 3]);
  // 혼자 끌면 그 자리 그대로.
  assert.deepEqual(moveGroup([2, 1, 3], 2, new Set(), [1, 2, 3]), [2, 1, 3]);
  // 고르지 않은 줄을 끌면 그 줄만 옮긴다.
  assert.deepEqual(moveGroup([4, 1, 2, 3], 4, new Set([1, 2]), [1, 2, 3, 4]), [4, 1, 2, 3]);
});

test('inListOrder keeps only the selected tracks, in list order', () => {
  assert.deepEqual(inListOrder([5, 3, 9, 1], new Set([1, 5])), [5, 1]);
});

test('removeTracks drops every selected track', () => {
  assert.deepEqual(removeTracks([1, 2, 3, 4], new Set([2, 4])), [1, 3]);
  assert.deepEqual(removeTracks([1], new Set()), [1]);
});

const none = new Set();

test('shuffleNext picks a playable track other than the current one', () => {
  const ids = [1, 2, 3, 4];
  for (const r of [0, 0.3, 0.6, 0.99]) {
    const id = shuffleNext({ trackIds: ids, currentId: 2, unplayable: new Set([3]), random: () => r });
    assert.ok([1, 4].includes(id), `got ${id}`);
  }
});

test('shuffleNext falls back to the current track, or null when nothing plays', () => {
  assert.equal(shuffleNext({ trackIds: [5], currentId: 5, unplayable: none, random: () => 0 }), 5);
  assert.equal(shuffleNext({ trackIds: [5, 6], currentId: 5, unplayable: new Set([5, 6]), random: () => 0 }), null);
  assert.equal(shuffleNext({ trackIds: [], currentId: null, unplayable: none, random: () => 0 }), null);
});

test('pickNext keeps repeat-one on track end, shuffles otherwise, and walks the list without shuffle', () => {
  const base = { trackIds: [1, 2, 3], currentId: 2, lastIndex: 1, unplayable: none, random: () => 0 };
  assert.equal(pickNext({ ...base, repeat: 'one', shuffle: true, manual: false }), 2);
  assert.equal(pickNext({ ...base, repeat: 'one', shuffle: true, manual: true }), 1);
  assert.equal(pickNext({ ...base, repeat: 'all', shuffle: false, manual: false }), 3);
  assert.equal(pickNext({ ...base, repeat: 'one', shuffle: false, manual: true }), 3);
  assert.equal(pickNext({ ...base, currentId: 3, lastIndex: 2, repeat: 'off', shuffle: false, manual: false }), null);
});

test('pickNext with shuffle and repeat off stops once every track has played', () => {
  const base = { trackIds: [1, 2, 3], currentId: 3, lastIndex: 2, unplayable: none, random: () => 0, repeat: 'off', shuffle: true };
  assert.equal(pickNext({ ...base, played: new Set([1, 3]), manual: false }), 2);
  assert.equal(pickNext({ ...base, played: new Set([1, 2, 3]), manual: false }), null);
  // 손으로 넘기면 계속 섞어 튼다.
  assert.equal(pickNext({ ...base, played: new Set([1, 2, 3]), manual: true }), 1);
});

test('waveform is deterministic per seed, sized, and bounded', () => {
  const a = waveform(7, 72);
  assert.equal(a.length, 72);
  assert.deepEqual(a, waveform(7, 72));
  assert.notDeepEqual(a, waveform(8, 72));
  assert.ok(a.every((v) => v >= 0.08 && v <= 1));
});

test('coverUrl builds a YouTube thumbnail only for a video id', () => {
  assert.equal(coverUrl(null), null);
  assert.equal(coverUrl(''), null);
  assert.equal(coverUrl('abc_DEF-123'), 'https://i.ytimg.com/vi/abc_DEF-123/hqdefault.jpg');
  assert.equal(coverUrl('a/../b'), null);
});
