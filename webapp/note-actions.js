// 가사집의 전체 복사와 복사 양식 창. 양식은 로컬에 두고, 텔레그램 클라우드를 쓸 수 있으면 거기에도 맞춘다. 글자는 COPY와 textContent로만 넣는다.
import { COPY } from './copy.js';
import { DEFAULT_TEMPLATE, TEMPLATE_MAX, renderNotes, validTemplate } from './note-export.js';
import { $ } from './dom.js';
import { readLocal, writeLocal } from './store.js';

const TEMPLATE_KEY = 'loopbot_copy_template';
const CLOUD_MIN_VERSION = '6.9';
const COPIED_MS = 1500;

// 클라우드 저장소. 못 쓰는 환경이면 null이다.
function cloudStorage() {
  try {
    const tg = window.Telegram?.WebApp;
    return tg?.isVersionAtLeast(CLOUD_MIN_VERSION) && tg.CloudStorage ? tg.CloudStorage : null;
  } catch {
    return null;
  }
}

function storedTemplate() {
  const local = readLocal(TEMPLATE_KEY);
  return local !== null && validTemplate(local) ? local : DEFAULT_TEMPLATE;
}

// 클라우드 양식을 받아 쓰고 로컬에도 적는다. 실패하면 로컬 양식을 그대로 쓴다.
function pullCloudTemplate(onValue) {
  const storage = cloudStorage();
  if (!storage) return;
  try {
    storage.getItem(TEMPLATE_KEY, (err, value) => {
      if (err || typeof value !== 'string' || !validTemplate(value)) return;
      onValue(value);
    });
  } catch {
    // 클라우드를 못 읽으면 로컬 양식으로 둔다.
  }
}

// 클라우드 저장이 실패해도 로컬에 있으니 무시한다.
function pushCloudTemplate(value) {
  try {
    cloudStorage()?.setItem(TEMPLATE_KEY, value, () => {});
  } catch {
    // 로컬 저장으로 충분하다.
  }
}

// 클립보드 API가 막히면 화면 밖 textarea를 선택해 execCommand로 복사한다.
function copyWithTextarea(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  document.body.append(area);
  try {
    area.select();
    area.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

// writeText를 await 앞에서 불러야 사용자 제스처 안에 머문다.
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return copyWithTextarea(text);
  }
}

export function createNoteActions({ getRows }) {
  const copyAll = $('copy-all');
  const openButton = $('template-open');
  const dialog = $('template-dialog');
  const input = $('template-input');
  const error = $('template-error');
  const save = $('template-save');
  const defaults = $('template-default');
  const cancel = $('template-cancel');

  let template = storedTemplate();
  let restoreTimer = null;

  copyAll.textContent = COPY.copyAll;
  openButton.textContent = COPY.templateEdit;
  $('template-title').textContent = COPY.templateTitle;
  $('template-help').textContent = COPY.templateHelp;
  save.textContent = COPY.save;
  defaults.textContent = COPY.templateDefault;
  cancel.textContent = COPY.cancel;
  input.maxLength = TEMPLATE_MAX;

  // 늦게 온 클라우드 값이 방금 저장한 양식을 덮지 않게 한다.
  let saved = false;
  pullCloudTemplate((value) => {
    if (saved) return;
    template = value;
    writeLocal(TEMPLATE_KEY, value);
  });

  // 복사 버튼 글자를 잠깐 바꾸고 원래대로 돌린다. 연달아 누르면 마지막 것만 남긴다.
  function flash(text) {
    copyAll.textContent = text;
    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(() => {
      copyAll.textContent = COPY.copyAll;
    }, COPIED_MS);
  }

  function saveTemplate(value) {
    template = value;
    writeLocal(TEMPLATE_KEY, value);
    saved = true;
    pushCloudTemplate(value);
  }

  async function onCopyAll() {
    const rows = getRows();
    const text = renderNotes(template, rows);
    if (!text) return flash(COPY.copyAllEmpty);
    const count = rows.filter((row) => row.body.trim() !== '').length;
    const copied = await copyText(text);
    return flash(copied ? COPY.copiedAll(count) : COPY.copyFailedShort);
  }

  copyAll.addEventListener('click', onCopyAll);
  openButton.addEventListener('click', () => {
    input.value = template;
    error.textContent = '';
    dialog.showModal();
  });
  defaults.addEventListener('click', () => {
    input.value = DEFAULT_TEMPLATE;
  });
  cancel.addEventListener('click', () => dialog.close());
  save.addEventListener('click', () => {
    if (!validTemplate(input.value)) {
      error.textContent = COPY.templateInvalid;
      return;
    }
    saveTemplate(input.value);
    dialog.close();
  });
}
