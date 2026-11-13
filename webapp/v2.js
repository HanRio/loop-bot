// v2 화면의 상태와 재생 흐름. 그리기는 v2-view.js, 순서 계산은 v2-logic.js, 재생·서버·가사·시트는 기존 모듈을 그대로 쓴다.
import { createApi } from './api.js';
import { createPlayer } from './audio.js';
import { API_BASE, FILE_BASE, IS_LOCAL, KEY_PLAYLIST, KEY_REPEAT, REPEAT_ORDER } from './config.js';
import { COPY } from './copy.js';
import { $ } from './dom.js';
import { haptic } from './haptic.js';
import { startPlaylistId } from './lyrics-logic.js';
import { askConfirm, askName, openListPicker, openMenu } from './menus.js';
import { createPlayerLyrics } from './player-lyrics.js';
import { prevTrack } from './queue.js';
import { enableSheetDrag } from './sheet-drag.js';
import { cleanTitle, createActiveSender, createSaves, readLocal, writeLocal } from './store.js';
import { addTracks, pickNext, removeTracks } from './v2-logic.js';
import { createView } from './v2-view.js';
import { KEY_VOLUME, readSaved as readSavedVolume } from './volume.js';

const KEY_SHUFFLE = 'loopbot.v2.shuffle';
const KEY_LYRICS = 'loopbot.v2.lyrics';
const BG = '#0a0a0b';
const RESTART_AFTER = 3; // 이만큼 지난 뒤 ⏮는 처음으로 돌린다 (래퍼런스와 같다).
const SEEK_STEP = 5;
const TRACK_NAME_MAX = 200;
const CONTROL_KEYS = '#play, #prev, #next, #shuffle, #repeat, #lyrics, .item';
const TEXT = { noTrack: '곡을 골라 주세요', rename: '이름 바꾸기', remove: '목록에서 빼기', trackName: '곡 이름' };

const tg = window.Telegram?.WebApp;
try {
  tg?.ready();
  tg?.expand();
  tg?.disableVerticalSwipes?.();
  tg?.setHeaderColor?.(BG);
  tg?.setBackgroundColor?.(BG);
} catch {
  // 텔레그램 밖이거나 오래된 버전이면 그냥 연다.
}

const model = { library: [], playlists: [], sharedPlaylists: [], sharedTracks: [], media: {}, isAdmin: false, viewedId: null };
const playback = {
  currentId: null, title: '', loadedId: null, lastIndex: 0, failures: 0, unplayable: new Set(), played: new Set(),
  repeat: 'all', shuffle: readLocal(KEY_SHUFFLE) === '1', lyricsOn: readLocal(KEY_LYRICS) === '1',
};
// 여러 곡 선택. 켜져 있으면 줄을 눌러도 재생하지 않고 고르기만 한다.
let selection = { on: false, ids: new Set() };
let api;
let player;
let lyrics;
let view;
let volume = 1;
let lastVolume = 1;
let refreshSeq = 0;

const allTracks = () => [...model.library, ...model.sharedTracks];
const titleOf = (id) => allTracks().find((t) => t.id === id)?.title ?? '';
const findPlaylist = (id) => model.playlists.find((p) => p.id === id) ?? model.sharedPlaylists.find((p) => p.id === id);
const isOwnId = (id) => model.playlists.some((p) => p.id === id);
const viewedPlaylist = () => model.playlists.find((p) => p.id === model.viewedId);
const viewedIds = () => findPlaylist(model.viewedId)?.track_ids ?? [];
const errText = (err, fallback) => (err?.code === 'expired' ? COPY.reopen : fallback);
const notice = (text) => {
  if (text) haptic.error();
  $('notice').textContent = text;
};

const saves = createSaves({
  save: async (value) => {
    await api.savePlaylist(value.id, value.name, value.track_ids);
    // 저장(PUT)은 그 목록을 활성으로 만든다. 내 다른 목록을 보고 있으면 활성을 그쪽으로 되돌린다 (app.js와 같다).
    if (value.id !== model.viewedId && isOwnId(model.viewedId)) activeSender.request(model.viewedId);
  },
  onError: (id, err) => {
    if (err.code === 'not_found') {
      saves.drop(id);
      refreshFromServer();
      return;
    }
    notice(errText(err, COPY.saveFailed));
  },
  onSaved: () => notice(''),
});
const activeSender = createActiveSender((id) => api.setActive(id), (err) => {
  if (err.code === 'expired') notice(COPY.reopen);
});

