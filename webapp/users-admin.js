// 관리자의 사용자 관리 창. 목록은 서버 응답을 따른다. 글자는 COPY와 textContent로만 넣는다.
import { COPY } from './copy.js';
import { $ } from './render.js';
import { cleanUsername, userRowActions, withRow } from './users-logic.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// 스프라이트의 아이콘 한 개(X, 왕관 등). innerHTML 대신 DOM으로 만든다.
function spriteIcon(id) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'i');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', id);
  svg.append(use);
  return svg;
}

const TOGGLE_TEXT = { grant: COPY.usersGrant, revoke: COPY.usersRevoke, waiting: COPY.usersWaiting };

const newRow = (username) => ({ username, seen: false, is_admin: false, is_owner: false });

function addFailText(err) {
  if (err.code === 'bad_request') return COPY.usersInvalid;
  if (err.code === 'expired') return COPY.reopen;
  return COPY.usersSaveFailed;
}

function adminFailText(err) {
  if (err.code === 'not_seen') return COPY.usersNotSeen;
  if (err.code === 'forbidden') return COPY.usersForbidden;
  if (err.code === 'expired') return COPY.reopen;
  return COPY.usersSaveFailed;
}

// 원래 관리자와 관리자 모두 왕관을 붙이고, 글만 다르다.
function badgeFor(row) {
  if (!row.is_owner && !row.is_admin) return null;
  const badge = document.createElement('span');
  badge.className = 'user-badge';
  badge.append(spriteIcon('#i-crown'), row.is_owner ? COPY.usersOwnerBadge : COPY.usersAdminBadge);
  return badge;
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

  let rows = [];
  // 지정·해제 요청 중인 아이디. 그 줄의 버튼을 잠근다.
  let busy = new Set();
  let owner = false;

  $('users-title').textContent = COPY.usersTitle;
  $('users-help').textContent = COPY.usersHelp;
  open.textContent = COPY.usersOpen;
  input.placeholder = COPY.usersPlaceholder;
  add.textContent = COPY.usersAdd;
  empty.textContent = COPY.usersEmpty;
  close.textContent = COPY.usersClose;

  function render() {
    list.replaceChildren(...rows.map(rowFor));
    empty.hidden = rows.length > 0;
  }

  function setBusy(username, on) {
    busy = new Set(on ? [...busy, username] : [...busy].filter((n) => n !== username));
    render();
  }

  function rowFor(row) {
    const { username } = row;
    const { toggle, canRemove } = userRowActions(row, owner);
    const isBusy = busy.has(username);
    const item = document.createElement('li');
    const label = document.createElement('span');
    label.className = 'user-name';
    label.textContent = `@${username}`;
    const badge = badgeFor(row);
    if (badge) label.append(badge);
    item.append(label);
    if (toggle) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'text-button';
      button.textContent = TOGGLE_TEXT[toggle];
      button.disabled = isBusy || toggle === 'waiting';
      button.addEventListener('click', () => onToggle(row));
      item.append(button);
    }
    if (canRemove) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'icon';
      remove.disabled = isBusy;
      remove.setAttribute('aria-label', COPY.usersRemove(username));
      remove.append(spriteIcon('#i-x'));
      remove.addEventListener('click', () => onRemove(username));
      item.append(remove);
    }
    return item;
  }

  async function load() {
    try {
      ({ usernames: rows } = await api.listUsernames());
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
      // 이미 있는 줄은 권한을 그대로 둔다.
      if (!rows.some((r) => r.username === saved.username)) rows = withRow(rows, newRow(saved.username));
      input.value = '';
      render();
      input.focus();
    } catch (err) {
      error.textContent = addFailText(err);
    } finally {
      add.disabled = false;
    }
  }

  async function onToggle(row) {
    const admin = !row.is_admin;
    const message = admin ? COPY.usersGrantConfirm(row.username) : COPY.usersRevokeConfirm(row.username);
    if (!confirm(message)) return;
    error.textContent = '';
    setBusy(row.username, true);
    try {
      const saved = await api.setUserAdmin(row.username, admin);
      rows = withRow(rows, { ...row, is_admin: saved.is_admin });
    } catch (err) {
      error.textContent = adminFailText(err);
    } finally {
      setBusy(row.username, false);
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
    rows = rows.filter((r) => r.username !== name);
    error.textContent = '';
    render();
  }

  open.addEventListener('click', onOpen);
  form.addEventListener('submit', onSubmit);
  close.addEventListener('click', () => dialog.close());

  return {
    setVisible(isAdmin, isOwner) {
      open.hidden = !isAdmin;
      owner = isOwner;
    },
  };
}
