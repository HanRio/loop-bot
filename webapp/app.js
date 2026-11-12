// 상태와 재생 흐름, 화면 조립. 탭 그리기는 tab-*.js, 탭 넘김·플레이어 열기는 shell.js, 네트워크는 api.js, 저장은 store.js, 재생은 audio.js가 맡는다.
import { createApi } from './api.js';
import { createPlayer } from './audio.js';
import { createPlayerLyrics } from './player-lyrics.js';
import { COPY } from './copy.js';
import { $ } from './dom.js';
import { embedUrl, startPlaylistId, watchUrl } from './lyrics-logic.js';
import { askName, openListPicker, openMenu } from './menus.js';
import { nextTrack, prevTrack } from './queue.js';
import { createShell } from './shell.js';
import { cleanName, cleanTitle, createActiveSender, createSaves, mergeOrder, readLocal, writeLocal } from './store.js';
import { createConti } from './tab-conti.js';
import { createLibrary } from './tab-library.js';
import { createMeditate } from './tab-meditate.js';
import { createPractice } from './tab-practice.js';
import { moodFor } from './ui-logic.js';
import { createUsersAdmin } from './users-admin.js';
import { initVolume } from './volume.js';
import { attach as scrollTitle, initTitleScroll } from './title-scroll.js';

const API_BASE = 'https://rrpmpqxoqxlwrmflpiyi.supabase.co/functions/v1/loopbot-api';
const FILE_BASE = 'https://168-110-54-40.sslip.io';
const IS_LOCAL = location.hostname === 'localhost';
const REPEAT_ORDER = ['all', 'one', 'off'];
const REPEAT_LABEL = { all: '전체 반복', one: '한 곡 반복', off: '반복 끔' };
const KEY_PLAYLIST = 'loopbot.player.playlist';
const KEY_REPEAT = 'loopbot.player.repeat';
const NAME_MAX = 20;
const TRACK_NAME_MAX = 200;
const SURFACE = '#EEF2F6';
const VIDEO_ALLOW = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
const ICON_PLAY = 'M8 5l11 7-11 7z';
const ICON_PAUSE = 'M8 5v14M16 5v14';
const TEXT = {
  noTrack: '곡을 골라 주세요',
  listName: '목록 이름',
  newList: '새 목록',
  trackName: '곡 이름',
  rename: '이름 바꾸기',
  shareOn: '공유 켜기',
  shareOff: '공유 끄기',
  deleteList: '목록 지우기',
  addToList: '목록에 담기',
  removeFromList: '목록에서 빼기',
  deleteTrack: '라이브러리에서 지우기',
};

const tg = window.Telegram?.WebApp;
try {
  tg?.ready();
  tg?.expand();
  // 목록을 끌 때 세로 스와이프로 미니앱이 닫히지 않게 한다.
  tg?.disableVerticalSwipes?.();
  // 화면은 밝은 한 가지라 텔레그램 상단·배경을 바탕색에 맞춘다.
  tg?.setHeaderColor?.(SURFACE);
  tg?.setBackgroundColor?.(SURFACE);
} catch {
  // 텔레그램 밖이거나 오래된 버전이면 그냥 연다.
}

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
let usersAdmin;
let shell;
let conti;
let library;
let meditate;
let practice;
// 지우는 중인 플레이리스트는 편집을 받지 않는다.
let deletingId = null;
let refreshSeq = 0;
// 열린 참고 영상의 곡. 없으면 null.
let videoTrackId = null;

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
// 라이브러리에서 목록 밖 곡을 틀면 라이브러리 전체를 큐로 쓴다.
const LIBRARY_QUEUE = 'library';
const playlistIds = (id) => (id === LIBRARY_QUEUE ? model.library.map((t) => t.id) : findPlaylist(id)?.track_ids ?? []);
const viewedIds = () => playlistIds(model.viewedId);
const playingIds = () => playlistIds(playback.playingPlaylistId ?? model.viewedId);
// 내 목록만 돌려준다. 편집과 이름 바꾸기는 이것만 건드린다.
const viewedPlaylist = () => model.playlists.find((p) => p.id === model.viewedId);
const canEdit = () => model.isAdmin && isOwnId(model.viewedId);
const artOf = (id) => {
  const [first, , third] = moodFor(id ?? 0);
  return `linear-gradient(150deg, ${first}, ${third})`;
};
const errText = (err, fallback) => (err.code === 'expired' ? COPY.reopen : fallback);

