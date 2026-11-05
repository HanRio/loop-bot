import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanUsername } from '../../webapp/users-logic.js';

// 입력한 텔레그램 아이디를 저장 형태로 다듬는다. 맞지 않으면 null.
test('cleanUsername strips one leading @ and lowercases', () => {
  assert.equal(cleanUsername('@SB_Star'), 'sb_star');
});

test('cleanUsername trims surrounding spaces', () => {
  assert.equal(cleanUsername(' abc_de '), 'abc_de');
});

test('cleanUsername rejects names shorter than 5 characters', () => {
  assert.equal(cleanUsername('abc'), null);
});

test('cleanUsername rejects names with spaces', () => {
  assert.equal(cleanUsername('has space'), null);
});

test('cleanUsername rejects names longer than 32 characters', () => {
  assert.equal(cleanUsername('a'.repeat(33)), null);
});

test('cleanUsername rejects an empty string', () => {
  assert.equal(cleanUsername(''), null);
});

test('cleanUsername rejects a double @ prefix', () => {
  assert.equal(cleanUsername('@@abcde'), null);
});
