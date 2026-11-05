// 관리자의 사용자 관리 창. 목록은 서버 응답을 따른다. 글자는 COPY와 textContent로만 넣는다.
import { COPY } from './copy.js';
import { $ } from './render.js';
import { cleanUsername } from './users-logic.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// 지우기 버튼의 X 아이콘. innerHTML 대신 DOM으로 만든다.
function closeIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'i');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', '#i-x');
  svg.append(use);
  return svg;
}

const addSorted = (names, name) => (names.includes(name) ? names : [...names, name].sort());

function addFailText(err) {
  if (err.code === 'bad_request') return COPY.usersInvalid;
  if (err.code === 'expired') return COPY.reopen;
  return COPY.usersSaveFailed;
}

export function createUsersAdmin({ api }) {
  const open = $('users-open');
  const dialog = $('users-dialog');
  const form = $('users-form');
  const input = $('users-input');
  const add = $('users-add');
  const error = $('users-error');
  const list = $('users-list');
  const empty = $('users-empty');
  const close = $('users-close');

  let names = [];

  $('users-title').textContent = COPY.usersTitle;
  $('users-help').textContent = COPY.usersHelp;
  open.textContent = COPY.usersOpen;
  input.placeholder = COPY.usersPlaceholder;
  add.textContent = COPY.usersAdd;
  empty.textContent = COPY.usersEmpty;
  close.textContent = COPY.usersClose;

  function render() {
    list.replaceChildren(...names.map(rowFor));
    empty.hidden = names.length > 0;
  }

  function rowFor(name) {
    const row = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `@${name}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'icon';
    remove.setAttribute('aria-label', COPY.usersRemove(name));
    remove.append(closeIcon());
    remove.addEventListener('click', () => onRemove(name));
    row.append(label, remove);
    return row;
  }

  async function load() {
    try {
      ({ usernames: names } = await api.listUsernames());
      error.textContent = '';
    } catch (err) {
      error.textContent = err.code === 'expired' ? COPY.reopen : COPY.usersLoadFailed;
    }
    render();
  }

  async function onOpen() {
    input.value = '';
    error.textContent = '';
    dialog.showModal();
    await load();
  }

  async function onSubmit(event) {
    event.preventDefault();
    const name = cleanUsername(input.value);
    if (!name) {
      error.textContent = COPY.usersInvalid;
      return;
    }
    error.textContent = '';
    add.disabled = true;
    try {
      const saved = await api.addUsername(name);
      names = addSorted(names, saved.username);
      input.value = '';
      render();
      input.focus();
    } catch (err) {
      error.textContent = addFailText(err);
    } finally {
      add.disabled = false;
    }
  }

  async function onRemove(name) {
    if (!confirm(COPY.usersRemoveConfirm(name))) return;
    try {
      await api.removeUsername(name);
    } catch (err) {
      // 이미 없는 아이디는 지운 것으로 본다.
      if (err.code !== 'not_found') {
        error.textContent = COPY.usersSaveFailed;
        return;
      }
    }
    names = names.filter((n) => n !== name);
    error.textContent = '';
    render();
  }

  open.addEventListener('click', onOpen);
  form.addEventListener('submit', onSubmit);
  close.addEventListener('click', () => dialog.close());

  return {
    setVisible(isAdmin) {
      open.hidden = !isAdmin;
    },
  };
}
