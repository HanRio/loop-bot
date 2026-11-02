// 화면 상태와 재생 흐름. 그리기는 render.js, 네트워크는 api.js, 저장은 store.js, 재생은 audio.js가 맡는다.
import { createApi } from './api.js';
import { createPlayer } from './audio.js';
import { COPY } from './copy.js';
import { nextTrack, prevTrack } from './queue.js';
import {
  $, closeNameForm, enableQueueSort, openNameForm, renderPicker, renderQueue, renderLibrary, renderBar, setNotice, setVisible,
} from './render.js';
import { cleanName, createActiveSender, createSaves, mergeOrder, readLocal, writeLocal } from './store.js';

const API_BASE = 'https://rrpmpqxoqxlwrmflpiyi.supabase.co/functions/v1/loopbot-api';
const IS_LOCAL = location.hostname === 'localhost';
const NEW_PLAYLIST = 'new';
const REPEAT_ORDER = ['all', 'one', 'off'];
const KEY_PLAYLIST = 'loopbot.player.playlist';
const KEY_REPEAT = 'loopbot.player.repeat';

const tg = window.Telegram?.WebApp;
try {
  tg?.ready();
  tg?.expand();
  // 목록을 끌 때 세로 스와이프로 미니앱이 닫히지 않게 한다.
  tg?.disableVerticalSwipes?.();
} catch {
  // 텔레그램 밖이거나 오래된 버전이면 그냥 연다.
}

function applyTheme() {
  document.documentElement.dataset.theme = tg?.colorScheme === 'dark' ? 'dark' : 'light';
  // 텔레그램 상단·배경도 표면색에 맞춰 경계를 없앤다.
  const surface = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
  try {
    tg?.setHeaderColor?.(surface);
    tg?.setBackgroundColor?.(surface);
  } catch {
    // 오래된 버전이면 색만 안 맞는다.
  }
}
applyTheme();
tg?.onEvent?.('themeChanged', applyTheme);

const model = { library: [], playlists: [], viewedId: null };
const playback = {
  playingPlaylistId: null,
  currentTrackId: null,
  currentTitle: '',
  loadedId: null,
  lastIndex: 0,
  repeat: 'all',
  unplayable: new Set(),
  failures: 0,
};
let api;
let player;
// 끄는 동안에는 자동 전환이 목록 DOM을 바꾸지 않는다. 끝나면 onQueueEnd에서 다시 그린다.
let dragging = false;
// 지우는 중인 플레이리스트는 편집을 받지 않는다.
let deletingId = null;
// 끌기를 시작한 목록. 끝날 때 보고 있는 목록이 같을 때만 순서를 저장한다.
let dragPlaylistId = null;
let refreshSeq = 0;
// 이름 입력줄이 지금 무슨 일을 하는지. 'create' | 'rename' | null
let nameFormMode = null;

const saves = createSaves({
  save: async (value) => {
    await api.savePlaylist(value.id, value.name, value.track_ids);
    // PUT은 그 목록을 활성으로 만든다. 다른 목록을 보고 있으면 활성을 그쪽으로 되돌린다.
    if (value.id !== model.viewedId) activeSender.request(model.viewedId);
  },
  onError: onSaveError,
  onSaved: () => showSaveNotice(''),
});
const activeSender = createActiveSender(
  (id) => api.setActive(id),
  (err) => {
    if (err.code === 'expired') showSaveNotice(COPY.reopen);
  },
);

// 재생 중인 목록이 지워졌으면 빈 목록이 되어 다음 곡이 없고 멈춘다.
const playlistIds = (id) => model.playlists.find((p) => p.id === id)?.track_ids ?? [];
const viewedIds = () => playlistIds(model.viewedId);
const playingIds = () => playlistIds(playback.playingPlaylistId ?? model.viewedId);
const viewedPlaylist = () => model.playlists.find((p) => p.id === model.viewedId);
const queueIds = () => [...$('queue').children].map((li) => Number(li.dataset.id));
const titleOf = (id) => model.library.find((t) => t.id === id)?.title ?? '';
const titleMap = () => new Map(model.library.map((t) => [t.id, t.title]));
const barState = () => ({ title: playback.currentTitle, position: player?.position() ?? 0, duration: player?.duration() ?? 0, playing: player?.isPlaying() ?? false, repeat: playback.repeat });