function setNotice(id, text) {
  $(id).textContent = text;
}

function showSaveNotice(text) {
  setNotice('save-notice', text);
}

function reportError(err) {
  showSaveNotice(errText(err, COPY.saveFailed));
}

function showFatal(text) {
  setNotice('fatal', text);
  $('fatal').hidden = false;
}

function formatTime(seconds) {
  const whole = Math.floor(Number.isFinite(seconds) ? seconds : 0);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

// 미니·전체 플레이어. 재생기가 바뀔 때마다(시간 포함) 부른다.
// 매 틱마다 같은 글자를 다시 넣으면 흐르던 제목이 끊기니, 바뀔 때만 넣는다.
function setText(id, text) {
  const node = $(id);
  if (node.textContent === text) return;
  node.textContent = text;
  node.scrollLeft = 0;
}

// 재생기는 위치를 1초에 4번쯤만 알려 줘서 막대가 툭툭 끊겨 보인다. 재생 중에는 화면 새로 고침마다 막대만 다시 칠한다.
let seekDragging = false;
let progressFrame = 0;

function paintProgress() {
  const position = player?.position() ?? 0;
  const duration = player?.duration() ?? 0;
  const percent = `${duration > 0 ? (position / duration) * 100 : 0}%`;
  $('mini-prog').firstElementChild.style.width = percent;
  const seek = $('seek');
  seek.max = String(duration);
  lyrics?.tick(position);
  if (!seekDragging) seek.value = String(position);
  seek.style.setProperty('--progress', percent);
  const now = formatTime(position);
  if ($('t-now').textContent !== now) $('t-now').textContent = now;
}

function progressLoop() {
  paintProgress();
  progressFrame = player?.isPlaying() && !document.hidden ? requestAnimationFrame(progressLoop) : 0;
}

function renderPlayer() {
  const id = playback.currentTrackId;
  const duration = player?.duration() ?? 0;
  const playing = player?.isPlaying() ?? false;
  const loading = player?.isLoading?.() ?? false;
  const title = id === null ? TEXT.noTrack : playback.currentTitle;
  const sub = findPlaylist(playback.playingPlaylistId ?? model.viewedId)?.name ?? '';
  const playLabel = playing ? '일시정지' : '재생';

  setText('mini-title', title);
  $('mini-sub').textContent = sub;
  $('mini-art').style.background = artOf(id);
  $('mini-play-icon').setAttribute('d', playing ? ICON_PAUSE : ICON_PLAY);
  $('mini-play').setAttribute('aria-label', playLabel);

  setText('player-title', title);
  $('player-sub').textContent = sub;
  $('player-art').style.background = artOf(id);
  lyrics?.show(id);
  $('t-all').textContent = loading ? COPY.downloading : formatTime(duration);
  paintProgress();
  if (playing && !progressFrame) progressFrame = requestAnimationFrame(progressLoop);
  $('play-icon').setAttribute('d', playing ? ICON_PAUSE : ICON_PLAY);
  const play = $('play');
  play.setAttribute('aria-label', playLabel);
  play.setAttribute('aria-busy', String(loading));
  const repeat = $('repeat');
  repeat.dataset.mode = playback.repeat;
  repeat.setAttribute('aria-label', REPEAT_LABEL[playback.repeat]);
  repeat.classList.toggle('on', playback.repeat !== 'off');
  // 악보 보기는 묵상 탭이 보여 주는 목록 안의 곡에만 있다.
  $('player-sheet').hidden = id === null || !viewedIds().includes(id) || !(model.media[id]?.sheet_count > 0);
  const media = id === null ? null : model.media[id];
  $('video-open').hidden = id === null || (!media?.video_id && !canEdit());
}

function renderAll() {
  const ids = viewedIds();
  const titles = titleMap();
  const isOwn = Boolean(viewedPlaylist());
  // 끄는 중에 다시 그리면 Sortable이 부서진다. 끝나면 onReorder가 다시 그린다.
  if (!$('tab-conti').querySelector('.ghost')) {
    conti.render({
      listName: findPlaylist(model.viewedId)?.name ?? '',
      isOwn,
      shared: Boolean(viewedPlaylist()?.shared),
      trackIds: ids,
      titles,
      currentId: playback.currentTrackId,
      unplayable: playback.unplayable,
      playing: player?.isPlaying() ?? false,
    });
  }
  library.render({
    library: model.library,
    playlists: model.playlists,
    sharedPlaylists: model.sharedPlaylists,
    currentId: playback.currentTrackId,
    unplayable: playback.unplayable,
  });
  meditate.render({
    trackIds: ids,
    titles,
    media: model.media,
    notes: model.notes,
    currentId: playback.currentTrackId,
    canEdit: canEdit(),
    playlistId: model.viewedId,
  });
  practice.render({ currentId: playback.currentTrackId });
  renderPlayer();
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

// 끄는 사이 보고 있는 목록이 바뀌었으면 그 순서는 지금 목록 것이 아니니 버린다.
function onReorder(ids) {
  const current = viewedIds();
  const same = ids.length === current.length && ids.every((id) => current.includes(id));
  if (same) editViewed(mergeOrder(ids, current));
  renderAll();
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
    if (err.code !== 'not_found') return showSaveNotice(errText(err, COPY.deleteFailed));
  }
  model.library = model.library.filter((t) => t.id !== id);
  model.playlists = model.playlists.map((p) =>
    p.track_ids.includes(id) ? { ...p, track_ids: p.track_ids.filter((x) => x !== id) } : p,
  );
  syncLastIndex();
  player.forget(id);
  renderAll();
}

function setLibraryTitle(id, title) {
  model.library = model.library.map((t) => (t.id === id ? { ...t, title } : t));
  if (playback.currentTrackId === id) playback.currentTitle = title;
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
    showSaveNotice(errText(err, COPY.renameFailed));
  }
}

