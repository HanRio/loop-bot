import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanUsername, userRowActions, withRow } from '../../webapp/users-logic.js';

// 테스트용 목록 줄. 빠진 칸은 기본값(가입 후, 관리자 아님)으로 채운다.
const row = (over = {}) => ({ username: 'abcde', seen: true, is_admin: false, is_owner: false, ...over });

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

// 관리자 눈에 보이는 버튼 종류와 지우기 가능 여부. 원래 관리자 줄은 건드릴 수 없다.
test('userRowActions gives no toggle to a non-owner', () => {
  assert.equal(userRowActions(row(), false).toggle, null);
});

test('userRowActions lets a non-owner remove a plain row', () => {
  assert.equal(userRowActions(row(), false).canRemove, true);
});

test('userRowActions gives no toggle and no remove to a non-owner on an admin row', () => {
  assert.deepEqual(userRowActions(row({ is_admin: true }), false), { toggle: null, canRemove: false });
});

test('userRowActions gives no toggle and no remove to a non-owner on the owner row', () => {
  assert.deepEqual(userRowActions(row({ is_owner: true }), false), { toggle: null, canRemove: false });
});

test('userRowActions gives no toggle to the owner row itself', () => {
  assert.equal(userRowActions(row({ is_owner: true, is_admin: true }), true).toggle, null);
});

test('userRowActions does not let the owner remove the owner row', () => {
  assert.equal(userRowActions(row({ is_owner: true }), true).canRemove, false);
});

test('userRowActions shows waiting for an owner on an unseen plain row', () => {
  assert.deepEqual(userRowActions(row({ seen: false }), true), { toggle: 'waiting', canRemove: true });
});

test('userRowActions shows grant for an owner on a seen plain row', () => {
  assert.deepEqual(userRowActions(row(), true), { toggle: 'grant', canRemove: true });
});

test('userRowActions shows revoke for an owner on a seen admin row', () => {
  assert.deepEqual(userRowActions(row({ is_admin: true }), true), { toggle: 'revoke', canRemove: true });
});

test('userRowActions shows revoke, not waiting, for an unseen admin row', () => {
  assert.equal(userRowActions(row({ seen: false, is_admin: true }), true).toggle, 'revoke');
});

// 목록은 아이디 순서로 두고, 같은 아이디 줄은 새 줄로 바꾼다. 받은 배열과 줄은 건드리지 않는다.
test('withRow adds a new row in username order', () => {
  const rows = [row({ username: 'aaaaa' }), row({ username: 'ccccc' })];
  assert.deepEqual(
    withRow(rows, row({ username: 'bbbbb' })).map((r) => r.username),
    ['aaaaa', 'bbbbb', 'ccccc'],
  );
});

test('withRow replaces the row with the same username', () => {
  const rows = [row({ username: 'aaaaa' }), row({ username: 'bbbbb' })];
  const next = withRow(rows, row({ username: 'aaaaa', is_admin: true }));
  assert.deepEqual(next, [row({ username: 'aaaaa', is_admin: true }), row({ username: 'bbbbb' })]);
});

test('withRow does not mutate the input array or its rows', () => {
  const rows = [row({ username: 'bbbbb' }), row({ username: 'aaaaa' })];
  const before = structuredClone(rows);
  const next = withRow(rows, row({ username: 'aaaaa', is_admin: true }));
  assert.deepEqual(rows, before);
  assert.notEqual(next, rows);
});
