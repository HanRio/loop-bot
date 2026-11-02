// 화면 상태와 재생 흐름. 그리기는 render.js, 네트워크는 api.js, 저장은 store.js, 재생은 audio.js, 가사집은 lyrics.js가 맡는다.
import { createApi } from './api.js';
import { createPlayer } from './audio.js';
import { COPY } from './copy.js';
import { createLyrics } from './lyrics.js';
import { nextTrack, prevTrack } from './queue.js';
import {
  $, closeNameForm, enableQueueSort, openNameForm, renderPicker, renderQueue, renderLibrary, renderBar, renderShare,
  renderViewSwitch, setNotice, setVisible,
} from './render.js';
import { cleanName, cleanTitle, createActiveSender, createSaves, mergeOrder, readLocal, writeLocal } from './store.js';
import { startPlaylistId } from './lyrics-logic.js';

const API_BASE = 'https://rrpmpqxoqxlwrmflpiyi.supabase.co/functions/v1/loopbot-api';
const FILE_BASE = 'https://168-110-54-40.sslip.io';
const IS_LOCAL = location.hostname === 'localhost';
const NEW_PLAYLIST = 'new';
const REPEAT_ORDER = ['all', 'one', 'off'];
const KEY_PLAYLIST = 'loopbot.player.playlist';
const KEY_REPEAT = 'loopbot.player.repeat';
const KEY_GUIDE = 'loopbot.player.guideSeen';
const NAME_MAX = 20;
const TRACK_NAME_MAX = 200;

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

const model = {
  library: [],
  playlists: [],
  viewedId: null,
  sharedPlaylists: [],
  sharedTracks: [],
  media: {},
  notes: {},
  isAdmin: false,
};
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
let lyrics;
// 끄는 동안에는 자동 전환이 목록 DOM을 바꾸지 않는다. 끝나면 onQueueEnd에서 다시 그린다.
let dragging = false;
// 지우는 중인 플레이리스트는 편집을 받지 않는다.
let deletingId = null;
// 끌기를 시작한 목록. 끝날 때 보고 있는 목록이 같을 때만 순서를 저장한다.
let dragPlaylistId = null;
let refreshSeq = 0;
// 이름 입력줄이 지금 무슨 일을 하는지. 'create' | 'rename' | { kind: 'track', id } | null
let nameFormMode = null;
// 보기 방식. 'list'는 재생 순서와 라이브러리, 'lyrics'는 가사집.
let viewMode = 'list';

