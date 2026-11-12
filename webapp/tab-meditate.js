// 묵상 탭. 곡마다 한 장(article.slide)을 옆으로 늘어놓고, 장마다 제목·악보 사진·느낀점 하나를 둔다.
// 느낀점 저장·초안 복구·악보 캐시·올리기·지우기·크게 보기는 옛 lyrics.js 동작을 그대로 옮겼다. 글자는 textContent로만 넣는다.
import { CACHE_NAME } from './audio.js';
import { COPY } from './copy.js';
import { $ } from './dom.js';
import { clampPage, draftsToRestore, fitSize, pageFromScroll, pagesToLoad, sheetCacheKey } from './lyrics-logic.js';
import { createNoteActions } from './note-actions.js';
import { createSaves, localKeys, readLocal, removeLocal, writeLocal } from './store.js';
import { meditateTrack } from './ui-logic.js';

const NOTE_KEY = 'loopbot.note.';
const SHEET_MAX_EDGE = 2400;
const SHEET_QUALITY = 0.9;
const COPIED_MS = 1500;
const DRAG_MIN_PX = 6;
const DRAG_FLIP_PX = 40;
const SNAP_RESTORE_MS = 400;
const TEXT = {
  title: '묵상',
  lines: '가사',
  sheet: '악보',
  memoLabel: '이 곡에서 든 생각',
  memoHint: '이 곡을 들으며 든 생각을 적어요',
  noSheet: '악보 사진이 아직 없어요',
  songs: '곡, 옆으로 넘기기',
  slide: (n, title) => `${n}번째 곡 ${title}`,
  position: (n, total) => `${n} / ${total}`,
};
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// view.media·notes는 Map이든 객체든 받는다. 안에서는 객체로 쓴다.
const toObject = (value) => (value instanceof Map ? Object.fromEntries(value) : (value ?? {}));

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

function button(text, onClick, className = 'btn') {
  const node = el('button', className, text);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

function errorText(err, fallback) {
  return err.code === 'expired' ? COPY.reopen : fallback;
}

function uploadErrorText(err) {
  if (err.code === 'too_many') return COPY.sheetTooMany;
  if (err.code === 'too_big') return COPY.sheetTooBig;
  return errorText(err, COPY.sheetUploadFailed);
}

// 칸 하나가 차지하는 너비. 칸이 하나뿐이면 fallback이다.
function stepOf(nodes, fallback = 0) {
  return nodes.length < 2 ? fallback : nodes[1].offsetLeft - nodes[0].offsetLeft;
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

// 클립보드 API가 막히면 입력칸을 선택해 execCommand로 다시 한다.
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

// 쪽 사진은 Cache Storage에서 먼저 찾고, 없으면 받아서 넣는다. 키에 version이 있어 바뀐 사진은 다시 받는다.
async function readSheet(api, id, version, page) {
  const cache = await openSheetCache();
  const key = sheetCacheKey(id, version, page);
  const hit = cache ? await cache.match(key).catch(() => undefined) : undefined;
  if (hit) return hit.blob();
  const blob = await api.sheet(id, page);
  if (cache) await cache.put(key, new Response(blob)).catch(() => {});
  return blob;
}

// PC 마우스 끌기. 터치는 브라우저 스크롤에 맡긴다. 끈 뒤의 click은 막는다.
function dragSwipe(box) {
  let x0 = 0;
  let left0 = 0;
  let moved = false;
  let down = false;
  box.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('textarea, input')) return;
    down = true;
    moved = false;
    x0 = e.clientX;
    left0 = box.scrollLeft;
  });
  window.addEventListener('pointermove', (e) => {
    if (!down) return;
    const dx = e.clientX - x0;
    if (!moved && Math.abs(dx) < DRAG_MIN_PX) return;
    if (!moved) {
      moved = true;
      box.style.scrollSnapType = 'none';
      box.style.cursor = 'grabbing';
    }
    box.scrollLeft = left0 - dx;
  });
  window.addEventListener('pointerup', (e) => {
    if (!down) return;
    down = false;
    if (!moved) return;
    const step = stepOf([...box.children], box.clientWidth);
    const dx = e.clientX - x0;
    const last = Math.max(0, box.children.length - 1);
    const at = Math.max(0, Math.min(Math.round(left0 / step) + (dx < -DRAG_FLIP_PX ? 1 : dx > DRAG_FLIP_PX ? -1 : 0), last));
    const reduce = reduceMotion();
    box.style.cursor = '';
    box.scrollTo({ left: at * step, behavior: reduce ? 'auto' : 'smooth' });
    setTimeout(() => {
      box.style.scrollSnapType = '';
    }, reduce ? 0 : SNAP_RESTORE_MS);
  });
  box.addEventListener('click', (e) => {
    if (!moved) return;
    e.stopPropagation();
    e.preventDefault();
    moved = false;
  }, true);
  box.addEventListener('dragstart', (e) => e.preventDefault());
}

