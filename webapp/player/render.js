// 화면 그리기만 한다. 상태 계산과 저장은 app.js가 한다. 글자는 모두 textContent로 넣는다.

export const $ = (id) => document.getElementById(id);
const REPEAT_LABEL = { all: '전체 반복', one: '한 곡 반복', off: '반복 끔' };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function iconButton(text, label, onClick, disabled = false) {
  const button = el('button', 'icon', text);
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

      const handle = el('span', 'icon handle', '≡');
      handle.setAttribute('role', 'img');
      handle.setAttribute('aria-label', '끌어서 순서 바꾸기');

      const title = el('button', 'title', titles.get(id) ?? '');
      title.type = 'button';
      title.addEventListener('click', () => handlers.onPlay(id));

      li.append(handle, title);
      if (unplayable.has(id)) li.append(el('span', 'note', '채팅 재생만 가능'));
      li.append(iconButton('✕', '목록에서 빼기', () => handlers.onRemove(id)));
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
        iconButton('＋', '목록에 넣기', () => handlers.onAdd(track.id), inQueue.has(track.id)),
        iconButton('🗑', '라이브러리에서 지우기', () => handlers.onDelete(track.id)),
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

function formatTime(seconds) {
  const whole = Math.floor(Number.isFinite(seconds) ? seconds : 0);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