function renderAll() {
  const ids = viewedIds();
  renderPicker(model.playlists, model.viewedId, NEW_PLAYLIST);
  if (!dragging) {
    renderQueue(ids, { titles: titleMap(), currentId: playback.currentTrackId, unplayable: playback.unplayable }, {
      onPlay: onPlayRow,
      onRemove: onRemoveFromQueue,
    });
  }
  renderLibrary(model.library, new Set(ids), { onAdd: onAddToQueue, onDelete: onDeleteTrack });
  renderBar(barState());
}

function showSaveNotice(text) {
  setNotice('save-notice', text);
}

function reportError(err) {
  showSaveNotice(err.code === 'expired' ? COPY.reopen : COPY.saveFailed);
}

function showFatal(text) {
  setNotice('fatal', text);
  setVisible('fatal', true);
}

// not_found는 서버에 그 목록이 없다는 뜻이다. 재시도해도 소용없으니 버리고 서버 값을 받는다.
function onSaveError(id, err) {
  if (err.code === 'not_found') {
    saves.drop(id);
    refreshFromServer();
    return;
  }
  reportError(err);
}

// 재생 중인 목록이 바뀌어도 지금 곡이 남아 있으면 자리를 맞춘다. 빠졌으면 lastIndex를 그대로 둔다.
function syncLastIndex() {
  const at = playingIds().indexOf(playback.currentTrackId);
  if (at !== -1) playback.lastIndex = at;
}

// 보고 있는 목록을 바꾸고 저장을 맡긴다. 호출한 쪽이 화면을 그린다.
function editViewed(ids) {
  const playlist = viewedPlaylist();
  if (!playlist || playlist.id === deletingId) return;
  const updated = { ...playlist, track_ids: ids };
  model.playlists = model.playlists.map((p) => (p.id === playlist.id ? updated : p));
  if (playback.playingPlaylistId === playlist.id) syncLastIndex();
  saves.update({ id: playlist.id, name: playlist.name, track_ids: ids });
}

function onRemoveFromQueue(id) {
  editViewed(viewedIds().filter((x) => x !== id));
  renderAll();
}

function onAddToQueue(id) {
  editViewed([...viewedIds(), id]);
  renderAll();
}

async function onDeleteTrack(id) {
  if (!confirm(COPY.deleteTrackConfirm)) return;
  try {
    await api.deleteTrack(id);
  } catch (err) {
    // 이미 지워진 곡이면 지운 것으로 친다.
    if (err.code !== 'not_found') return showSaveNotice(err.code === 'expired' ? COPY.reopen : COPY.deleteFailed);
  }
  model.library = model.library.filter((t) => t.id !== id);
  model.playlists = model.playlists.map((p) =>
    p.track_ids.includes(id) ? { ...p, track_ids: p.track_ids.filter((x) => x !== id) } : p,
  );
  syncLastIndex();
  player.forget(id);
  renderAll();
}

function renameViewed(raw) {
  const playlist = viewedPlaylist();
  const name = cleanName(raw);
  // 비웠거나 그대로면 바꾸지 않는다. 서버는 빈 이름을 '새 플레이리스트'로 덮어쓴다.
  if (!playlist || playlist.id === deletingId || !name || name === playlist.name) return;
  const updated = { ...playlist, name };
  model.playlists = model.playlists.map((p) => (p.id === playlist.id ? updated : p));
  saves.update({ id: updated.id, name: updated.name, track_ids: updated.track_ids });
}

function openRename() {
  const playlist = viewedPlaylist();
  if (!playlist) return;
  nameFormMode = 'rename';
  openNameForm({ value: playlist.name, submitLabel: COPY.rename });
}

function closeNameFormAndReset() {
  nameFormMode = null;
  closeNameForm();
}

async function onPickPlaylist(id) {
  closeNameFormAndReset();
  if (id === model.viewedId) return renderAll();
  await saves.flushAll();
  model.viewedId = id;
  writeLocal(KEY_PLAYLIST, String(id));
  renderAll();
  activeSender.request(id);
}

async function onCreatePlaylist(event) {
  event.preventDefault();
  const name = $('new-name').value;
  const mode = nameFormMode;
  closeNameFormAndReset();
  if (mode === 'rename') {
    renameViewed(name);
    renderAll();
    return;
  }
  await saves.flushAll();
  try {
    const playlist = await api.createPlaylist(name, []);
    model.playlists = [...model.playlists, playlist];
    model.viewedId = playlist.id;
    writeLocal(KEY_PLAYLIST, String(playlist.id));
    // 대기 중이던 활성 전송이 방금 만든 목록을 덮지 않도록 다시 맞춘다.
    activeSender.request(playlist.id);
  } catch (err) {
    reportError(err);
  }
  renderAll();
}

