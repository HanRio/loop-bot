import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DESK, clampRatio, movePane, parseDesk } from '../../webapp/desk-layout.js';

const VALID = JSON.stringify({ a: ['sheet'], b: ['video', 'note'], ratio: 0.5 });

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
