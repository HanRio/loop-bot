import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLrc, lineAt, plainLines, toLrc } from '../../webapp/lrc.js';

test('parseLrc reads centisecond timestamps and text', () => {
  const lines = parseLrc('[00:12.50]가\n[00:15.00]나');
  assert.deepEqual(lines, [
    { t: 12.5, text: '가' },
    { t: 15, text: '나' },
  ]);
});

test('parseLrc expands one line with several timestamps and sorts them', () => {
  const lines = parseLrc('[00:20.00][01:20.00]후렴');
  assert.deepEqual(lines, [
    { t: 20, text: '후렴' },
    { t: 80, text: '후렴' },
  ]);
});

test('parseLrc ignores metadata tags like [ar:] and [ti:]', () => {
  const lines = parseLrc('[ar:F.I.A]\n[ti:곡]\n[00:01.00]첫');
  assert.deepEqual(lines, [{ t: 1, text: '첫' }]);
});

test('parseLrc accepts a timestamp without fraction', () => {
  assert.deepEqual(parseLrc('[00:05]소수 없음'), [{ t: 5, text: '소수 없음' }]);
});

test('parseLrc keeps empty lyric lines as empty text', () => {
  const lines = parseLrc('[00:03.00]\n[00:04.00]다음');
  assert.deepEqual(lines, [
    { t: 3, text: '' },
    { t: 4, text: '다음' },
  ]);
});

test('parseLrc drops lines without any timestamp', () => {
  assert.deepEqual(parseLrc('그냥 글\n[00:02.00]줄'), [{ t: 2, text: '줄' }]);
});

test('lineAt returns the last line at or before the position', () => {
  const lines = parseLrc('[00:12.50]가\n[00:15.00]나');
  assert.equal(lineAt(lines, 14, 0), 0);
  assert.equal(lineAt(lines, 15, 0), 1);
});

test('lineAt returns -1 before the first line', () => {
  const lines = parseLrc('[00:12.50]가\n[00:15.00]나');
  assert.equal(lineAt(lines, 11, 0), -1);
});

test('lineAt treats a positive offset as showing lyrics earlier', () => {
  const lines = parseLrc('[00:12.50]가\n[00:15.00]나');
  assert.equal(lineAt(lines, 12, 1000), 0);
});

test('lineAt returns -1 for an empty list', () => {
  assert.equal(lineAt([], 5, 0), -1);
});

test('plainLines keeps non-blank trimmed lines in order', () => {
  assert.deepEqual(plainLines('  가 \r\n\n\n나\n  '), ['가', '나']);
  assert.deepEqual(plainLines(''), []);
});

test('toLrc writes mm:ss.cc tags that parseLrc reads back', () => {
  const lines = [{ t: 3.456, text: '가' }, { t: 75.1, text: '나' }, { t: 600, text: '' }];
  const lrc = toLrc(lines);
  assert.equal(lrc, '[00:03.46]가\n[01:15.10]나\n[10:00.00]');
  assert.deepEqual(parseLrc(lrc), [{ t: 3.46, text: '가' }, { t: 75.1, text: '나' }, { t: 600, text: '' }]);
});

test('toLrc never writes a negative time', () => {
  assert.equal(toLrc([{ t: -1, text: '가' }]), '[00:00.00]가');
});