const saves = createSaves({
  save: async (value) => {
    await api.savePlaylist(value.id, value.name, value.track_ids);
    // PUT은 그 목록을 활성으로 만든다. 내 다른 목록을 보고 있으면 활성을 그쪽으로 되돌린다.
    if (value.id !== model.viewedId && isOwnId(model.viewedId)) activeSender.request(model.viewedId);
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

// 곡 이름 표는 내 라이브러리와 공유 곡을 합친다.
const allTracks = () => [...model.library, ...model.sharedTracks];
const titleOf = (id) => allTracks().find((t) => t.id === id)?.title ?? '';
const titleMap = () => new Map(allTracks().map((t) => [t.id, t.title]));
// 내 목록과 공유 목록 모두에서 찾는다.
const findPlaylist = (id) => model.playlists.find((p) => p.id === id) ?? model.sharedPlaylists.find((p) => p.id === id);
const isOwnId = (id) => model.playlists.some((p) => p.id === id);
// 재생 중인 목록이 지워졌으면 빈 목록이 되어 다음 곡이 없고 멈춘다.
const playlistIds = (id) => findPlaylist(id)?.track_ids ?? [];
const viewedIds = () => playlistIds(model.viewedId);
const playingIds = () => playlistIds(playback.playingPlaylistId ?? model.viewedId);
// 내 목록만 돌려준다. 편집과 이름 바꾸기는 이것만 건드린다.
const viewedPlaylist = () => model.playlists.find((p) => p.id === model.viewedId);
// 보이는 목록(내 것이든 공유든).
const viewedAny = () => findPlaylist(model.viewedId);
const viewedShared = () => !viewedPlaylist() && Boolean(viewedAny());
// 공유 목록은 가사집으로, 내 목록은 목록으로 연다.
const modeFor = (id) => (isOwnId(id) ? 'list' : 'lyrics');
const queueIds = () => [...$('queue').children].map((li) => Number(li.dataset.id));
const barState = () => ({ title: playback.currentTitle, position: player?.position() ?? 0, duration: player?.duration() ?? 0, playing: player?.isPlaying() ?? false, repeat: playback.repeat });

function lyricsState() {
  return {
    visible: viewMode === 'lyrics',
    playlistId: model.viewedId,
    trackIds: viewedIds(),
    titles: titleMap(),
    media: model.media,
    notes: model.notes,
    canEdit: model.isAdmin && isOwnId(model.viewedId),
    currentId: playback.currentTrackId,
  };
}

function renderAll() {
  const ids = viewedIds();
  const shared = viewedShared();
  renderPicker(model.playlists, model.sharedPlaylists, model.viewedId, NEW_PLAYLIST);
  renderShare({ visible: model.isAdmin && !shared, shared: Boolean(viewedPlaylist()?.shared) });
  renderViewSwitch({ visible: model.isAdmin || shared, mode: viewMode });
  // 공유 목록은 이름 바꾸기와 삭제가 없다.
  setVisible('rename-playlist', !shared);
  setVisible('remove-playlist', !shared);
  setVisible('queue-card', viewMode === 'list');
  setVisible('library-card', viewMode === 'list' && !shared);
  if (!dragging) {
    renderQueue(ids, { titles: titleMap(), currentId: playback.currentTrackId, unplayable: playback.unplayable }, {
      onPlay: onPlayRow,
      onRemove: onRemoveFromQueue,
    }, { readOnly: shared });
  }
  renderLibrary(model.library, new Set(ids), {
    onAdd: onAddToQueue,
    onDelete: onDeleteTrack,
    onRename: openTrackRename,
  });
  lyrics.sync(lyricsState());
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
  if (!confirm(model.isAdmin ? COPY.deleteTrackAdminConfirm : COPY.deleteTrackConfirm)) return;
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

function openTrackRename(id) {
  nameFormMode = { kind: 'track', id };
  openNameForm({ value: titleOf(id), submitLabel: COPY.rename, maxLength: TRACK_NAME_MAX });
}

function setLibraryTitle(id, title) {
  model.library = model.library.map((t) => (t.id === id ? { ...t, title } : t));
}

// 먼저 화면에 반영하고, 실패하면 되돌리고 알린다. 비었거나 그대로면 보내지 않는다.
async function renameTrack(id, raw) {
  const title = cleanTitle(raw);
  const old = titleOf(id);
  if (!title || title === old) return;
  setLibraryTitle(id, title);
  renderAll();
  try {
    await api.renameTrack(id, title);
  } catch (err) {
    setLibraryTitle(id, old);
    renderAll();
    showSaveNotice(err.code === 'expired' ? COPY.reopen : COPY.renameFailed);
  }
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
  openNameForm({ value: playlist.name, submitLabel: COPY.rename, maxLength: NAME_MAX });
}

function closeNameFormAndReset() {
  nameFormMode = null;
  closeNameForm();
}

async function onPickPlaylist(id) {
  closeNameFormAndReset();
  if (id === model.viewedId) return renderAll();
  await saves.flushAll();
  // 관리자가 내 목록끼리 옮길 때는 보기 방식을 지킨다. 그 밖에는 modeFor를 따른다.
  const keepMode = model.isAdmin && isOwnId(model.viewedId) && isOwnId(id);
  model.viewedId = id;
  viewMode = keepMode ? viewMode : modeFor(id);
  writeLocal(KEY_PLAYLIST, String(id));
  renderAll();
  // 공유 목록을 골라도 활성 목록은 바꾸지 않는다. 봇이 받는 곡은 내 목록에 붙는다.
  if (isOwnId(id)) activeSender.request(id);
}

function onViewMode(mode) {
  viewMode = mode;
  renderAll();
}

// 공유를 낙관적으로 바꾸고, 실패하면 되돌리고 알린다.
function setPlaylistShared(id, shared) {
  model.playlists = model.playlists.map((p) => (p.id === id ? { ...p, shared } : p));
}

async function onToggleShare() {
  const playlist = viewedPlaylist();
  if (!playlist || !model.isAdmin) return;
  const next = !playlist.shared;
  setPlaylistShared(playlist.id, next);
  renderAll();
  try {
    await api.setShared(playlist.id, next);
  } catch (err) {
    setPlaylistShared(playlist.id, !next);
    renderAll();
    showSaveNotice(err.code === 'expired' ? COPY.reopen : COPY.shareFailed);
  }
}

async function onCreatePlaylist(event) {
  event.preventDefault();
  const name = $('new-name').value;
  const mode = nameFormMode;
  closeNameFormAndReset();
  if (mode?.kind === 'track') {
    await renameTrack(mode.id, name);
    return;
  }
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
    viewMode = 'list';
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
    return openNameForm({ value: '', submitLabel: COPY.create, maxLength: NAME_MAX });
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
  // 영상이 열려 있으면 닫고 그 곡을 튼다.
  lyrics.closeVideo();
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

// 참고 영상을 여는 동안은 오디오를 멈추고 재생 바를 숨긴다. 닫아도 오디오는 자동으로 틀지 않는다.
function onVideoToggle(open) {
  document.body.classList.toggle('video-open', open);
  setVisible('bar', !open);
  if (!open) return;
  // 받는 중이던 곡은 버려서 영상을 연 뒤에 소리가 나지 않게 한다.
  player.cancel();
  if (player.isPlaying()) player.toggle();
}

function onMediaChange(id, next) {
  model.media = { ...model.media, [id]: next };
  renderAll();
}

async function refreshFromServer() {
  const mine = ++refreshSeq;
  await saves.flushAll();
  await lyrics.flush();
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
  model.sharedPlaylists = state.shared_playlists;
  model.sharedTracks = state.shared_tracks;
  model.media = state.media;
  model.notes = state.notes;
  model.isAdmin = state.is_admin;
  // 보고 있던 목록이 내 목록에서도 공유 목록에서도 사라졌으면(공유 해제 등) 활성 목록으로 돌아간다.
  if (!findPlaylist(model.viewedId)) {
    model.viewedId = state.active_id;
    viewMode = modeFor(model.viewedId);
  }
  writeLocal(KEY_PLAYLIST, String(model.viewedId));
  syncLastIndex();
  renderAll();
}

async function init() {
  const initData = tg?.initData ?? '';
  if (!IS_LOCAL && !initData) return showFatal(COPY.openFromMenu);

  const makeApi = IS_LOCAL ? (await import('./fake-api.js')).createApi : createApi;
  api = makeApi(API_BASE, initData, FILE_BASE);
  player = createPlayer({
    api,
    onChange: () => renderBar(barState()),
    onTrackEnd: onTrackEnded,
    onError: onTrackFailed,
    onSkip: (dir) => (dir === 'next' ? userMove(computeNext(true)) : userMove(computePrev())),
  });
  lyrics = createLyrics({
    api,
    getState: lyricsState,
    onPlay: onPlayRow,
    onError: reportError,
    onMediaChange,
    onVideoToggle,
  });

  let state;
  try {
    state = await api.state();
  } catch (err) {
    return showFatal(err.code === 'expired' ? COPY.reopen : COPY.loadFailed);
  }
  model.library = state.library;
  model.playlists = state.playlists;
  model.sharedPlaylists = state.shared_playlists;
  model.sharedTracks = state.shared_tracks;
  model.media = state.media;
  model.notes = state.notes;
  model.isAdmin = state.is_admin;
  model.viewedId = startPlaylistId({
    rememberedId: Number(readLocal(KEY_PLAYLIST)),
    activeId: state.active_id,
    playlists: state.playlists,
    sharedPlaylists: state.shared_playlists,
  });
  viewMode = modeFor(model.viewedId);
  // 기억해 둔 내 목록이면, 봇이 새 곡을 붙이는 활성 목록도 그 목록으로 맞춘다.
  if (model.viewedId !== state.active_id && isOwnId(model.viewedId)) activeSender.request(model.viewedId);
  const repeat = readLocal(KEY_REPEAT);
  playback.repeat = REPEAT_ORDER.includes(repeat) ? repeat : 'all';

  setVisible('app', true);
  setVisible('guide', !readLocal(KEY_GUIDE));
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
  $('guide-close').addEventListener('click', () => {
    writeLocal(KEY_GUIDE, '1');
    setVisible('guide', false);
  });
  $('guide-open').addEventListener('click', () => {
    setVisible('guide', true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  $('share-playlist').addEventListener('click', onToggleShare);
  $('view-list').addEventListener('click', () => onViewMode('list'));
  $('view-lyrics').addEventListener('click', () => onViewMode('lyrics'));
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
