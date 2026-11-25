import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sheetFollow, shouldCloseSheet, swipeFollow, swipeSettle } from '../../webapp/gesture-logic.js';

test('sheetFollow tracks downward drags and resists upward ones', () => {
  assert.equal(sheetFollow(80), 80);
  assert.equal(sheetFollow(-40), -10);
});

test('shouldCloseSheet closes on a long drag or a quick flick, not on a nudge', () => {
  assert.equal(shouldCloseSheet({ dy: 150, velocity: 0, height: 400 }), true);
  assert.equal(shouldCloseSheet({ dy: 130, velocity: 0, height: 400 }), true);
  assert.equal(shouldCloseSheet({ dy: 40, velocity: 0.8, height: 400 }), true);
  assert.equal(shouldCloseSheet({ dy: 40, velocity: 0.1, height: 400 }), false);
  assert.equal(shouldCloseSheet({ dy: 10, velocity: 2, height: 400 }), false);
  assert.equal(shouldCloseSheet({ dy: -60, velocity: -1, height: 400 }), false);
});

test('swipeFollow never moves right and stretches past the open width', () => {
  assert.equal(swipeFollow(30, 88), 0);
  assert.equal(swipeFollow(-50, 88), -50);
  assert.equal(swipeFollow(-118, 88), -98);
});

test('swipeSettle opens past half the width or on a left flick, else closes', () => {
  assert.equal(swipeSettle({ x: -50, velocity: 0, width: 88 }), -88);
  assert.equal(swipeSettle({ x: -30, velocity: 0, width: 88 }), 0);
  assert.equal(swipeSettle({ x: -20, velocity: -0.6, width: 88 }), -88);
  assert.equal(swipeSettle({ x: -70, velocity: 0.6, width: 88 }), 0);
});