function onCancelNew() {
  closeNameFormAndReset();
  renderAll();
}

function onPickerChange() {
  const value = $('picker').value;
  if (value === NEW_PLAYLIST) {
    nameFormMode = 'create';
    return openNameForm({ value: '', submitLabel: COPY.create });
  }
  return onPickPlaylist(Number(value));
}

async function onDeletePlaylist() {
  if (!confirm(COPY.deletePlaylistConfirm)) return;
  const id = model.viewedId;
  deletingId = id;
  // 저장 대기 중인 편집은 삭제가 실패하면 되돌리려고 먼저 잡아 둔다.
  const edited = saves.pending(id) ? viewedPlaylist() : null;
  // 지울 목록의 저장은 버린다. 보내 봤자 404만 돌아오고 재시도가 멈추지 않는다.
  saves.drop(id);
  try {
    await api.deletePlaylist(id);
  } catch (err) {
    deletingId = null;
    if (err.code !== 'not_found') {
      if (edited) saves.update(edited);
      return showSaveNotice(err.code === 'expired' ? COPY.reopen : COPY.deleteFailed);
    }
  }
  deletingId = null;
  // 마지막 목록이었으면 서버가 기본을 새로 만든다. 그 값은 상태를 다시 받아서 맞춘다.
  await refreshFromServer();
}

// ⏭·⏮는 한 곡 반복이어도 전체 반복처럼 움직인다.
const computeNext = (manual) =>
  nextTrack({
    trackIds: playingIds(),
    currentId: playback.currentTrackId,
    lastIndex: playback.lastIndex,
    repeat: manual && playback.repeat === 'one' ? 'all' : playback.repeat,
    unplayable: playback.unplayable,
  });

const computePrev = () =>
  prevTrack({ trackIds: playingIds(), currentId: playback.currentTrackId, lastIndex: playback.lastIndex, unplayable: playback.unplayable });

function stopPlayback(message) {
  // 받는 중이던 곡이 있으면 버린다. 멈춘 뒤에 도착해 재생되지 않게 한다.
  player.cancel();
  if (player.isPlaying()) player.toggle();
  if (message) setNotice('play-notice', message);
  renderAll();
}

async function playCurrent() {
  const id = playback.currentTrackId;
  const started = await player.play({ id, title: playback.currentTitle });
  if (started) {
    playback.failures = 0;
    playback.loadedId = id;
    setNotice('play-notice', '');
    const nextId = computeNext(false);
    if (nextId !== null && nextId !== id) player.prefetch(nextId);
  }
  renderAll();
}

function moveTo(id) {
  if (id === null) return stopPlayback(COPY.noPlayable);
  playback.playingPlaylistId ??= model.viewedId;
  playback.currentTrackId = id;
  playback.currentTitle = titleOf(id);
  syncLastIndex();
  renderAll();
  return playCurrent();
}

// 사용자가 누른 이동. 연속 실패 횟수를 다시 센다.
function userMove(id) {
  playback.failures = 0;
  return moveTo(id);
}

function onTrackEnded() {
  moveTo(computeNext(false));
}

// 받기·재생 실패. 다른 곡이 눌렸으면 player가 이미 버렸으므로 여기 오지 않는다.
function onTrackFailed(err) {
  if (err.code === 'expired') {
    setNotice('play-notice', COPY.reopen);
    return renderAll();
  }
  if (err.code === 'too_big') {
    playback.unplayable = new Set([...playback.unplayable, playback.currentTrackId]);
  } else {
    playback.failures += 1;
    setNotice('play-notice', COPY.trackFailed);
  }
  // 목록 곡 수만큼 연속 실패하면 한 바퀴를 다 돈 것이다. 멈춘다.
  if (playback.failures >= playingIds().length) return stopPlayback();
  moveTo(computeNext(true));
}

function onPlayRow(id) {
  if (playback.unplayable.has(id)) return;
  playback.playingPlaylistId = model.viewedId;
  userMove(id);
}

function onPlayPause() {
  if (playback.currentTrackId === null) return userMove(computeNext(true));
  // 실패로 멈춘 뒤라면 지금 곡을 다시 받아 튼다. 이미 올라온 곡이면 토글만 한다.
  if (playback.currentTrackId !== playback.loadedId) return userMove(playback.currentTrackId);
  player.toggle();
  return undefined;
}

