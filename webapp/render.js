// 화면 그리기만 한다. 상태 계산과 저장은 app.js가 한다. 글자는 모두 textContent로 넣는다.

export const $ = (id) => document.getElementById(id);
const REPEAT_LABEL = { all: '전체 반복', one: '한 곡 반복', off: '반복 끔' };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// index.html의 SVG 스프라이트(#i-이름)를 가리킨다. 이모지는 플랫폼마다 색이 달라 쓰지 않는다.
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'i');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

function iconButton(name, label, onClick, disabled = false) {
  const button = el('button', 'icon');
  button.append(icon(name));
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.disabled = disabled;
  button.addEventListener('click', onClick);
  return button;
}

export function renderPicker(playlists, viewedId, newValue) {
  const picker = $('picker');
  picker.replaceChildren(
    ...playlists.map((p) => new Option(p.name, String(p.id))),
    new Option('+ 새 플레이리스트', newValue),
  );
  picker.value = String(viewedId);
}

// titles: Map(곡 id → 제목). handlers: {onPlay(id), onRemove(id)}
export function renderQueue(ids, { titles, currentId, unplayable }, handlers) {
  $('queue').replaceChildren(
    ...ids.map((id) => {
      const li = el('li');
      li.dataset.id = String(id);
      li.classList.toggle('current', id === currentId);
      li.classList.toggle('unplayable', unplayable.has(id));

      const handle = el('span', 'icon handle');
      handle.append(icon('grip'));
      handle.setAttribute('role', 'img');
      handle.setAttribute('aria-label', '끌어서 순서 바꾸기');

      const title = el('button', 'title', titles.get(id) ?? '');
      title.type = 'button';
      title.addEventListener('click', () => handlers.onPlay(id));

      li.append(handle, title);
      if (unplayable.has(id)) li.append(el('span', 'note', '채팅 재생만 가능'));
      li.append(iconButton('x', '목록에서 빼기', () => handlers.onRemove(id)));
      return li;
    }),
  );
  $('queue-empty').hidden = ids.length > 0;
}

// library: [{id, title}]. inQueue: 현재 목록에 든 곡 id 집합. handlers: {onAdd(id), onDelete(id)}
export function renderLibrary(library, inQueue, handlers) {
  $('library').replaceChildren(
    ...library.map((track) => {
      const li = el('li');
      li.dataset.id = String(track.id);
      li.append(
        el('span', 'title', track.title),
        iconButton('plus', '목록에 넣기', () => handlers.onAdd(track.id), inQueue.has(track.id)),
        iconButton('trash', '라이브러리에서 지우기', () => handlers.onDelete(track.id)),
      );
      return li;
    }),
  );
  $('library-empty').hidden = library.length > 0;
}

export function renderBar({ title, position, duration, playing, repeat }) {
  $('now').textContent = title;
  const seek = $('seek');
  seek.max = String(duration);
  seek.value = String(position);
  seek.style.setProperty('--progress', `${duration > 0 ? (position / duration) * 100 : 0}%`);
  $('time').textContent = `${formatTime(position)} / ${formatTime(duration)}`;
  const toggle = $('toggle');
  toggle.setAttribute('aria-label', playing ? '일시정지' : '재생');
  toggle.setAttribute('aria-pressed', String(playing));
  const repeatButton = $('repeat');
  repeatButton.dataset.mode = repeat;
  repeatButton.setAttribute('aria-label', REPEAT_LABEL[repeat]);
}

export function setNotice(id, text) {
  $(id).textContent = text;
}

export function setVisible(id, visible) {
  $(id).hidden = !visible;
}

// 이름 입력줄. 새로 만들 때와 이름을 바꿀 때 같이 쓴다. value는 처음 넣어 둘 이름, submitLabel은 확인 버튼 글자.
export function openNameForm({ value, submitLabel }) {
  $('new-name').value = value;
  $('new-submit').textContent = submitLabel;
  setVisible('new-form', true);
  $('new-name').focus();
  $('new-name').select();
}
export const closeNameForm = () => setVisible('new-form', false);

// SortableJS가 없으면(CDN 실패) 순서만 못 바꾼다. 나머지 화면은 그대로 동작한다.
export function enableQueueSort({ onStart, onEnd }) {
  if (!window.Sortable) return;
  window.Sortable.create($('queue'), { handle: '.handle', animation: 150, ghostClass: 'ghost', onStart, onEnd });
}

function formatTime(seconds) {
  const whole = Math.floor(Number.isFinite(seconds) ? seconds : 0);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