function render() {
  const id = playback.currentId;
  view.paintPlayer({
    id,
    title: id === null ? TEXT.noTrack : playback.title,
    sub: findPlaylist(model.viewedId)?.name ?? '',
    playing: player?.isPlaying() ?? false,
    loading: player?.isLoading() ?? false,
    repeat: playback.repeat,
    shuffle: playback.shuffle,
    lyricsOn: playback.lyricsOn,
    media: model.media,
  });
  lyrics?.show(id);
  view.paintList({
    name: findPlaylist(model.viewedId)?.name ?? '',
    ids: viewedIds(),
    titles: new Map(allTracks().map((t) => [t.id, t.title])),
    currentId: id,
    playing: player?.isPlaying() ?? false,
    unplayable: playback.unplayable,
    media: model.media,
    hasMenu: (trackId) => Boolean(viewedPlaylist()) || model.library.some((t) => t.id === trackId),
    selecting: selection.on,
    selected: selection.ids,
    canAdd: model.playlists.some((p) => p.id !== model.viewedId),
    canRemove: Boolean(viewedPlaylist()),
  });
}

// ── 재생 흐름 (app.js와 같은 규칙, 셔플과 ⏮ 처음으로만 더했다) ──
const computeNext = (manual) => pickNext({
  trackIds: viewedIds(), currentId: playback.currentId, lastIndex: playback.lastIndex,
  repeat: playback.repeat, unplayable: playback.unplayable, shuffle: playback.shuffle, manual, played: playback.played,
});
const computePrev = () => prevTrack({
  trackIds: viewedIds(), currentId: playback.currentId, lastIndex: playback.lastIndex, unplayable: playback.unplayable,
});

function syncLastIndex() {
  const at = viewedIds().indexOf(playback.currentId);
  if (at !== -1) playback.lastIndex = at;
}

function stopPlayback(message) {
  player.cancel();
  if (player.isPlaying()) player.toggle();
  if (message) notice(message);
  render();
}

async function playCurrent() {
  const id = playback.currentId;
  const started = await player.play({ id, title: playback.title });
  if (started) {
    playback.failures = 0;
    playback.loadedId = id;
    notice('');
    // 셔플이면 다음 곡을 미리 알 수 없으니 미리 받지 않는다.
    const nextId = playback.shuffle ? null : computeNext(false);
    if (nextId !== null && nextId !== id) player.prefetch(nextId);
  }
  render();
}

function moveTo(id) {
  if (id === null) return stopPlayback(COPY.noPlayable);
  playback.currentId = id;
  playback.title = titleOf(id);
  playback.played = new Set([...playback.played, id]);
  syncLastIndex();
  render();
  return playCurrent();
}

function userMove(id) {
  playback.failures = 0;
  return moveTo(id);
}

const onNext = () => userMove(computeNext(true));
function onPrev() {
  if (playback.currentId !== null && player.position() > RESTART_AFTER) return player.seek(0);
  return userMove(computePrev());
}

function onTrackFailed(err) {
  if (err.code === 'expired') {
    notice(COPY.reopen);
    return render();
  }
  if (err.code === 'too_big') playback.unplayable = new Set([...playback.unplayable, playback.currentId]);
  else {
    playback.failures += 1;
    notice(COPY.trackFailed);
  }
  if (playback.failures >= viewedIds().length) return stopPlayback();
  return moveTo(computeNext(true));
}

function onPlayPause() {
  if (playback.currentId === null) return userMove(computeNext(true));
  if (playback.currentId !== playback.loadedId) return userMove(playback.currentId);
  player.toggle();
  return undefined;
}

function onPlayRow(id) {
  if (selection.on) {
    const ids = new Set(selection.ids);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    selection = { on: true, ids };
    haptic.tick();
    render();
    return;
  }
  if (playback.unplayable.has(id)) return;
  if (id === playback.currentId && id === playback.loadedId) {
    player.toggle();
    return;
  }
  userMove(id);
}

function onRepeat() {
  playback.repeat = REPEAT_ORDER[(REPEAT_ORDER.indexOf(playback.repeat) + 1) % REPEAT_ORDER.length];
  writeLocal(KEY_REPEAT, playback.repeat);
  render();
}

function onShuffle() {
  playback.shuffle = !playback.shuffle;
  playback.played = new Set(playback.currentId === null ? [] : [playback.currentId]);
  writeLocal(KEY_SHUFFLE, playback.shuffle ? '1' : '0');
  render();
}