function onRepeat() {
  playback.repeat = REPEAT_ORDER[(REPEAT_ORDER.indexOf(playback.repeat) + 1) % REPEAT_ORDER.length];
  writeLocal(KEY_REPEAT, playback.repeat);
  renderAll();
}

async function refreshFromServer() {
  const mine = ++refreshSeq;
  await saves.flushAll();
  const seenSaves = saves.saved();
  let state;
  try {
    state = await api.state();
  } catch (err) {
    return showSaveNotice(err.code === 'expired' ? COPY.reopen : COPY.loadFailed);
  }
  // 겹쳐서 온 요청은 가장 나중에 시작한 것만 적용한다.
  if (mine !== refreshSeq) return;
  // 받는 동안 저장이 끝났으면 이 응답은 그 저장 전 값일 수 있다. 다시 받는다.
  if (seenSaves !== saves.saved()) return refreshFromServer();
  // 저장이 실패해 남은 편집은 서버 값보다 우선한다.
  const local = new Map(model.playlists.map((p) => [p.id, p]));
  model.playlists = state.playlists.map((p) => (saves.pending(p.id) ? (local.get(p.id) ?? p) : p));
  model.library = state.library;
  if (!model.playlists.some((p) => p.id === model.viewedId)) model.viewedId = state.active_id;
  writeLocal(KEY_PLAYLIST, String(model.viewedId));
  syncLastIndex();
  renderAll();
}

async function init() {
  const initData = tg?.initData ?? '';
  if (!IS_LOCAL && !initData) return showFatal(COPY.openFromMenu);

  const makeApi = IS_LOCAL ? (await import('./fake-api.js')).createApi : createApi;
  api = makeApi(API_BASE, initData);
  player = createPlayer({
    api,
    onChange: () => renderBar(barState()),
    onTrackEnd: onTrackEnded,
    onError: onTrackFailed,
    onSkip: (dir) => (dir === 'next' ? userMove(computeNext(true)) : userMove(computePrev())),
  });

  let state;
  try {
    state = await api.state();
  } catch (err) {
    return showFatal(err.code === 'expired' ? COPY.reopen : COPY.loadFailed);
  }
  model.library = state.library;
  model.playlists = state.playlists;
  const remembered = Number(readLocal(KEY_PLAYLIST));
  model.viewedId = model.playlists.some((p) => p.id === remembered) ? remembered : state.active_id;
  // 기억해 둔 목록을 보여 주되, 봇이 새 곡을 붙이는 활성 목록도 그 목록으로 맞춘다.
  if (model.viewedId !== state.active_id) activeSender.request(model.viewedId);
  const repeat = readLocal(KEY_REPEAT);
  playback.repeat = REPEAT_ORDER.includes(repeat) ? repeat : 'all';

  setVisible('app', true);
  setVisible('bar', true);
  renderAll();

  enableQueueSort({
    onStart: () => {
      dragging = true;
      dragPlaylistId = model.viewedId;
    },
    onEnd: (evt) => {
      dragging = false;
      // 제자리에 놓았거나 끄는 사이 다른 목록을 보았다면 저장하지 않는다. 그 DOM은 지금 목록의 것이 아니다.
      if (evt.oldIndex !== evt.newIndex && model.viewedId === dragPlaylistId) {
        editViewed(mergeOrder(queueIds(), viewedIds()));
      }
      renderAll();
    },
  });
  $('picker').addEventListener('change', onPickerChange);
  $('rename-playlist').addEventListener('click', openRename);
  $('new-form').addEventListener('submit', onCreatePlaylist);
  $('new-cancel').addEventListener('click', onCancelNew);
  $('remove-playlist').addEventListener('click', onDeletePlaylist);
  $('prev').addEventListener('click', () => userMove(computePrev()));
  $('toggle').addEventListener('click', onPlayPause);
  $('next').addEventListener('click', () => userMove(computeNext(true)));
  $('repeat').addEventListener('click', onRepeat);
  $('seek').addEventListener('input', (e) => player.seek(Number(e.target.value)));
  // 백그라운드에서 돌아오면 서버 값을 새로 받는다. 재생은 건드리지 않는다.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshFromServer();
  });
}

init().catch((err) => {
  console.error(err);
  showFatal(COPY.loadFailed);
});