async function openTrackRename(id) {
  const name = await askName({ value: titleOf(id), title: TEXT.trackName, max: TRACK_NAME_MAX });
  if (name !== null) await renameTrack(id, name);
}

async function openRename() {
  const playlist = viewedPlaylist();
  if (!playlist) return;
  const raw = await askName({ value: playlist.name, title: TEXT.listName, max: NAME_MAX });
  const current = viewedPlaylist();
  const name = raw === null ? '' : cleanName(raw);
  // 비웠거나 그대로면 바꾸지 않는다. 서버는 빈 이름을 '새 플레이리스트'로 덮어쓴다. 묻는 사이 다른 목록으로 갔으면 버린다.
  if (!current || current.id !== playlist.id || current.id === deletingId || !name || name === current.name) return;
  const updated = { ...current, name };
  model.playlists = model.playlists.map((p) => (p.id === updated.id ? updated : p));
  saves.update({ id: updated.id, name: updated.name, track_ids: updated.track_ids });
  renderAll();
}

async function onPickPlaylist(id) {
  if (id === model.viewedId) return renderAll();
  await saves.flushAll();
  model.viewedId = id;
  writeLocal(KEY_PLAYLIST, String(id));
  renderAll();
  // 공유 목록을 골라도 활성 목록은 바꾸지 않는다. 봇이 받는 곡은 내 목록에 붙는다.
  if (isOwnId(id)) activeSender.request(id);
  return undefined;
}

