// 라이브러리 탭: 검색, 내 목록과 공유받은 목록 칸, 모든 곡 줄. 글자는 모두 textContent로 넣는다.
import { moodFor } from './ui-logic.js';
import { $ } from './dom.js';
import { icon, iconButton } from './menus.js';

const NO_TRACK_TEXT = '아직 곡이 없어요.';
const NO_MATCH_TEXT = '찾는 곡이 없어요.';
const UNPLAYABLE_TEXT = '채팅 재생만 가능';

// 목록 칸과 곡 줄의 색. conti 탭과 같은 규칙이다.
const art = (id) => {
  const [first, , third] = moodFor(id);
  return `linear-gradient(150deg, ${first}, ${third})`;
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createLibrary({ onPlay, onOpenList, onNewList, onTrackMenu }) {
  const pane = $('tab-library');
  let view = null;
  let query = '';

  const kicker = el('p', 'kicker');
  const title = el('h1', null, '라이브러리');
  const search = el('label', 'search glass');
  search.append(icon('search'));
  const input = el('input');
  input.type = 'search';
  input.placeholder = '곡 제목';
  input.setAttribute('aria-label', '곡 검색');
  search.append(input);
  input.addEventListener('input', () => {
    query = input.value.trim();
    renderTracks();
  });

  const myHeading = el('h2', null, '내 목록');
  const myLists = el('div', 'lists');
  const sharedHeading = el('h2', null, '공유받은 목록');
  const sharedLists = el('div', 'lists');
  const allHeading = el('h2', null, '모든 곡');
  const trackList = el('ul', 'rows');
  const empty = el('p', 'empty');

  // 새 목록 칸은 한 번만 만든다. 다시 그릴 때 이 칸의 클릭 처리가 쌓이지 않는다.
  const newButton = el('button', 'new');
  newButton.type = 'button';
  const newCover = el('span', 'cv glass');
  newCover.append(icon('plus'));
  newButton.append(newCover, '새 목록 만들기');
  newButton.addEventListener('click', () => onNewList());

  pane.replaceChildren(kicker, title, search, myHeading, myLists, sharedHeading, sharedLists, allHeading, trackList, empty);

  function playlistCard(playlist) {
    const button = el('button', 'new');
    button.type = 'button';
    const cover = el('span', 'cv');
    cover.style.background = art(playlist.id);
    button.append(cover, playlist.name, document.createElement('br'), el('small', null, `${playlist.track_ids.length}곡`));
    button.addEventListener('click', () => onOpenList(playlist.id));
    return button;
  }

  // 곡 줄. 줄을 누르면 재생하고, 끝의 ⋯은 곡 메뉴를 연다.
  function trackRow(track, next) {
    const li = el('li', 'row');
    li.dataset.id = String(track.id);
    li.classList.toggle('now', track.id === next.currentId);
    li.classList.toggle('off', next.unplayable.has(track.id));

    const thumb = el('span', 'thumb');
    thumb.style.background = art(track.id);
    const text = el('span', 't');
    text.append(el('b', null, track.title));
    if (next.unplayable.has(track.id)) text.append(el('span', null, UNPLAYABLE_TEXT));

    li.append(thumb, text, iconButton('more', '곡 메뉴', () => onTrackMenu(track.id), 'more'));
    li.addEventListener('click', () => onPlay(track.id));
    return li;
  }

  // 검색어로 곡 줄만 다시 거른다. 검색창은 그대로 둬서 입력 포커스가 유지된다.
  function renderTracks() {
    const needle = query.toLowerCase();
    const matches = view.library.filter((track) => track.title.toLowerCase().includes(needle));
    trackList.replaceChildren(...matches.map((track) => trackRow(track, view)));
    empty.textContent = view.library.length === 0 ? NO_TRACK_TEXT : NO_MATCH_TEXT;
    empty.hidden = matches.length > 0;
  }

  function render(next) {
    view = next;
    kicker.textContent = `모든 곡 ${next.library.length} · 내 목록 ${next.playlists.length}`;
    myLists.replaceChildren(newButton, ...next.playlists.map(playlistCard));
    const hasShared = next.sharedPlaylists.length > 0;
    sharedHeading.hidden = !hasShared;
    sharedLists.hidden = !hasShared;
    sharedLists.replaceChildren(...next.sharedPlaylists.map(playlistCard));
    renderTracks();
  }

  return { render };
}
