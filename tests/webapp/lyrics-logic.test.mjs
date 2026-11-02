import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  draftsToRestore,
  embedUrl,
  feedKey,
  fitSize,
  isWritable,
  sheetCacheKey,
  watchUrl,
} from '../../webapp/lyrics-logic.js';

test('fitSize keeps an image that already fits', () => {
  assert.deepEqual(fitSize(800, 600, 2400), { width: 800, height: 600 });
});

test('fitSize shrinks the long side to max and keeps the ratio in whole pixels', () => {
  assert.deepEqual(fitSize(4800, 3200, 2400), { width: 2400, height: 1600 });
  assert.deepEqual(fitSize(1000, 3001, 2400), { width: 800, height: 2400 });
});

test('feedKey is the same for the same cards and changes with order, sheet version, video, or owner', () => {
  const media = { 1: { sheet_version: 1, video_id: null } };
  const base = feedKey(5, [1, 2], media, true);

  assert.equal(feedKey(5, [1, 2], media, true), base);
  assert.notEqual(feedKey(5, [2, 1], media, true), base);
  assert.notEqual(feedKey(5, [1, 2], { 1: { sheet_version: 2, video_id: null } }, true), base);
  assert.notEqual(feedKey(5, [1, 2], { 1: { sheet_version: 1, video_id: 'abcdefghijk' } }, true), base);
  assert.notEqual(feedKey(5, [1, 2], media, false), base);
  assert.notEqual(feedKey(6, [1, 2], media, true), base);
});

test('feedKey treats a missing media row as no sheet and no video', () => {
  assert.equal(feedKey(5, [1], {}, false), feedKey(5, [1], { 1: { sheet_version: null, video_id: null } }, false));
});

test('draftsToRestore keeps drafts that differ from the server and drops the ones that match', () => {
  const drafts = { 1: '같은 글', 2: '새 글', 3: '' };
  const server = { 1: '같은 글', 2: '옛 글' };

  assert.deepEqual(draftsToRestore(drafts, server), { 2: '새 글' });
});

test('draftsToRestore drops an empty draft when the server has no note', () => {
  assert.deepEqual(draftsToRestore({ 4: '' }, {}), {});
});

test('isWritable is true only for a playlist the viewer owns', () => {
  assert.equal(isWritable({ id: 1 }, [1, 2]), true);
  assert.equal(isWritable({ id: 3 }, [1, 2]), false);
  assert.equal(isWritable(undefined, [1, 2]), false);
});

test('embedUrl and watchUrl build the YouTube links from a video id', () => {
  assert.equal(embedUrl('abcdefghijk'), 'https://www.youtube-nocookie.com/embed/abcdefghijk?playsinline=1&rel=0');
  assert.equal(watchUrl('abcdefghijk'), 'https://www.youtube.com/watch?v=abcdefghijk');
});

test('sheetCacheKey names the cached photo by track and version', () => {
  assert.equal(sheetCacheKey(7, 2), 'sheet-7-2');
});