async function onOpenLists() {
  const id = await openListPicker({
    playlists: model.playlists,
    sharedPlaylists: model.sharedPlaylists,
    currentId: model.viewedId,
  });
  if (id !== null) await onPickPlaylist(id);
}

async function onOpenList(id) {
  await onPickPlaylist(id);
  shell.goTab(0);
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
    showSaveNotice(errText(err, COPY.shareFailed));
  }
}

async function onNewList() {
  const name = await askName({ value: '', title: TEXT.newList, max: NAME_MAX });
  if (name === null) return;
  await saves.flushAll();
  try {
    const playlist = await api.createPlaylist(name, []);
    model.playlists = [...model.playlists, playlist];
    model.viewedId = playlist.id;
    writeLocal(KEY_PLAYLIST, String(playlist.id));
    // 대기 중이던 활성 전송이 방금 만든 목록을 덮지 않도록 다시 맞춘다.
    activeSender.request(playlist.id);
    shell.goTab(0);
  } catch (err) {
    reportError(err);
  }
  renderAll();
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
      return showSaveNotice(errText(err, COPY.deleteFailed));
    }
  }
  deletingId = null;
  // 마지막 목록이었으면 서버가 기본을 새로 만든다. 그 값은 상태를 다시 받아서 맞춘다.
  return refreshFromServer();
}

// 콘티 머리줄 ⋯. 내 목록에서만 보인다.
function onListMenu() {
  const playlist = viewedPlaylist();
  if (!playlist) return;
  const items = [{ label: TEXT.rename, run: openRename }];
  if (model.isAdmin) items.push({ label: playlist.shared ? TEXT.shareOff : TEXT.shareOn, run: onToggleShare });
  items.push({ label: TEXT.deleteList, danger: true, run: onDeletePlaylist });
  openMenu(items);
}

