import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MOOD_PALETTES,
  moodFor,
  tabFromScroll,
  indicatorX,
  loopCheck,
  meditateTrack,
  SPEEDS,
} from '../../webapp/ui-logic.js';

test('MOOD_PALETTES has five palettes of three colors copied from the prototype', () => {
  assert.deepEqual(MOOD_PALETTES, [
    ['#F6C9A8', '#FBE3B8', '#F3A9B4'],
    ['#FBD98C', '#FCEFC4', '#F6B98E'],
    ['#9CC4F2', '#C9D9F5', '#B8E0EC'],
    ['#A8DCCB', '#D3EEE4', '#9FCFE0'],
    ['#C3BDEB', '#E2DEF5', '#A9C4EE'],
  ]);
});

test('moodFor wraps the track id over the five palettes', () => {
  assert.equal(moodFor(0), MOOD_PALETTES[0]);
  assert.equal(moodFor(7), MOOD_PALETTES[2]);
});

test('moodFor uses the absolute id so negative ids still pick a palette', () => {
  assert.equal(moodFor(-3), MOOD_PALETTES[3]);
});

test('tabFromScroll rounds the scroll position to a tab index', () => {
  assert.equal(tabFromScroll(195, 390, 4), 1);
  assert.equal(tabFromScroll(1170, 390, 4), 3);
});

test('tabFromScroll clamps to the first and last tab', () => {
  assert.equal(tabFromScroll(5000, 390, 4), 3);
  assert.equal(tabFromScroll(-50, 390, 4), 0);
});

test('tabFromScroll returns 0 when the width is 0', () => {
  assert.equal(tabFromScroll(300, 0, 4), 0);
});

test('indicatorX moves proportionally to the scroll position', () => {
  assert.equal(indicatorX(390, 390, 100), 100);
  assert.equal(indicatorX(195, 390, 100), 50);
});

test('indicatorX returns 0 when the width is 0', () => {
  assert.equal(indicatorX(390, 0, 100), 0);
});

test('loopCheck jumps back to a when position reaches b', () => {
  assert.equal(loopCheck(30, { a: 10, b: 20 }), 10);
  assert.equal(loopCheck(20, { a: 10, b: 20 }), 10);
});

test('loopCheck does nothing before b', () => {
  assert.equal(loopCheck(19, { a: 10, b: 20 }), null);
});

test('loopCheck does nothing when b is not after a', () => {
  assert.equal(loopCheck(30, { a: 20, b: 10 }), null);
});

test('loopCheck does nothing without a loop', () => {
  assert.equal(loopCheck(30, null), null);
});

test('meditateTrack picks the chosen track when it is in the list', () => {
  assert.equal(meditateTrack({ chosenId: 2, currentId: 1, trackIds: [1, 2] }), 2);
});

test('meditateTrack falls back to the current track when the chosen one is missing', () => {
  assert.equal(meditateTrack({ chosenId: 9, currentId: 2, trackIds: [1, 2] }), 2);
});

test('meditateTrack falls back to the first track when neither is in the list', () => {
  assert.equal(meditateTrack({ chosenId: 9, currentId: 8, trackIds: [1, 2] }), 1);
});

test('meditateTrack returns null for an empty list', () => {
  assert.equal(meditateTrack({ chosenId: 1, currentId: 1, trackIds: [] }), null);
});

test('SPEEDS lists the four playback speeds', () => {
  assert.deepEqual(SPEEDS, [0.75, 0.9, 1, 1.1]);
});
