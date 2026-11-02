// 가사집 화면. 곡마다 카드 하나: 제목, 가사 사진, 참고 영상, 느낀점. 글자는 COPY와 textContent로만 넣는다.
// 카드는 feedKey가 바뀔 때만 다시 만든다. 곡이 넘어가 renderAll이 불려도 쓰던 글과 커서는 남는다.
import { CACHE_NAME } from './audio.js';
import { COPY } from './copy.js';
import { draftsToRestore, embedUrl, feedKey, fitSize, sheetCacheKey, watchUrl } from './lyrics-logic.js';
import { $ } from './render.js';
import { createSaves, localKeys, readLocal, removeLocal, writeLocal } from './store.js';

const NOTE_KEY = 'loopbot.note.';
const SHEET_MAX_EDGE = 2400;
const SHEET_QUALITY = 0.9;
const COPIED_MS = 1500;
const ZOOM_WIDTHS = ['100%', '220%'];
const VIDEO_ALLOW = 'autoplay; encrypted-media; picture-in-picture; fullscreen';

async function openSheetCache() {
  try {
    return 'caches' in window ? await caches.open(CACHE_NAME) : null;
  } catch {
    // 캐시를 쓸 수 없으면 매번 받는다.
    return null;
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function textButton(text, onClick, className = 'text-button') {
  const button = el('button', className, text);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

function errorText(err, fallback) {
  return err.code === 'expired' ? COPY.reopen : fallback;
}

// 사진 파일을 그림으로 읽는다. 방향은 사진 메타데이터를 따르고, 안 되면 <img>로 읽는다.
async function readImage(file) {
  if ('createImageBitmap' in window) {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
}

function drawJpeg(source, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(source, 0, 0, width, height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encode'))), 'image/jpeg', SHEET_QUALITY),
  );
}

// 복사: 클립보드 API가 막히면 입력칸을 선택해 execCommand로 다시 한다.
async function copyText(text, textarea) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 아래 방법으로 다시 한다.
  }
  try {
    textarea.select();
    return document.execCommand('copy');
  } catch {
    return false;
  }
}

// 사진은 Cache Storage에서 먼저 찾고, 없으면 받아서 넣는다. 키에 version이 있어 바뀐 사진은 다시 받는다.
async function readSheet(api, id, version) {
  const cache = await openSheetCache();
  const key = sheetCacheKey(id, version);
  const hit = cache ? await cache.match(key).catch(() => undefined) : undefined;
  if (hit) return hit.blob();
  const blob = await api.sheet(id);
  if (cache) await cache.put(key, new Response(blob)).catch(() => {});
  return blob;
}

export function createLyrics({ api, getState, onPlay, onError, onMediaChange, onVideoToggle }) {
  const root = $('lyrics');
  const empty = $('lyrics-empty');
  const viewer = $('sheet-viewer');
  const viewerImg = $('sheet-viewer-img');
  const videoPanel = $('video-panel');
  const videoFrame = $('video-frame');
  const tg = window.Telegram?.WebApp;

  // 이 화면에서 쓴 느낀점 중 아직 서버에 같은 값이 없는 것. localStorage에도 같이 둔다.
  const drafts = new Map();
  // 서버에서 받은 느낀점. 처음 한 번만 받고, 이후는 저장이 맞춘다.
  let serverNotes = {};
  let restored = false;
  let feed = null;
  let cards = new Map();
  let openedVideoId = null;
  let zoomIndex = 0;
  const cardOfSheet = new WeakMap();
  const observer = 'IntersectionObserver' in window ? new IntersectionObserver(onVisible, { rootMargin: '400px' }) : null;

  const saves = createSaves({
    save: saveNote,
    onError: (id, err) => {
      // 그 곡을 읽을 수 없게 됐다. 재시도해도 소용없으니 버린다.
      if (err.code === 'not_found') return dropNote(id);
      return onError(err);
    },
    onSaved: () => {},
  });

  async function saveNote({ id, body }) {
    await api.saveNote(id, body);
    serverNotes = { ...serverNotes, [id]: body };
    const latest = drafts.get(id) === body;
    if (latest) {
      drafts.delete(id);
      removeLocal(NOTE_KEY + id);
    }
    setNoteStatus(id, latest ? COPY.saved : COPY.saving);
  }

  function dropNote(id) {
    saves.drop(id);
    drafts.delete(id);
    removeLocal(NOTE_KEY + id);
    setNoteStatus(id, '');
  }

  function setNoteStatus(id, text) {
    const card = cards.get(id);
    if (card) card.status.textContent = text;
  }

  // 남은 임시 글을 서버 값보다 우선해 되살리고 다시 저장한다. 서버와 같은 것은 지운다.
  function restoreDrafts(notes) {
    const stored = Object.fromEntries(localKeys(NOTE_KEY).map((key) => [key.slice(NOTE_KEY.length), readLocal(key) ?? '']));
    const toRestore = draftsToRestore(stored, notes);
    for (const id of Object.keys(stored)) {
      if (id in toRestore) {
        drafts.set(Number(id), toRestore[id]);
        saves.update({ id: Number(id), body: toRestore[id] });
      } else {
        removeLocal(NOTE_KEY + id);
      }
    }
  }

  function noteValue(id) {
    return drafts.has(id) ? drafts.get(id) : (serverNotes[id] ?? '');
  }

  function onNoteInput(card, body) {
    drafts.set(card.id, body);
    writeLocal(NOTE_KEY + card.id, body);
    card.status.textContent = COPY.saving;
    card.copy.disabled = !body;
    saves.update({ id: card.id, body });
  }

  function setBusy(card, busy) {
    for (const control of card.controls) control.disabled = busy;
  }

  function setError(card, text) {
    card.error.textContent = text;
  }

  function buildTools(card, media) {
    const tools = el('div', 'lyric-tools');
    const file = el('input');
    file.type = 'file';
    file.accept = 'image/*';
    file.hidden = true;
    file.addEventListener('change', () => {
      const picked = file.files?.[0];
      file.value = '';
      if (picked) pickPhoto(card, picked);
    });
    const photo = textButton(card.hasSheet ? COPY.photoReplace : COPY.photoAdd, () => file.click());
    const remove = textButton(COPY.photoRemove, () => removePhoto(card));
    remove.hidden = !card.hasSheet;
    const url = el('input', 'video-input');
    url.type = 'url';
    url.inputMode = 'url';
    url.setAttribute('aria-label', COPY.videoLink);
    url.value = media.video_id ? watchUrl(media.video_id) : '';
    const saveLink = textButton(COPY.save, () => saveVideoLink(card, url.value));
    tools.append(file, photo, remove, url, saveLink);
    card.controls = [photo, remove, saveLink];
    return tools;
  }

  function buildCard(id, state) {
    const media = state.media[id] ?? {};
    const hasSheet = media.sheet_version != null;
    const section = el('section', 'card lyric-card');
    const title = textButton(state.titles.get(id) ?? '', () => onPlay(id), 'lyric-title');
    const sheet = el('button', 'sheet');
    sheet.type = 'button';
    sheet.hidden = !hasSheet;
    const img = el('img');
    img.alt = COPY.sheetAlt;
    img.hidden = true;
    sheet.append(img);
    const retry = textButton(COPY.sheetRetry, () => loadSheet(card));
    retry.hidden = true;
    const video = textButton(COPY.videoOpen, () => openVideo(media.video_id, state.titles.get(id) ?? ''));
    video.hidden = !media.video_id;
    const textarea = el('textarea', 'well note-input');
    textarea.rows = 4;
    textarea.value = noteValue(id);
    const status = el('span', 'note-status');
    status.setAttribute('aria-live', 'polite');
    const copy = textButton(COPY.copy, () => copyNote(card));
    copy.disabled = !textarea.value;
    const label = el('label', 'note-label', COPY.note);
    label.append(textarea);
    const foot = el('div', 'note-foot');
    foot.append(status, copy);
    const error = el('p', 'card-error');
    error.setAttribute('role', 'alert');

    const card = {
      id, section, title, sheet, img, retry, hasSheet, textarea, status, copy, error,
      controls: [], url: null, loaded: false, loading: false, version: media.sheet_version,
    };
    section.append(title, sheet, retry, video, label, foot, error);
    if (state.canEdit) section.append(buildTools(card, media));
    textarea.addEventListener('input', () => onNoteInput(card, textarea.value));
    sheet.addEventListener('click', () => {
      if (card.loaded) openViewer(card);
    });
    cardOfSheet.set(sheet, card);
    return card;
  }

  function refresh(state) {
    empty.hidden = state.trackIds.length > 0;
    for (const card of cards.values()) {
      const text = state.titles.get(card.id) ?? '';
      card.title.textContent = text;
      card.section.classList.toggle('current', card.id === state.currentId);
    }
  }

  // 다시 그리면 입력칸 포커스가 사라지므로 곡, 커서, 스크롤을 적어 둔다.
  function keepFocus() {
    const card = [...cards.values()].find((c) => c.textarea === document.activeElement);
    if (!card) return null;
    const { selectionStart: start, selectionEnd: end } = card.textarea;
    return { id: card.id, start, end, scrollY: window.scrollY };
  }

  // 같은 곡이 아직 있을 때만 포커스와 커서, 스크롤을 되돌린다.
  function restoreFocus(saved) {
    const card = saved && cards.get(saved.id);
    if (!card) return;
    card.textarea.focus({ preventScroll: true });
    card.textarea.setSelectionRange(saved.start, saved.end);
    window.scrollTo(0, saved.scrollY);
  }

  function rebuild(state, key) {
    if (viewer.open) viewer.close();
    const focus = keepFocus();
    observer?.disconnect();
    for (const card of cards.values()) {
      if (card.url) URL.revokeObjectURL(card.url);
    }
    cards = new Map(state.trackIds.map((id) => [id, buildCard(id, state)]));
    root.replaceChildren(empty, ...[...cards.values()].map((card) => card.section));
    feed = key;
    refresh(state);
    restoreFocus(focus);
    // 열린 영상이 새 목록에 더는 없으면 닫는다.
    if (openedVideoId && !state.trackIds.some((id) => state.media[id]?.video_id === openedVideoId)) closeVideo();
    for (const card of cards.values()) {
      if (!card.hasSheet) continue;
      if (observer) observer.observe(card.sheet);
      else loadSheet(card);
    }
  }

  function onVisible(entries) {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      const card = cardOfSheet.get(entry.target);
      if (card) loadSheet(card);
    }
  }

  async function loadSheet(card) {
    if (card.loaded || card.loading) return;
    card.loading = true;
    card.sheet.classList.add('is-loading');
    card.retry.hidden = true;
    setError(card, '');
    try {
      const blob = await readSheet(api, card.id, card.version);
      // 받는 동안 카드가 다시 만들어졌으면 이 사진은 버린다.
      if (cards.get(card.id) !== card) return;
      card.url = URL.createObjectURL(blob);
      card.img.src = card.url;
      card.img.hidden = false;
      card.loaded = true;
    } catch (err) {
      if (cards.get(card.id) === card) {
        card.retry.hidden = false;
        setError(card, errorText(err, COPY.sheetLoadFailed));
      }
    } finally {
      card.loading = false;
      card.sheet.classList.remove('is-loading');
    }
  }

  function openViewer(card) {
    viewerImg.src = card.url;
    zoomIndex = 0;
    viewerImg.style.width = ZOOM_WIDTHS[zoomIndex];
    viewer.showModal();
  }

  async function pickPhoto(card, file) {
    setBusy(card, true);
    setError(card, '');
    let image = null;
    try {
      image = await readImage(file);
      const { width, height } = fitSize(image.width, image.height, SHEET_MAX_EDGE);
      const blob = await drawJpeg(image.source, width, height);
      const { version } = await api.uploadSheet(card.id, blob);
      onMediaChange(card.id, { ...getState().media[card.id], sheet_version: version });
    } catch (err) {
      if (err.code === 'too_big') setError(card, COPY.sheetTooBig);
      else setError(card, errorText(err, COPY.sheetUploadFailed));
    } finally {
      image?.release();
      setBusy(card, false);
    }
  }

  async function removePhoto(card) {
    setBusy(card, true);
    setError(card, '');
    try {
      await api.deleteSheet(card.id);
      onMediaChange(card.id, { ...getState().media[card.id], sheet_version: null });
    } catch (err) {
      setError(card, errorText(err, COPY.sheetDeleteFailed));
    } finally {
      setBusy(card, false);
    }
  }

  async function saveVideoLink(card, raw) {
    setBusy(card, true);
    setError(card, '');
    try {
      const { video_id: videoId } = await api.saveVideo(card.id, raw.trim());
      onMediaChange(card.id, { ...getState().media[card.id], video_id: videoId ?? null });
    } catch (err) {
      if (err.code === 'bad_request') setError(card, COPY.videoInvalid);
      else setError(card, errorText(err, COPY.videoFailed));
    } finally {
      setBusy(card, false);
    }
  }

  async function copyNote(card) {
    const text = card.textarea.value;
    if (!text) return;
    setError(card, '');
    if (!(await copyText(text, card.textarea))) return setError(card, COPY.copyFailed);
    card.copy.textContent = COPY.copied;
    setTimeout(() => {
      card.copy.textContent = COPY.copy;
    }, COPIED_MS);
    return undefined;
  }

  // 열면 iframe을 만들고, 닫으면 지운다. 재생을 멈추고 바를 숨기는 일은 onVideoToggle을 받은 쪽이 한다.
  function openVideo(videoId, label) {
    if (!videoId) return;
    openedVideoId = videoId;
    const frame = el('iframe');
    frame.src = embedUrl(videoId);
    frame.allow = VIDEO_ALLOW;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.allowFullscreen = true;
    frame.title = `${label} ${COPY.videoOpen}`;
    videoFrame.replaceChildren(frame);
    videoPanel.hidden = false;
    onVideoToggle(true);
  }

  function closeVideo() {
    if (!openedVideoId) return;
    videoFrame.replaceChildren();
    videoPanel.hidden = true;
    openedVideoId = null;
    onVideoToggle(false);
  }

  function openYoutube() {
    if (!openedVideoId) return;
    const url = watchUrl(openedVideoId);
    if (tg?.openLink) tg.openLink(url);
    else window.open(url, '_blank', 'noopener');
  }

  viewerImg.addEventListener('click', () => {
    zoomIndex = (zoomIndex + 1) % ZOOM_WIDTHS.length;
    viewerImg.style.width = ZOOM_WIDTHS[zoomIndex];
  });
  $('sheet-viewer-close').addEventListener('click', () => viewer.close());
  $('video-youtube').addEventListener('click', openYoutube);
  $('video-close').addEventListener('click', closeVideo);

  // state: {visible, playlistId, trackIds, titles(Map), media, notes, canEdit, currentId}
  // 처음 부를 때 임시 글을 되살린다. 그 뒤로 느낀점은 이 화면이 맡는다.
  function sync(state) {
    if (!restored) {
      restored = true;
      serverNotes = state.notes;
      restoreDrafts(state.notes);
    }
    root.hidden = !state.visible;
    if (!state.visible) {
      // 가사집을 떠나면 열린 영상도 닫는다.
      closeVideo();
      return;
    }
    const key = feedKey(state.playlistId, state.trackIds, state.media, state.canEdit);
    if (key === feed) refresh(state);
    else rebuild(state, key);
  }

  // 저장 중인 느낀점을 모두 기다린다. 실패하면 값은 남는다.
  const flush = () => saves.flushAll();

  empty.textContent = COPY.emptyLyrics;
  return { sync, flush, closeVideo };
}