function onLyrics() {
  if (playback.currentId === null) return;
  playback.lyricsOn = !playback.lyricsOn;
  writeLocal(KEY_LYRICS, playback.lyricsOn ? '1' : '0');
  render();
}

// ── 목록과 곡 메뉴 ──
async function onPick() {
  const id = await openListPicker({ playlists: model.playlists, sharedPlaylists: model.sharedPlaylists, currentId: model.viewedId });
  if (id === null || id === model.viewedId) return;
  await saves.flushAll();
  selection = { on: false, ids: new Set() };
  model.viewedId = id;
  writeLocal(KEY_PLAYLIST, String(id));
  // 지금 곡은 이어서 듣고, 다음 곡부터는 새 목록의 맨 위에서 시작한다.
  playback.lastIndex = 0;
  playback.played = new Set();
  syncLastIndex();
  if (isOwnId(id)) activeSender.request(id);
  render();
}

function removeFromList(id) {
  const playlist = viewedPlaylist();
  if (!playlist) return;
  const ids = playlist.track_ids.filter((x) => x !== id);
  model.playlists = model.playlists.map((p) => (p.id === playlist.id ? { ...p, track_ids: ids } : p));
  syncLastIndex();
  saves.update({ id: playlist.id, name: playlist.name, track_ids: ids });
  render();
}

function setTitle(id, title) {
  model.library = model.library.map((t) => (t.id === id ? { ...t, title } : t));
  if (playback.currentId === id) playback.title = title;
}

async function renameTrack(id) {
  const old = titleOf(id);
  const raw = await askName({ value: old, title: TEXT.trackName, max: TRACK_NAME_MAX });
  const title = raw === null ? '' : cleanTitle(raw);
  if (!title || title === old) return;
  setTitle(id, title);
  render();
  try {
    await api.renameTrack(id, title);
  } catch (err) {
    setTitle(id, old);
    render();
    notice(errText(err, COPY.renameFailed));
  }
}

// ── 여러 곡 선택 ──
function setSelecting(on) {
  selection = { on, ids: new Set() };
  render();
}

// 고른 곡을 내 다른 목록 뒤에 붙인다. 이미 있는 곡은 다시 넣지 않는다.
async function onBulkAdd() {
  const picked = viewedIds().filter((id) => selection.ids.has(id));
  if (picked.length === 0) return;
  const targets = model.playlists.filter((p) => p.id !== model.viewedId);
  const targetId = await openListPicker({ playlists: targets, sharedPlaylists: [], currentId: null, title: '어느 목록에 담을까요' });
  const target = model.playlists.find((p) => p.id === targetId);
  if (!target) return;
  const ids = addTracks(target.track_ids, picked);
  model.playlists = model.playlists.map((p) => (p.id === target.id ? { ...p, track_ids: ids } : p));
  saves.update({ id: target.id, name: target.name, track_ids: ids });
  notice('');
  selection = { on: false, ids: new Set() };
  render();
}

async function onBulkRemove() {
  const playlist = viewedPlaylist();
  // 묻는 동안 선택이 바뀌어도 물어본 그 곡들만 뺀다.
  const picked = new Set(selection.ids);
  if (!playlist || picked.size === 0) return;
  if (!(await askConfirm({ message: `${picked.size}곡을 이 목록에서 뺄까요?`, action: '빼기' }))) return;
  const current = viewedPlaylist();
  if (!current || current.id !== playlist.id) return;
  const ids = removeTracks(current.track_ids, picked);
  model.playlists = model.playlists.map((p) => (p.id === current.id ? { ...p, track_ids: ids } : p));
  syncLastIndex();
  saves.update({ id: current.id, name: current.name, track_ids: ids });
  selection = { on: false, ids: new Set() };
  render();
}

function onRowMenu(id) {
  const items = [];
  if (model.library.some((t) => t.id === id)) items.push({ label: TEXT.rename, run: () => renameTrack(id) });
  if (viewedPlaylist()) items.push({ label: TEXT.remove, danger: true, run: () => removeFromList(id) });
  if (items.length > 0) openMenu(items);
}

// ── 볼륨 (iPhone은 하드웨어 버튼이라 숨긴다) ──
function applyVolume(value) {
  volume = value;
  if (value > 0) lastVolume = value;
  player.setVolume(value);
  writeLocal(KEY_VOLUME, String(value));
  view.paintVolume({ value, enabled: true });
}