// 라이브러리 곡 ⋯. 담기·빼기는 보고 있는 목록이 내 것일 때만.
function onTrackMenu(id) {
  const items = [];
  if (viewedPlaylist()) {
    items.push(viewedIds().includes(id)
      ? { label: TEXT.removeFromList, run: () => onRemoveFromQueue(id) }
      : { label: TEXT.addToList, run: () => onAddToQueue(id) });
  }
  items.push({ label: TEXT.rename, run: () => openTrackRename(id) });
  items.push({ label: TEXT.deleteTrack, danger: true, run: () => onDeleteTrack(id) });
  openMenu(items);
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

function pauseAudio() {
  // 받는 중이던 곡이 있으면 버린다. 멈춘 뒤에 도착해 재생되지 않게 한다.
  player.cancel();
  if (player.isPlaying()) player.toggle();
}

function stopPlayback(message) {
  pauseAudio();
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
  shell.setMood(id);
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
  return moveTo(computeNext(true));
}

function onPlayRow(id) {
  if (playback.unplayable.has(id)) return;
  // 영상이 열려 있으면 닫고 그 곡을 튼다.
  closeVideo();
  playback.playingPlaylistId = viewedIds().includes(id) ? model.viewedId : LIBRARY_QUEUE;
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
  renderPlayer();
}

// 참고 영상. 링크가 있으면 iframe으로 열고, 편집할 수 있으면 링크를 바꾸는 칸도 보인다. 여는 동안 오디오는 멈춘다.
const videoForm = document.createElement('form');
const videoInput = document.createElement('input');
const videoSave = document.createElement('button');
const videoError = document.createElement('p');

function buildVideoForm() {
  videoForm.className = 'video-link';
  videoInput.type = 'url';
  videoInput.inputMode = 'url';
  videoInput.setAttribute('aria-label', COPY.videoLink);
  videoInput.placeholder = COPY.videoLink;
  const box = document.createElement('label');
  box.className = 'search glass';
  box.append(videoInput);
  videoSave.type = 'submit';
  videoSave.className = 'btn';
  videoSave.textContent = COPY.save;
  videoError.className = 'notice';
  videoError.setAttribute('role', 'alert');
  videoForm.append(box, videoSave, videoError);
  videoForm.addEventListener('submit', onSaveVideo);
  $('video-panel').insertBefore(videoForm, $('video-panel').querySelector('.video-foot'));
}

function paintVideo() {
  const videoId = model.media[videoTrackId]?.video_id ?? null;
  if (!videoId) {
    $('video-frame').replaceChildren();
  } else if ($('video-frame').dataset.videoId !== videoId) {
    const frame = document.createElement('iframe');
    frame.src = embedUrl(videoId);
    frame.allow = VIDEO_ALLOW;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.allowFullscreen = true;
    frame.title = `${titleOf(videoTrackId)} ${COPY.videoOpen}`;
    $('video-frame').replaceChildren(frame);
  }
  $('video-frame').dataset.videoId = videoId ?? '';
  $('video-frame').hidden = !videoId;
  $('video-youtube').hidden = !videoId;
  videoForm.hidden = !canEdit();
  videoInput.value = videoId ? watchUrl(videoId) : '';
}

function openVideo() {
  const id = playback.currentTrackId;
  if (id === null) return;
  videoTrackId = id;
  videoError.textContent = '';
  paintVideo();
  $('video-panel').hidden = false;
  pauseAudio();
  renderPlayer();
}

function closeVideo() {
  if (videoTrackId === null) return;
  videoTrackId = null;
  $('video-frame').replaceChildren();
  $('video-frame').dataset.videoId = '';
  $('video-panel').hidden = true;
}

async function onSaveVideo(event) {
  event.preventDefault();
  const id = videoTrackId;
  if (id === null) return;
  videoSave.disabled = true;
  videoError.textContent = '';
  try {
    const { video_id: videoId } = await api.saveVideo(id, videoInput.value.trim());
    model.media = { ...model.media, [id]: { ...model.media[id], video_id: videoId ?? null } };
    if (videoTrackId === id) paintVideo();
    renderPlayer();
  } catch (err) {
    videoError.textContent = err.code === 'bad_request' ? COPY.videoInvalid : errText(err, COPY.videoFailed);
  } finally {
    videoSave.disabled = false;
  }
}

function openYoutube() {
  const videoId = model.media[videoTrackId]?.video_id;
  if (!videoId) return;
  const url = watchUrl(videoId);
  if (tg?.openLink) tg.openLink(url);
  else window.open(url, '_blank', 'noopener');
}

function onMediaChange(id, next) {
  model.media = { ...model.media, [id]: next };
  renderAll();
}

function onOpenSheet() {
  const id = playback.currentTrackId;
  if (id === null) return;
  shell.closePlayer();
  shell.goTab(2);
  meditate.openTrack(id);
}

function applyState(state) {
  model.library = state.library;
  model.sharedPlaylists = state.shared_playlists;
  model.sharedTracks = state.shared_tracks;
  model.media = state.media;
  model.notes = state.notes;
  model.isAdmin = state.is_admin;
  usersAdmin.setVisible(state.is_admin, state.is_owner);
}

async function refreshFromServer() {
  const mine = ++refreshSeq;
  await saves.flushAll();
  await meditate.flush();
  const seenSaves = saves.saved();
  let state;
  try {
    state = await api.state();
  } catch (err) {
    return showSaveNotice(errText(err, COPY.loadFailed));
  }
  // 겹쳐서 온 요청은 가장 나중에 시작한 것만 적용한다.
  if (mine !== refreshSeq) return undefined;
  // 받는 동안 저장이 끝났으면 이 응답은 그 저장 전 값일 수 있다. 다시 받는다.
  if (seenSaves !== saves.saved()) return refreshFromServer();
  // 저장이 실패해 남은 편집은 서버 값보다 우선한다.
  const local = new Map(model.playlists.map((p) => [p.id, p]));
  model.playlists = state.playlists.map((p) => (saves.pending(p.id) ? (local.get(p.id) ?? p) : p));
  applyState(state);
  // 보고 있던 목록이 내 목록에서도 공유 목록에서도 사라졌으면(공유 해제 등) 활성 목록으로 돌아간다.
  if (!findPlaylist(model.viewedId)) model.viewedId = state.active_id;
  writeLocal(KEY_PLAYLIST, String(model.viewedId));
  syncLastIndex();
  if (videoTrackId !== null) paintVideo();
  renderAll();
  return undefined;
}

function wireSettings() {
  const dialog = $('settings-dialog');
  $('settings-close').addEventListener('click', () => dialog.close());
  // 사용자 관리 창은 users-admin.js가 연다. 설정 창은 겹치지 않게 닫는다.
  $('settings-users').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

function wireControls() {
  $('mini-play').addEventListener('click', onPlayPause);
  $('mini-next').addEventListener('click', () => userMove(computeNext(true)));
  $('prev').addEventListener('click', () => userMove(computePrev()));
  $('play').addEventListener('click', onPlayPause);
  $('next').addEventListener('click', () => userMove(computeNext(true)));
  $('repeat').addEventListener('click', onRepeat);
  $('seek').addEventListener('input', (e) => {
    seekDragging = true;
    player.seek(Number(e.target.value));
  });
  $('seek').addEventListener('change', () => { seekDragging = false; });
  $('seek').addEventListener('pointerup', () => { seekDragging = false; });
  $('player-sheet').addEventListener('click', onOpenSheet);
  $('video-open').addEventListener('click', openVideo);
  $('video-close').addEventListener('click', closeVideo);
  $('video-youtube').addEventListener('click', openYoutube);
  // 백그라운드에서 돌아오면 서버 값을 새로 받는다. 재생은 건드리지 않는다.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshFromServer();
  });
}

