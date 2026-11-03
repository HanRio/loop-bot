import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampPage,
  draftsToRestore,
  embedUrl,
  feedKey,
  fitSize,
  isWritable,
  pagesToLoad,
  pageFromScroll,
  sheetCacheKey,
  startPlaylistId,
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

test('sheetCacheKey names the cached page by track, version, and page', () => {
  assert.equal(sheetCacheKey(7, 2, 0), 'sheet-7-2-0');
  assert.equal(sheetCacheKey(7, 2, 1), 'sheet-7-2-1');
});

test('clampPage keeps the page between 0 and the last page, and is 0 when there are no pages', () => {
  assert.equal(clampPage(1, 3), 1);
  assert.equal(clampPage(-1, 3), 0);
  assert.equal(clampPage(5, 3), 2);
  assert.equal(clampPage(4, 0), 0);
});

test('pageFromScroll rounds the scroll position to a page and is 0 without a step', () => {
  assert.equal(pageFromScroll(0, 300, 3), 0);
  assert.equal(pageFromScroll(160, 300, 3), 1);
  assert.equal(pageFromScroll(440, 300, 3), 1);
  assert.equal(pageFromScroll(9000, 300, 3), 2);
  assert.equal(pageFromScroll(500, 0, 3), 0);
});

test('pagesToLoad gives the current page and the next one, inside the valid range', () => {
  assert.deepEqual(pagesToLoad(0, 3), [0, 1]);
  assert.deepEqual(pagesToLoad(2, 3), [2]);
  assert.deepEqual(pagesToLoad(0, 1), [0]);
  assert.deepEqual(pagesToLoad(0, 0), []);
});

test('startPlaylistId opens the first shared list when the list to show is my own empty one', () => {
  const playlists = [{ id: 1, track_ids: [] }];
  const sharedPlaylists = [{ id: 9, track_ids: [5] }, { id: 8, track_ids: [6] }];
  assert.equal(startPlaylistId({ rememberedId: 0, activeId: 1, playlists, sharedPlaylists }), 9);
  assert.equal(startPlaylistId({ rememberedId: 1, activeId: 1, playlists, sharedPlaylists }), 9);
});

test('startPlaylistId keeps my own list when it has songs or nothing is shared', () => {
  const playlists = [{ id: 1, track_ids: [3] }, { id: 2, track_ids: [] }];
  assert.equal(startPlaylistId({ rememberedId: 1, activeId: 2, playlists, sharedPlaylists: [{ id: 9, track_ids: [] }] }), 1);
  assert.equal(startPlaylistId({ rememberedId: 0, activeId: 2, playlists, sharedPlaylists: [] }), 2);
});

test('startPlaylistId keeps a remembered shared list and ignores a remembered list that is gone', () => {
  const playlists = [{ id: 1, track_ids: [3] }];
  const sharedPlaylists = [{ id: 9, track_ids: [] }, { id: 8, track_ids: [] }];
  assert.equal(startPlaylistId({ rememberedId: 8, activeId: 1, playlists, sharedPlaylists }), 8);
  assert.equal(startPlaylistId({ rememberedId: 77, activeId: 1, playlists, sharedPlaylists }), 1);
});
