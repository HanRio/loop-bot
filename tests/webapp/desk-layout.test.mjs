import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DESK, VIDEO_FOOT, VIDEO_HEIGHT_SHARE, VIDEO_PIN_TOP, clampRatio, floatRect, movePane, parseDesk } from '../../webapp/desk-layout.js';

const VALID = JSON.stringify({ a: ['sheet'], b: ['video', 'note'], ratio: 0.5 });

// 부동소수점 오차만 허용해 비교한다.
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('parseDesk returns the default desk when nothing is stored', () => {
  assert.equal(parseDesk(null), DEFAULT_DESK);
});

test('parseDesk returns the default desk for text that is not JSON', () => {
  assert.equal(parseDesk('x'), DEFAULT_DESK);
});

test('parseDesk returns the default desk when a pane is missing', () => {
  const raw = JSON.stringify({ a: ['sheet'], b: ['video'], ratio: 0.5 });
  assert.equal(parseDesk(raw), DEFAULT_DESK);
});

test('parseDesk returns the default desk when a pane appears twice', () => {
  const raw = JSON.stringify({ a: ['sheet', 'sheet'], b: ['video', 'note'], ratio: 0.5 });
  assert.equal(parseDesk(raw), DEFAULT_DESK);
});

test('parseDesk keeps a valid layout and its ratio', () => {
  assert.deepEqual(parseDesk(VALID), { a: ['sheet'], b: ['video', 'note'], ratio: 0.5 });
});

test('parseDesk clamps an out-of-range ratio to the maximum', () => {
  const raw = JSON.stringify({ a: ['sheet'], b: ['video', 'note'], ratio: 5 });
  assert.equal(parseDesk(raw).ratio, 0.7);
});

test('parseDesk falls back to the default ratio when the ratio is not a number', () => {
  const raw = JSON.stringify({ a: ['sheet'], b: ['video', 'note'], ratio: 'a' });
  assert.equal(parseDesk(raw).ratio, 0.55);
});

test('clampRatio keeps values inside the bounds', () => {
  assert.equal(clampRatio(0.5), 0.5);
  assert.equal(clampRatio(0.1), 0.3);
  assert.equal(clampRatio(0.9), 0.7);
});

test('clampRatio returns the default ratio for values that are not finite', () => {
  assert.equal(clampRatio(NaN), 0.55);
  assert.equal(clampRatio(Infinity), 0.55);
});

test('movePane reorders panes inside the same column', () => {
  const next = movePane(DEFAULT_DESK, 'video', 'note', 'after');
  assert.deepEqual(next.b, ['note', 'video']);
  assert.deepEqual(next.a, ['sheet']);
});

test('movePane moves a pane into the other column before the target', () => {
  const desk = { a: ['sheet'], b: ['video', 'note'], ratio: 0.55 };
  const next = movePane(desk, 'video', 'sheet', 'before');
  assert.deepEqual(next.a, ['video', 'sheet']);
  assert.deepEqual(next.b, ['note']);
});

test('movePane swaps the two panes when the source column would become empty', () => {
  const next = movePane(DEFAULT_DESK, 'sheet', 'note', 'after');
  assert.deepEqual(next.a, ['note']);
  assert.deepEqual(next.b, ['video', 'sheet']);
});

test('movePane does not mutate the input desk', () => {
  const desk = { a: ['sheet'], b: ['video', 'note'], ratio: 0.55 };
  const before = JSON.stringify(desk);
  const next = movePane(desk, 'video', 'sheet', 'before');
  assert.equal(JSON.stringify(desk), before);
  assert.notEqual(next, desk);
});

test('movePane returns the same desk when the pane is dropped on itself', () => {
  assert.equal(movePane(DEFAULT_DESK, 'note', 'note', 'before'), DEFAULT_DESK);
});

test('floatRect caps a wide slot by the viewport height and centres it', () => {
  const rect = floatRect({ left: 20, top: 300, width: 1000 }, 800);
  const width = 800 * VIDEO_HEIGHT_SHARE * 16 / 9;
  near(rect.width, width);
  near(rect.left, 20 + (1000 - width) / 2);
  near(rect.height, width * 9 / 16 + VIDEO_FOOT);
  assert.equal(rect.top, 300);
});

test('floatRect uses the slot width when the slot is narrower than the cap', () => {
  const rect = floatRect({ left: 10, top: 300, width: 300 }, 800);
  assert.deepEqual(rect, { left: 10, top: 300, width: 300, height: 300 * 9 / 16 + VIDEO_FOOT });
});

test('floatRect pins the top to VIDEO_PIN_TOP when the slot is scrolled above the viewport', () => {
  const rect = floatRect({ left: 0, top: -200, width: 300 }, 800);
  assert.equal(rect.top, VIDEO_PIN_TOP);
});

test('floatRect keeps the slot top when the slot is in view', () => {
  const rect = floatRect({ left: 0, top: 120, width: 300 }, 800);
  assert.equal(rect.top, 120);
});