async function init() {
  const initData = tg?.initData ?? '';
  if (!IS_LOCAL && !initData) return showFatal(COPY.openFromMenu);

  const makeApi = IS_LOCAL ? (await import('./fake-api.js')).createApi : createApi;
  api = makeApi(API_BASE, initData, FILE_BASE);
  player = createPlayer({
    api,
    onChange: renderPlayer,
    onTrackEnd: onTrackEnded,
    onError: onTrackFailed,
    onSkip: (dir) => (dir === 'next' ? userMove(computeNext(true)) : userMove(computePrev())),
  });
  lyrics = createPlayerLyrics({
    api,
    player,
    canEdit: () => model.isAdmin && model.library.some((t) => t.id === playback.currentTrackId),
    onError: reportError,
  });
  initVolume(player);
  usersAdmin = createUsersAdmin({ api });
  shell = createShell();
  conti = createConti({
    onPlay: onPlayRow,
    onReorder,
    onRemove: onRemoveFromQueue,
    onOpenLists,
    onListMenu,
    onSettings: () => $('settings-dialog').showModal(),
  });
  library = createLibrary({ onPlay: onPlayRow, onOpenList, onNewList, onTrackMenu });
  initTitleScroll($('pager'));
  scrollTitle($('mini-title'));
  scrollTitle($('player-title'));
  meditate = createMeditate({ api, onError: reportError, onMediaChange });
  practice = createPractice({ player });
  buildVideoForm();

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
  // 기억해 둔 내 목록이면, 봇이 새 곡을 붙이는 활성 목록도 그 목록으로 맞춘다.
  if (model.viewedId !== state.active_id && isOwnId(model.viewedId)) activeSender.request(model.viewedId);
  const repeat = readLocal(KEY_REPEAT);
  playback.repeat = REPEAT_ORDER.includes(repeat) ? repeat : 'all';

  $('app').hidden = false;
  shell.setMood(viewedIds()[0] ?? 0);
  renderAll();
  wireSettings();
  wireControls();
  return undefined;
}

init().catch((err) => {
  console.error(err);
  showFatal(COPY.loadFailed);
});
