import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextTrack, prevTrack } from '../../webapp/player/queue.js';

const DEFAULTS = { lastIndex: 0, repeat: 'all', unplayable: new Set() };
const next = (args) => nextTrack({ ...DEFAULTS, ...args });
const prev = (args) => prevTrack({ ...DEFAULTS, ...args });

test('nextTrack moves to the following track', () => {
  assert.equal(next({ trackIds: [1, 2, 3], currentId: 1 }), 2);
});

test('nextTrack wraps to the first track after the last one when repeat is all', () => {
  assert.equal(next({ trackIds: [1, 2, 3], currentId: 3, lastIndex: 2 }), 1);
});

test('nextTrack returns null after the last track when repeat is off', () => {
  assert.equal(next({ trackIds: [1, 2, 3], currentId: 3, lastIndex: 2, repeat: 'off' }), null);
});

test('nextTrack repeats the same track automatically when repeat is one', () => {
  assert.equal(next({ trackIds: [1, 2, 3], currentId: 2, repeat: 'one' }), 2);
});

test('nextTrack moves to the next track on manual skip when repeat is one', () => {
  assert.equal(next({ trackIds: [1, 2, 3], currentId: 2, repeat: 'one', manual: true }), 3);
});

test('nextTrack uses lastIndex when the current track was removed from the list', () => {
  assert.equal(next({ trackIds: [1, 3], currentId: 2, lastIndex: 1 }), 3);
});

test('nextTrack wraps or stops when the removed track was the last one', () => {
  const trackIds = [1, 2];
  assert.equal(next({ trackIds, currentId: 3, lastIndex: 2 }), 1);
  assert.equal(next({ trackIds, currentId: 3, lastIndex: 2, repeat: 'off' }), null);
});

test('nextTrack skips unplayable tracks', () => {
  assert.equal(next({ trackIds: [1, 2, 3], currentId: 1, unplayable: new Set([2]) }), 3);
});

test('nextTrack returns null when every track is unplayable', () => {
  assert.equal(next({ trackIds: [1, 2], currentId: 1, unplayable: new Set([1, 2]) }), null);
});

test('nextTrack returns null for an empty list', () => {
  assert.equal(next({ trackIds: [], currentId: null }), null);
});

test('nextTrack returns null when the only track is unplayable and repeat is one', () => {
  assert.equal(
    next({ trackIds: [1], currentId: 1, repeat: 'one', unplayable: new Set([1]) }),
    null,
  );
});

test('nextTrack returns the first playable track when nothing has played yet', () => {
  assert.equal(next({ trackIds: [1, 2], currentId: null, unplayable: new Set([1]) }), 2);
});

test('prevTrack wraps from the first track to the last one', () => {
  assert.equal(prev({ trackIds: [1, 2, 3], currentId: 1 }), 3);
});

test('prevTrack moves to the preceding track', () => {
  assert.equal(prev({ trackIds: [1, 2, 3], currentId: 2 }), 1);
});

test('prevTrack uses lastIndex - 1 when the current track was removed from the list', () => {
  assert.equal(prev({ trackIds: [1, 3], currentId: 2, lastIndex: 1 }), 1);
});

test('prevTrack skips unplayable tracks', () => {
  assert.equal(prev({ trackIds: [1, 2, 3], currentId: 3, unplayable: new Set([2]) }), 1);
});

test('prevTrack returns null for an empty list', () => {
  assert.equal(prev({ trackIds: [], currentId: null }), null);
});