export function createMeditate({ api, onError, onMediaChange }) {
  const pane = $('tab-meditate');
  const viewer = $('sheet-viewer');
  const viewerStrip = $('sheet-viewer-strip');
  const viewerCount = $('sheet-viewer-count');

  const kicker = el('p', 'kicker');
  kicker.setAttribute('aria-live', 'polite');
  const heading = el('h1', '', TEXT.title);
  const seg = el('div', 'seg glass');
  const modeButtons = [['lines', TEXT.lines], ['sheet', TEXT.sheet]].map(([value, label]) => {
    const node = button(label, () => setMode(value), '');
    node.dataset.v = value;
    return node;
  });
  seg.append(...modeButtons);
  const copyrow = el('div', 'copyrow');
  const copyAll = el('button', 'chip');
  copyAll.type = 'button';
  copyAll.id = 'copy-all';
  const templateOpen = el('button', 'chip');
  templateOpen.type = 'button';
  templateOpen.id = 'template-open';
  copyrow.append(copyAll, templateOpen);
  const box = el('div', 'songs');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', TEXT.songs);
  const dots = el('div', 'dots');
  dots.setAttribute('aria-hidden', 'true');
  const empty = el('p', 'empty', COPY.emptyLyrics);
  pane.replaceChildren(kicker, heading, seg, copyrow, box, dots, empty);

  // 아직 서버에 같은 값이 없는 느낀점. localStorage에도 같이 둔다.
  const drafts = new Map();
  let serverNotes = {};
  let restored = false;
  let view = null;
  let mode = 'lines';
  // 지금 보이는 곡. 다시 그려도 이 곡에 머문다.
  let shownId = null;
  let slides = new Map();
  // 올리기 중 실패한 글. 다시 그려진 장에 붙여 보여 준다.
  const pendingErrors = new Map();
  let viewing = null;
  const slideOfPage = new WeakMap();
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
    const slide = slides.get(id);
    if (slide) slide.status.textContent = text;
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

  function onNoteInput(slide, body) {
    drafts.set(slide.id, body);
    writeLocal(NOTE_KEY + slide.id, body);
    slide.status.textContent = COPY.saving;
    slide.copy.disabled = !body;
    slide.del.disabled = !body;
    saves.update({ id: slide.id, body });
  }

  function deleteNote(slide) {
    if (!slide.textarea.value || !confirm(COPY.noteDeleteConfirm)) return;
    slide.textarea.value = '';
    onNoteInput(slide, '');
  }

  async function copyNote(slide) {
    const text = slide.textarea.value;
    if (!text) return;
    slide.error.textContent = '';
    if (!(await copyText(text, slide.textarea))) {
      slide.error.textContent = COPY.copyFailed;
      return;
    }
    slide.copy.textContent = COPY.copied;
    setTimeout(() => {
      slide.copy.textContent = COPY.copy;
    }, COPIED_MS);
  }

  const mediaOf = (id) => toObject(view?.media)[id] ?? {};
  // 장 모양이 바뀌는 값. 같으면 장을 그대로 두어 쓰던 글과 커서가 남는다.
  const slideKey = (id) => JSON.stringify([mediaOf(id).sheet_version ?? null, mediaOf(id).sheet_count ?? 0, Boolean(view.canEdit)]);

  function makePage(slide, index) {
    const wrap = el('div', 'sheet');
    const open = el('button', '');
    open.type = 'button';
    const img = el('img');
    img.alt = `${COPY.sheetAlt} ${index + 1}/${slide.count}`;
    img.hidden = true;
    open.append(img);
    wrap.append(open);
    const page = { wrap, open, img, url: null, loaded: false, loading: false };
    open.addEventListener('click', () => {
      if (page.loaded) openViewer(slide, index);
    });
    if (view.canEdit) {
      const remove = button(COPY.photoRemove, () => removePhoto(slide, index), 'btn danger');
      slide.controls.push(remove);
      wrap.append(remove);
    }
    slideOfPage.set(wrap, { slide, index });
    return page;
  }

  function buildUpload(slide) {
    const file = el('input');
    file.type = 'file';
    file.accept = 'image/*';
    file.multiple = true;
    file.hidden = true;
    file.addEventListener('change', () => {
      const picked = [...(file.files ?? [])];
      file.value = '';
      if (picked.length) pickPhotos(slide, picked);
    });
    const add = button(COPY.photoAdd, () => file.click(), 'btn sheet-add');
    slide.photo = add;
    slide.controls.push(add);
    return [file, add];
  }

  function buildSlide(id) {
    const media = mediaOf(id);
    const count = media.sheet_count ?? 0;
    const article = el('article', 'slide');
    const title = el('h3');
    const sheetBox = el('div', 'stack');
    const textarea = el('textarea');
    textarea.rows = 3;
    textarea.id = `memo-${id}`;
    textarea.placeholder = TEXT.memoHint;
    textarea.value = noteValue(id);
    const label = el('label', '', TEXT.memoLabel);
    label.htmlFor = textarea.id;
    const status = el('span', '');
    status.setAttribute('aria-live', 'polite');
    const slide = {
      id, article, title, sheetBox, textarea, status, count, version: media.sheet_version,
      key: slideKey(id), pages: [], controls: [], photo: null, copy: null, del: null, retry: null, error: null,
    };
    slide.copy = button(COPY.copy, () => copyNote(slide), 'chip');
    slide.copy.disabled = !textarea.value;
    slide.del = button(COPY.noteDelete, () => deleteNote(slide), 'chip');
    slide.del.disabled = !textarea.value;
    slide.retry = button(COPY.sheetRetry, () => loadAll(slide), 'btn');
    slide.retry.hidden = true;
    slide.error = el('p', '', pendingErrors.get(id) ?? '');
    slide.error.setAttribute('role', 'alert');
    pendingErrors.delete(id);

    slide.pages = Array.from({ length: count }, (_, i) => makePage(slide, i));
    if (count === 0) sheetBox.append(el('p', 'empty', TEXT.noSheet));
    sheetBox.append(...slide.pages.map((p) => p.wrap), slide.retry);
    if (view.canEdit) sheetBox.append(...buildUpload(slide));

    const foot = el('div', 'foot');
    foot.append(status, slide.del, slide.copy);
    const memo = el('div', 'memo glass');
    memo.append(label, textarea, foot);
    article.append(title, sheetBox, memo, slide.error);
    textarea.addEventListener('input', () => onNoteInput(slide, textarea.value));
    for (const page of slide.pages) {
      if (observer) observer.observe(page.wrap);
    }
    return slide;
  }

  function releaseSlide(slide) {
    for (const page of slide.pages) {
      observer?.unobserve(page.wrap);
      if (page.url) URL.revokeObjectURL(page.url);
    }
  }

  // 보이는 쪽과 그다음 쪽을 받는다.
  function onVisible(entries) {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const hit = slideOfPage.get(entry.target);
      if (!hit || slides.get(hit.slide.id) !== hit.slide) continue;
      for (const i of pagesToLoad(hit.index, hit.slide.count)) loadPage(hit.slide, i);
    }
  }

  // 다시 받기 버튼, IntersectionObserver가 없는 브라우저는 모든 쪽을 받는다.
  function loadAll(slide) {
    slide.pages.forEach((_, i) => loadPage(slide, i));
  }

  async function loadPage(slide, i) {
    const page = slide.pages[i];
    if (page.loaded || page.loading) return;
    page.loading = true;
    observer?.unobserve(page.wrap);
    slide.retry.hidden = true;
    slide.error.textContent = '';
    try {
      const blob = await readSheet(api, slide.id, slide.version, i);
      // 받는 동안 장이 다시 만들어졌으면 이 사진은 버린다.
      if (slides.get(slide.id) !== slide) return;
      page.url = URL.createObjectURL(blob);
      page.img.src = page.url;
      // 크기를 알기 전에 보여 주면 장이 잠깐 납작해져 아래 쪽까지 한꺼번에 받는다.
      await page.img.decode().catch(() => {});
      page.img.hidden = false;
      page.loaded = true;
      if (viewing?.slide === slide) viewing.imgs[i].src = page.url;
    } catch (err) {
      if (slides.get(slide.id) === slide) {
        slide.retry.hidden = false;
        slide.error.textContent = errorText(err, COPY.sheetLoadFailed);
      }
    } finally {
      page.loading = false;
    }
  }

  function toggleZoom(img) {
    // 기본은 화면에 다 들어오게, 누르면 두 배 넓게 키워 옆·아래로 움직여 본다.
    img.parentElement.classList.toggle('zoom');
  }

  // 뷰어에는 쪽마다 img 하나를 만든다. 받은 쪽은 바로 넣고, 아직 없는 쪽은 받는 대로 넣는다.
  function openViewer(slide, index) {
    const imgs = slide.pages.map((_, i) => {
      const img = el('img');
      img.alt = `${COPY.sheetAlt} ${i + 1}/${slide.count}`;
      img.addEventListener('click', () => toggleZoom(img));
      const holder = el('div', 'viewer-page');
      holder.append(img);
      viewerStrip.append(holder);
      return img;
    });
    viewing = { slide, imgs };
    viewerCount.hidden = slide.count < 2;
    viewerCount.textContent = COPY.sheetPage(index + 1, slide.count);
    viewer.showModal();
    viewerStrip.scrollLeft = index * stepOf([...viewerStrip.children]);
    slide.pages.forEach((page, i) => {
      if (page.loaded) imgs[i].src = page.url;
      else loadPage(slide, i);
    });
  }

  function onViewerScroll() {
    if (!viewing) return;
    const page = pageFromScroll(viewerStrip.scrollLeft, stepOf([...viewerStrip.children]), viewing.slide.count);
    viewerCount.textContent = COPY.sheetPage(page + 1, viewing.slide.count);
  }

  function setBusy(slide, busy) {
    for (const control of slide.controls) control.disabled = busy;
  }

  async function uploadPhoto(slide, file) {
    let image = null;
    try {
      image = await readImage(file);
      const { width, height } = fitSize(image.width, image.height, SHEET_MAX_EDGE);
      const blob = await drawJpeg(image.source, width, height);
      return await api.uploadSheet(slide.id, blob);
    } finally {
      image?.release();
    }
  }

  // 고른 사진을 차례로 올린다. 실패하면 거기서 멈추고, 그때까지 올라간 쪽은 남는다.
  async function pickPhotos(slide, files) {
    setBusy(slide, true);
    slide.error.textContent = '';
    let last = null;
    let failure = null;
    try {
      for (const [i, file] of files.entries()) {
        slide.photo.textContent = COPY.photoUploading(i + 1, files.length);
        try {
          last = await uploadPhoto(slide, file);
        } catch (err) {
          failure = err;
          break;
        }
      }
      if (failure && !last) slide.error.textContent = uploadErrorText(failure);
      if (last) {
        // 장이 곧바로 다시 그려지므로 글을 먼저 맡겨 둔다.
        if (failure) pendingErrors.set(slide.id, uploadErrorText(failure));
        onMediaChange(slide.id, { ...mediaOf(slide.id), sheet_version: last.version, sheet_count: last.count });
      }
    } finally {
      slide.photo.textContent = COPY.photoAdd;
      setBusy(slide, false);
    }
  }

  // 그 쪽을 지운다. 뒤의 쪽은 한 칸씩 앞으로 온다.
  async function removePhoto(slide, index) {
    setBusy(slide, true);
    slide.error.textContent = '';
    try {
      const { version, count } = await api.deleteSheet(slide.id, clampPage(index, slide.count));
      onMediaChange(slide.id, { ...mediaOf(slide.id), sheet_version: count ? version : null, sheet_count: count });
    } catch (err) {
      slide.error.textContent = errorText(err, COPY.sheetDeleteFailed);
    } finally {
      setBusy(slide, false);
    }
  }

  function setMode(next) {
    mode = next;
    for (const node of modeButtons) node.setAttribute('aria-pressed', String(node.dataset.v === mode));
    for (const slide of slides.values()) slide.sheetBox.hidden = mode !== 'sheet';
  }

  function shownIndex() {
    return pageFromScroll(box.scrollLeft, stepOf([...box.children], box.clientWidth), box.children.length);
  }

  function scrollToId(id) {
    const index = view.trackIds.indexOf(id);
    if (index < 0) return;
    box.scrollLeft = index * stepOf([...box.children], box.clientWidth);
    showPosition(index);
  }

  function showPosition(index) {
    const total = view.trackIds.length;
    kicker.textContent = total ? TEXT.position(index + 1, total) : '';
    [...dots.children].forEach((dot, i) => dot.classList.toggle('on', i === index));
  }

  function onSongsScroll() {
    if (!view || !box.clientWidth) return;
    const index = shownIndex();
    shownId = view.trackIds[index] ?? null;
    showPosition(index);
  }

  // 같은 곡이고 모양 값이 같으면 장을 그대로 쓴다. 바뀐 장만 새로 만든다.
  function syncSlides() {
    const next = new Map();
    for (const id of view.trackIds) {
      const old = slides.get(id);
      if (old && old.key === slideKey(id)) next.set(id, old);
      else {
        if (old) releaseSlide(old);
        next.set(id, buildSlide(id));
      }
    }
    for (const [id, old] of slides) {
      if (!next.has(id)) releaseSlide(old);
    }
    const changed = next.size !== slides.size || [...next.values()].some((s, i) => box.children[i] !== s.article);
    slides = next;
    // 순서가 같으면 DOM을 옮기지 않는다. 옮기면 쓰던 입력칸의 포커스가 풀린다.
    if (changed) box.replaceChildren(...[...slides.values()].map((s) => s.article));
    if (!observer) for (const slide of slides.values()) loadAll(slide);
    return changed;
  }

  // view: { trackIds, titles: Map, media, notes, currentId, canEdit, playlistId }
  function render(nextView) {
    view = nextView;
    if (!restored) {
      restored = true;
      serverNotes = toObject(view.notes);
      restoreDrafts(serverNotes);
    }
    if (viewing && !view.trackIds.includes(viewing.slide.id)) viewer.close();
    const changed = syncSlides();
    view.trackIds.forEach((id, i) => {
      const slide = slides.get(id);
      const text = view.titles.get(id) ?? '';
      slide.title.textContent = text;
      slide.article.setAttribute('aria-label', TEXT.slide(i + 1, text));
      slide.sheetBox.hidden = mode !== 'sheet';
    });
    if (dots.children.length !== view.trackIds.length) dots.replaceChildren(...view.trackIds.map(() => el('i')));
    empty.hidden = view.trackIds.length > 0;
    seg.hidden = copyrow.hidden = !empty.hidden;
    const target = meditateTrack({ chosenId: shownId, currentId: view.currentId, trackIds: view.trackIds });
    shownId = target;
    // 칸이 숨어 있던 사이 위치가 사라졌거나 장이 바뀌었으면 다시 맞춘다.
    if (target !== null && (changed || view.trackIds[shownIndex()] !== target)) scrollToId(target);
    else showPosition(view.trackIds.indexOf(target));
  }

  // 플레이어의 "악보 보기"가 부른다. 악보 쪽으로 바꾸고 그 곡으로 간다.
  function openTrack(id) {
    if (!view?.trackIds.includes(id)) return;
    setMode('sheet');
    shownId = id;
    scrollToId(id);
  }

  // 저장 중인 느낀점을 모두 기다린다. 실패하면 값은 남는다.
  const flush = () => saves.flushAll();

  box.addEventListener('scroll', onSongsScroll, { passive: true });
  dragSwipe(box);
  viewerStrip.addEventListener('scroll', onViewerScroll, { passive: true });
  viewer.addEventListener('close', () => {
    viewing = null;
    viewerStrip.replaceChildren();
  });
  $('sheet-viewer-close').addEventListener('click', () => viewer.close());
  // 앱을 내리면 쓰던 느낀점을 바로 보낸다.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  setMode(mode);
  createNoteActions({
    getRows: () => (view ? view.trackIds.map((id) => ({ title: view.titles.get(id) ?? '', body: noteValue(id) })) : []),
  });

  return { render, flush, openTrack };
}
