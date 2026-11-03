// 가사집 화면. 곡마다 카드 하나: 제목, 가사 사진(여러 장), 참고 영상, 느낀점. 글자는 COPY와 textContent로만 넣는다.
// 카드는 feedKey가 바뀔 때만 다시 만든다. 곡이 넘어가 renderAll이 불려도 쓰던 글과 커서는 남는다.
import { CACHE_NAME } from './audio.js';
import { COPY } from './copy.js';
import { createDesk } from './desk.js';
import { clampPage, draftsToRestore, embedUrl, feedKey, fitSize, pageFromScroll, pagesToLoad, sheetCacheKey, watchUrl } from './lyrics-logic.js';
import { $ } from './render.js';
import { createSaves, localKeys, readLocal, removeLocal, writeLocal } from './store.js';

const NOTE_KEY = 'loopbot.note.';
const SHEET_MAX_EDGE = 2400;
const SHEET_QUALITY = 0.9;
const COPIED_MS = 1500;
const ZOOM_WIDTHS = ['100%', '220%'];
const VIDEO_ALLOW = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
const SVG_NS = 'http://www.w3.org/2000/svg';

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

// href는 index.html 스프라이트의 '#i-이름'이다.
function icon(href) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'i');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', href);
  svg.append(use);
  return svg;
}

// 칸 안의 패널. 앞의 손잡이를 끌어 다른 자리로 옮긴다. 이름이 이미 있는 패널은 손잡이에 아이콘만 둔다.
function makePane(name, label, showName = true) {
  const pane = el('div', 'desk-pane');
  pane.dataset.pane = name;
  const grip = el('button', 'pane-grip');
  grip.type = 'button';
  grip.setAttribute('aria-label', COPY.deskMove(label));
  grip.append(icon('#i-grip'));
  if (showName) grip.append(el('span', '', label));
  pane.append(grip);
  return pane;
}

function errorText(err, fallback) {
  return err.code === 'expired' ? COPY.reopen : fallback;
}

// 사진 쪽 하나가 차지하는 너비. 쪽이 하나뿐이면 0이다.
function pageStep(nodes) {
  return nodes.length < 2 ? 0 : nodes[1].offsetLeft - nodes[0].offsetLeft;
}

function makePage(index, count) {
  const button = el('button', 'sheet');
  button.type = 'button';
  const img = el('img');
  img.alt = `${COPY.sheetAlt} ${index + 1}/${count}`;
  img.hidden = true;
  button.append(img);
  return { button, img, url: null, loaded: false, loading: false };
}

