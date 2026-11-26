import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOUR_STEPS, bubbleTop } from '../../webapp/tour-logic.js';

test('bubbleTop centers the bubble when there is no target', () => {
  assert.equal(bubbleTop(null, 800, 200), 300);
});

test('bubbleTop puts the bubble below the target when there is room', () => {
  assert.equal(bubbleTop({ top: 100, bottom: 150 }, 800, 200), 162);
});

test('bubbleTop puts the bubble above the target when there is no room below', () => {
  assert.equal(bubbleTop({ top: 600, bottom: 650 }, 800, 200), 388);
});

test('bubbleTop clamps into the margins when neither side fits', () => {
  // 들어갈 자리가 margin보다 좁으면 margin에 붙인다.
  assert.equal(bubbleTop({ top: 150, bottom: 300 }, 400, 380), 12);
  // 아래에 자리가 없으니 아래 쪽 자리를 화면 안으로 자른다.
  assert.equal(bubbleTop({ top: 50, bottom: 100 }, 300, 200), 88);
});

test('every tour step has text and waitClick steps name a target', () => {
  assert.ok(TOUR_STEPS.length > 0);
  for (const step of TOUR_STEPS) {
    assert.ok(typeof step.text === 'string' && step.text.length > 0);
    if (step.waitClick) assert.ok(step.target);
  }
});
