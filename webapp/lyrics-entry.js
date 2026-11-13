// 가사 직접 넣기 시트와 탭으로 싱크 맞추기 시트. 글자는 모두 textContent로 넣는다.
import { parseLrc, plainLines, toLrc } from './lrc.js';

const MAX_LENGTH = 20000;
const REPLAY_SEC = 2; // 한 줄 뒤로 갈 때 그 줄 조금 앞부터 다시 듣는다.
const LABEL = {
  writeTitle: '가사 직접 넣기', writeHint: '한 줄에 한 소절씩 붙여 넣어 주세요. 시간이 적힌 LRC 가사도 돼요.',
  save: '그냥 저장', tap: '탭으로 싱크 맞추기', close: '닫기', failed: '저장하지 못했어요', empty: '가사를 넣어 주세요',
  tooLong: '가사가 너무 길어요', tapTitle: '탭으로 싱크 맞추기', tapHint: '노래를 들으며 줄이 시작될 때마다 아래 버튼을 눌러 주세요.',
  next: '다음 줄', first: '첫 줄 시작', back: '한 줄 뒤로', restart: '처음부터', play: '재생', pause: '일시정지',
  saveSync: '저장', saving: '저장하는 중이에요', done: '다 맞췄어요. 저장을 눌러 주세요.',
};

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, className) {
  const b = el('button', className, text);
  b.type = 'button';
  return b;
}

// 아래에서 올라오는 .menu 시트. 바깥을 누르면 닫히고, 닫히면 지워진다.
export function sheet(title) {
  const dialog = el('dialog', 'menu');
  dialog.setAttribute('aria-label', title);
  dialog.append(el('h2', null, title));
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  return dialog;
}

function open(dialog) {
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

const isLrc = (text) => parseLrc(text).length > 0;

// save(text)는 서버에 저장하고 끝나면 resolve. tap(lines)는 싱크 시트를 연다.
export function openLyricsWriter({ initial, save, tap }) {
  const dialog = sheet(LABEL.writeTitle);
  const area = el('textarea', 'lyr-paste');
  area.rows = 10;
  area.value = initial;
  area.setAttribute('aria-label', LABEL.writeTitle);
  const status = el('p', 'kicker');
  const saveBtn = button(LABEL.save);
  const tapBtn = button(LABEL.tap);
  tapBtn.classList.add('primary');
  const acts = el('div', 'acts');
  acts.append(saveBtn, tapBtn);
  const close = button(LABEL.close);
  close.addEventListener('click', () => dialog.close());
  dialog.append(el('p', null, LABEL.writeHint), area, status, acts, close);

  function text() {
    const value = area.value.trim();
    if (value === '') status.textContent = LABEL.empty;
    else if (value.length > MAX_LENGTH) status.textContent = LABEL.tooLong;
    else return value;
    return null;
  }
  saveBtn.addEventListener('click', async () => {
    const value = text();
    if (value === null) return;
    saveBtn.disabled = true;
    try {
      await save(value);
      dialog.close();
    } catch {
      status.textContent = LABEL.failed;
      saveBtn.disabled = false;
    }
  });
  tapBtn.addEventListener('click', async () => {
    const value = text();
    if (value === null) return;
    if (isLrc(value)) { // 시간이 이미 있으면 바로 저장한다.
      saveBtn.click();
      return;
    }
    dialog.close();
    tap(plainLines(value));
  });
  return open(dialog);
}

// 줄마다 탭한 재생 위치를 모아 LRC로 저장한다.
export function openTapSync({ lines, player, save }) {
  const dialog = sheet(LABEL.tapTitle);
  dialog.classList.add('lyr-tapper');
  const stamps = []; // 줄 i가 시작한 재생 위치(초)
  const count = el('p', 'kicker');
  const prev = el('p', 'lyr-tap-prev');
  const now = el('p', 'lyr-tap-now');
  const next = el('p', 'lyr-tap-next');
  const tapBtn = button(LABEL.first, 'lyr-tap');
  const back = button(LABEL.back);
  const restart = button(LABEL.restart);
  const playBtn = button('');
  const tools = el('div', 'acts');
  tools.append(back, playBtn, restart);
  const saveBtn = button(LABEL.saveSync);
  saveBtn.classList.add('primary');
  const status = el('p', 'kicker');
  const close = button(LABEL.close);
  close.addEventListener('click', () => dialog.close());
  const saveRow = el('div', 'acts');
  saveRow.append(saveBtn);
  dialog.append(el('p', null, LABEL.tapHint), count, prev, now, next, tapBtn, tools, status, saveRow, close);

  function paint() {
    const i = stamps.length;
    const done = i >= lines.length;
    count.textContent = `${Math.min(i, lines.length)} / ${lines.length}`;
    prev.textContent = lines[i - 1] ?? '';
    now.textContent = done ? '' : lines[i];
    next.textContent = lines[i + 1] ?? '';
    tapBtn.textContent = i === 0 ? LABEL.first : LABEL.next;
    tapBtn.disabled = done;
    back.disabled = i === 0;
    saveBtn.disabled = !done;
    status.textContent = done ? LABEL.done : '';
    playBtn.textContent = player.isPlaying() ? LABEL.pause : LABEL.play;
  }

  tapBtn.addEventListener('click', () => {
    if (stamps.length >= lines.length) return;
    if (!player.isPlaying()) player.toggle();
    const last = stamps[stamps.length - 1] ?? 0;
    stamps.push(Math.max(last, player.position())); // 되감았어도 시간이 거꾸로 가지 않게.
    paint();
  });
  back.addEventListener('click', () => {
    const t = stamps.pop();
    if (t !== undefined) player.seek(Math.max(0, t - REPLAY_SEC));
    paint();
  });
  restart.addEventListener('click', () => {
    stamps.length = 0;
    player.seek(0);
    paint();
  });
  playBtn.addEventListener('click', () => {
    player.toggle();
    setTimeout(paint, 100);
  });
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    status.textContent = LABEL.saving;
    try {
      await save(toLrc(lines.map((text, i) => ({ t: stamps[i], text }))));
      dialog.close();
    } catch {
      status.textContent = LABEL.failed;
      saveBtn.disabled = false;
    }
  });
  paint();
  return open(dialog);
}