// 사진 올리기가 실패했을 때 글. too_many와 too_big은 따로 적는다.
function uploadErrorText(err) {
  if (err.code === 'too_many') return COPY.sheetTooMany;
  if (err.code === 'too_big') return COPY.sheetTooBig;
  return errorText(err, COPY.sheetUploadFailed);
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

// 쪽 사진은 Cache Storage에서 먼저 찾고, 없으면 받아서 넣는다. 키에 version과 쪽 번호가 있어 바뀐 사진은 다시 받는다.
async function readSheet(api, id, version, page) {
  const cache = await openSheetCache();
  const key = sheetCacheKey(id, version, page);
  const hit = cache ? await cache.match(key).catch(() => undefined) : undefined;
  if (hit) return hit.blob();
  const blob = await api.sheet(id, page);
  if (cache) await cache.put(key, new Response(blob)).catch(() => {});
  return blob;
}

export function createLyrics({ api, getState, onPlay, onError, onMediaChange, onVideoToggle }) {
  const root = $('lyrics');
  const empty = $('lyrics-empty');
  const viewer = $('sheet-viewer');
  const viewerStrip = $('sheet-viewer-strip');
  const viewerCount = $('sheet-viewer-count');
  const videoPanel = $('video-panel');
  const videoFrame = $('video-frame');
  const tg = window.Telegram?.WebApp;
  const desk = createDesk({ root, onChange: placeVideo, onApplied: restorePages });

  // 이 화면에서 쓴 느낀점 중 아직 서버에 같은 값이 없는 것. localStorage에도 같이 둔다.
  const drafts = new Map();
  // 서버에서 받은 느낀점. 처음 한 번만 받고, 이후는 저장이 맞춘다.
  let serverNotes = {};
  let restored = false;
  let feed = null;
  let cards = new Map();
  // 열린 영상이 붙은 곡과 영상 ID. 영상은 넓은 화면에서 그 곡의 카드 안으로 간다.
  let openedTrackId = null;
  let openedVideoId = null;
  // 곡마다 마지막으로 본 쪽. 카드를 다시 만들어도 같은 쪽을 보여 준다.
  const pageMemo = new Map();
  // 사진 올리기 중 실패한 글. 다시 그려진 카드에 붙여 보여 준다.
  const pendingErrors = new Map();
  // 열린 뷰어가 보여 주는 카드와 쪽 사진들.
  let viewing = null;
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

  // 파일 한 장을 줄여 올린다. 그림은 올린 뒤든 실패한 뒤든 놓아준다.
  async function uploadPhoto(card, file) {
    let image = null;
    try {
      image = await readImage(file);
      const { width, height } = fitSize(image.width, image.height, SHEET_MAX_EDGE);
      const blob = await drawJpeg(image.source, width, height);
      return await api.uploadSheet(card.id, blob);
    } finally {
      image?.release();
    }
  }

  function buildTools(card, media) {
    const tools = el('div', 'lyric-tools');
    const file = el('input');
    file.type = 'file';
    file.accept = 'image/*';
    file.multiple = true;
    file.hidden = true;
    file.addEventListener('change', () => {
      const picked = [...(file.files ?? [])];
      file.value = '';
      if (picked.length) pickPhotos(card, picked);
    });
    const photo = textButton(COPY.photoAdd, () => file.click());
    const remove = textButton(COPY.photoRemove, () => removePhoto(card));
    remove.hidden = card.count === 0;
    const url = el('input', 'video-input');
    url.type = 'url';
    url.inputMode = 'url';
    url.setAttribute('aria-label', COPY.videoLink);
    url.value = media.video_id ? watchUrl(media.video_id) : '';
    const saveLink = textButton(COPY.save, () => saveVideoLink(card, url.value));
    tools.append(file, photo, remove, url, saveLink);
    card.photo = photo;
    card.controls = [photo, remove, saveLink];
    return tools;
  }

  function buildCard(id, state) {
    const media = state.media[id] ?? {};
    const count = media.sheet_count ?? 0;
    const page = clampPage(pageMemo.get(id) ?? 0, count);
    const section = el('section', 'card lyric-card');
    const title = textButton(state.titles.get(id) ?? '', () => onPlay(id), 'lyric-title');
    const pages = Array.from({ length: count }, (_, i) => makePage(i, count));
    const strip = el('div', 'sheet-strip');
    strip.setAttribute('role', 'group');
    strip.setAttribute('aria-roledescription', 'carousel');
    strip.setAttribute('aria-label', COPY.sheetAlt);
    strip.classList.toggle('multi', count > 1);
    strip.hidden = count === 0;
    strip.append(...pages.map((p) => p.button));
    const counter = el('span', 'sheet-count', COPY.sheetPage(page + 1, count));
    counter.setAttribute('aria-hidden', 'true');
    counter.hidden = count < 2;
    const wrap = el('div', 'sheet-wrap');
    wrap.append(strip, counter);
    const retry = textButton(COPY.sheetRetry, () => loadPages(card));
    retry.hidden = true;
    const video = textButton(COPY.videoWatch, () => openVideo(id, media.video_id, state.titles.get(id) ?? ''), 'video-button');
    video.prepend(icon('#i-play'));
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
    const pending = pendingErrors.get(id) ?? '';
    pendingErrors.delete(id);
    const error = el('p', 'card-error', pending);
    error.setAttribute('role', 'alert');

    const sheetPane = makePane('sheet', COPY.paneSheet);
    sheetPane.hidden = count === 0;
    sheetPane.append(wrap, retry);
    const videoPane = makePane('video', COPY.paneVideo);
    videoPane.hidden = true;
    const notePane = makePane('note', COPY.paneNote, false);
    const panes = { sheet: sheetPane, video: videoPane, note: notePane };
    const columns = { a: el('div', 'desk-col'), b: el('div', 'desk-col') };
    const divider = el('div', 'desk-divider');
    divider.setAttribute('role', 'separator');
    divider.setAttribute('aria-orientation', 'vertical');
    divider.setAttribute('aria-label', COPY.deskResize);
    divider.tabIndex = 0;
    const deskEl = el('div', 'desk');
    deskEl.append(columns.a, divider, columns.b);

    const card = {
      id, section, title, strip, wrap, counter, pages, count, page, retry, textarea, status, copy, error,
      controls: [], photo: null, version: media.sheet_version,
      desk: deskEl, columns, panes, divider,
    };
    const side = el('div', 'lyric-side');
    side.append(video, label, foot, error);
    if (state.canEdit) side.append(buildTools(card, media));
    notePane.append(side);
    section.append(title, deskEl);
    textarea.addEventListener('input', () => onNoteInput(card, textarea.value));
    pages.forEach((p, i) => p.button.addEventListener('click', () => {
      if (p.loaded) openViewer(card, i);
    }));
    strip.addEventListener('scroll', () => onPageScroll(card), { passive: true });
    cardOfSheet.set(wrap, card);
    desk.applyCard(card);
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
      for (const page of card.pages) {
        if (page.url) URL.revokeObjectURL(page.url);
      }
    }
    cards = new Map(state.trackIds.map((id) => [id, buildCard(id, state)]));
    root.replaceChildren(empty, ...[...cards.values()].map((card) => card.section));
    restorePages();
    feed = key;
    refresh(state);
    restoreFocus(focus);
    // 열린 영상의 곡이 목록에서 사라졌거나 영상 링크가 바뀌었으면 닫는다.
    if (openedTrackId !== null && (!state.trackIds.includes(openedTrackId) || state.media[openedTrackId]?.video_id !== openedVideoId)) closeVideo();
    else placeVideo();
    desk.applyAll(cards.values());
    for (const card of cards.values()) {
      if (card.count === 0) continue;
      if (observer) observer.observe(card.wrap);
      else loadPages(card);
    }
  }

  function onVisible(entries) {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      const card = cardOfSheet.get(entry.target);
      if (card) loadPages(card);
    }
  }

  function restorePages() {
    for (const card of cards.values()) card.strip.scrollLeft = card.page * pageStep(card.pages.map((p) => p.button));
  }

  // 가로로 밀어 쪽이 바뀌면 번호를 고치고, 새 쪽과 그다음 쪽을 받는다.
  function onPageScroll(card) {
    const page = pageFromScroll(card.strip.scrollLeft, pageStep(card.pages.map((p) => p.button)), card.count);
    if (page === card.page) return;
    card.page = page;
    pageMemo.set(card.id, page);
    card.counter.textContent = COPY.sheetPage(page + 1, card.count);
    loadPages(card);
  }

  // 보고 있는 쪽과 그다음 쪽을 받는다. 다시 받기 버튼도 여기로 온다.
  function loadPages(card) {
    for (const i of pagesToLoad(card.page, card.count)) loadPage(card, i);
  }

  async function loadPage(card, i) {
    const page = card.pages[i];
    if (page.loaded || page.loading) return;
    page.loading = true;
    page.button.classList.add('is-loading');
    card.retry.hidden = true;
    setError(card, '');
    try {
      const blob = await readSheet(api, card.id, card.version, i);
      // 받는 동안 카드가 다시 만들어졌으면 이 사진은 버린다.
      if (cards.get(card.id) !== card) return;
      page.url = URL.createObjectURL(blob);
      page.img.src = page.url;
      // 크기를 알기 전에 보여 주면 카드가 잠깐 납작해져 아래 카드까지 한꺼번에 받는다.
      await page.img.decode().catch(() => {});
      page.img.hidden = false;
      page.loaded = true;
      showViewerPage(card, i);
    } catch (err) {
      if (cards.get(card.id) === card) {
        card.retry.hidden = false;
        setError(card, errorText(err, COPY.sheetLoadFailed));
      }
    } finally {
      page.loading = false;
      page.button.classList.remove('is-loading');
    }
  }

  // 뷰어가 이 카드를 보고 있으면 방금 받은 쪽을 넣는다.
  function showViewerPage(card, i) {
    if (viewing?.card === card) viewing.imgs[i].src = card.pages[i].url;
  }

  function toggleZoom(img) {
    img.style.width = ZOOM_WIDTHS[(ZOOM_WIDTHS.indexOf(img.style.width) + 1) % ZOOM_WIDTHS.length];
  }

  // 뷰어에는 쪽마다 img 하나를 만든다. 받은 쪽은 바로 넣고, 아직 없는 쪽은 받는 대로 넣는다.
  function openViewer(card, index) {
    const imgs = card.pages.map((_, i) => {
      const img = el('img');
      img.alt = `${COPY.sheetAlt} ${i + 1}/${card.count}`;
      img.style.width = ZOOM_WIDTHS[0];
      img.addEventListener('click', () => toggleZoom(img));
      const box = el('div', 'viewer-page');
      box.append(img);
      viewerStrip.append(box);
      return img;
    });
    viewing = { card, imgs };
    viewerCount.hidden = card.count < 2;
    viewerCount.textContent = COPY.sheetPage(index + 1, card.count);
    viewer.showModal();
    viewerStrip.scrollLeft = index * pageStep([...viewerStrip.children]);
    card.pages.forEach((page, i) => {
      if (page.loaded) imgs[i].src = page.url;
      else loadPage(card, i);
    });
  }

  function onViewerScroll() {
    if (!viewing) return;
    const page = pageFromScroll(viewerStrip.scrollLeft, pageStep([...viewerStrip.children]), viewing.card.count);
    viewerCount.textContent = COPY.sheetPage(page + 1, viewing.card.count);
  }

  // 고른 사진을 차례로 올린다. 실패하면 거기서 멈추고, 그때까지 올라간 쪽은 남는다.
  async function pickPhotos(card, files) {
    setBusy(card, true);
    setError(card, '');
    const firstNew = card.count;
    let last = null;
    let failure = null;
    try {
      for (const [i, file] of files.entries()) {
        card.photo.textContent = COPY.photoUploading(i + 1, files.length);
        try {
          last = await uploadPhoto(card, file);
        } catch (err) {
          failure = err;
          break;
        }
      }
      if (failure && !last) setError(card, uploadErrorText(failure));
      if (last) {
        // 카드가 곧바로 다시 그려지므로 글을 먼저 맡겨 둔다.
        if (failure) pendingErrors.set(card.id, uploadErrorText(failure));
        pageMemo.set(card.id, firstNew);
        onMediaChange(card.id, { ...getState().media[card.id], sheet_version: last.version, sheet_count: last.count });
      }
    } finally {
      card.photo.textContent = COPY.photoAdd;
      setBusy(card, false);
    }
  }

  // 보고 있는 쪽을 지운다. 뒤의 쪽은 한 칸씩 앞으로 온다.
  async function removePhoto(card) {
    setBusy(card, true);
    setError(card, '');
    try {
      const { version, count } = await api.deleteSheet(card.id, card.page);
      pageMemo.set(card.id, clampPage(card.page, count));
      onMediaChange(card.id, { ...getState().media[card.id], sheet_version: count ? version : null, sheet_count: count });
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
  function openVideo(id, videoId, label) {
    if (!videoId) return;
    openedTrackId = id;
    openedVideoId = videoId;
    const frame = el('iframe');
    frame.src = embedUrl(videoId);
    frame.allow = VIDEO_ALLOW;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.allowFullscreen = true;
    frame.title = `${label} ${COPY.videoOpen}`;
    videoFrame.replaceChildren(frame);
    videoPanel.hidden = false;
    placeVideo();
    if (desk.isWide()) cards.get(id)?.section.scrollIntoView({ block: 'start' });
    onVideoToggle(true);
  }

  function closeVideo() {
    if (!openedVideoId) return;
    videoFrame.replaceChildren();
    videoPanel.hidden = true;
    openedVideoId = null;
    openedTrackId = null;
    placeVideo();
    onVideoToggle(false);
  }

  // 넓은 화면에서 열린 영상은 그 곡 카드의 영상 칸으로 옮기고, 그 밖에서는 본문 맨 위로 되돌린다.
  function placeVideo() {
    const card = openedTrackId === null ? null : cards.get(openedTrackId);
    const slot = card && desk.isWide() ? card.panes.video : null;
    for (const c of cards.values()) c.panes.video.hidden = c.panes.video !== slot;
    if (slot) {
      if (videoPanel.parentNode !== slot) slot.append(videoPanel);
    } else if (videoPanel.parentNode !== document.body) {
      document.body.prepend(videoPanel);
    }
    desk.applyAll(cards.values());
  }

  function openYoutube() {
    if (!openedVideoId) return;
    const url = watchUrl(openedVideoId);
    if (tg?.openLink) tg.openLink(url);
    else window.open(url, '_blank', 'noopener');
  }

  viewerStrip.addEventListener('scroll', onViewerScroll, { passive: true });
  viewer.addEventListener('close', () => {
    viewing = null;
    viewerStrip.replaceChildren();
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
    const wasHidden = root.hidden;
    root.hidden = !state.visible;
    if (!state.visible) {
      // 가사집을 떠나면 열린 영상도 닫는다.
      closeVideo();
      return;
    }
    const key = feedKey(state.playlistId, state.trackIds, state.media, state.canEdit);
    if (key === feed) refresh(state);
    else rebuild(state, key);
    // 가사집이 숨겨지면 가로 위치가 사라지는 브라우저가 있어 돌아올 때 맞춘다.
    if (wasHidden) restorePages();
  }

  // 저장 중인 느낀점을 모두 기다린다. 실패하면 값은 남는다.
  const flush = () => saves.flushAll();

  empty.textContent = COPY.emptyLyrics;
  $('desk-reset').textContent = COPY.deskReset;
  return { sync, flush, closeVideo };
}