function wireVolume() {
  if (!player.canSetVolume()) return;
  volume = readSavedVolume();
  lastVolume = volume > 0 ? volume : 1;
  player.setVolume(volume);
  view.paintVolume({ value: volume, enabled: true });
  $('vol').addEventListener('input', (e) => applyVolume(Number(e.target.value) / 100));
  $('mute').addEventListener('click', () => applyVolume(volume === 0 ? lastVolume : 0));
}

// ── 키보드 (래퍼런스와 같다) ──
function onKey(e) {
  if (e.isComposing || e.keyCode === 229 || document.querySelector('dialog[open]')) return;
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (e.key === 'Escape' && selection.on) {
    setSelecting(false);
  } else if (e.code === 'Space' && tag !== 'BUTTON') {
    e.preventDefault();
    onPlayPause();
  } else if (e.target !== $('scrub') && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    e.preventDefault();
    player.seek(player.position() + (e.key === 'ArrowRight' ? SEEK_STEP : -SEEK_STEP));
  } else if (e.key === 'n' || e.key === 'N') onNext();
  else if (e.key === 'p' || e.key === 'P') onPrev();
}

function wireControls() {
  $('play').addEventListener('click', onPlayPause);
  $('next').addEventListener('click', onNext);
  $('prev').addEventListener('click', onPrev);
  $('repeat').addEventListener('click', onRepeat);
  $('shuffle').addEventListener('click', onShuffle);
  $('lyrics').addEventListener('click', onLyrics);
  $('pick').addEventListener('click', onPick);
  $('select').addEventListener('click', () => setSelecting(true));
  $('bulk-done').addEventListener('click', () => setSelecting(false));
  $('bulk-add').addEventListener('click', onBulkAdd);
  $('bulk-remove').addEventListener('click', onBulkRemove);
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', (e) => {
    if (e.target.closest?.(CONTROL_KEYS)) haptic.tap();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshFromServer();
  });
}

// ── 서버 ──
function applyState(state) {
  model.library = state.library;
  model.sharedPlaylists = state.shared_playlists;
  model.sharedTracks = state.shared_tracks;
  model.media = state.media;
  model.isAdmin = state.is_admin;
}

async function refreshFromServer() {
  const mine = ++refreshSeq;
  await saves.flushAll();
  let state;
  try {
    state = await api.state();
  } catch (err) {
    return notice(errText(err, COPY.loadFailed));
  }
  if (mine !== refreshSeq) return undefined;
  const local = new Map(model.playlists.map((p) => [p.id, p]));
  model.playlists = state.playlists.map((p) => (saves.pending(p.id) ? (local.get(p.id) ?? p) : p));
  applyState(state);
  if (!findPlaylist(model.viewedId)) model.viewedId = state.active_id;
  syncLastIndex();
  render();
  return undefined;
}

function showFatal(text) {
  $('fatal').textContent = text;
  $('fatal').hidden = false;
}

async function init() {
  const initData = tg?.initData ?? '';
  if (!IS_LOCAL && !initData) return showFatal(COPY.openFromMenu);
  const makeApi = IS_LOCAL ? (await import('./fake-api.js')).createApi : createApi;
  api = makeApi(API_BASE, initData, FILE_BASE);
  player = createPlayer({
    api,
    onChange: render,
    onTrackEnd: () => moveTo(computeNext(false)),
    onError: onTrackFailed,
    onSkip: (dir) => (dir === 'next' ? onNext() : onPrev()),
  });
  view = createView({
    position: () => player.position(),
    duration: () => player.duration(),
    onSeek: (sec) => player.seek(sec),
    onPlayRow,
    onRowMenu,
    onFrame: () => lyrics?.tick(player.position()),
  });
  lyrics = createPlayerLyrics({
    api,
    player,
    canEdit: () => model.isAdmin && model.library.some((t) => t.id === playback.currentId),
    onError: (err) => notice(errText(err, COPY.saveFailed)),
  });
  enableSheetDrag();

  let state;
  try {
    state = await api.state();
  } catch (err) {
    return showFatal(errText(err, COPY.loadFailed));
  }
  model.playlists = state.playlists;
  applyState(state);
  model.viewedId = startPlaylistId({
    rememberedId: Number(readLocal(KEY_PLAYLIST)),
    activeId: state.active_id,
    playlists: state.playlists,
    sharedPlaylists: state.shared_playlists,
  });
  const repeat = readLocal(KEY_REPEAT);
  playback.repeat = REPEAT_ORDER.includes(repeat) ? repeat : 'all';
  $('app').hidden = false;
  wireVolume();
  wireControls();
  render();
  return undefined;
}

init().catch((err) => {
  console.error(err);
  showFatal(COPY.loadFailed);
});
