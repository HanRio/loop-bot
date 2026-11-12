// 대화창 도우미. dialog는 호출할 때마다 만들어 body에 붙이고, 닫히면 지운다. 글자는 모두 textContent로 넣는다.
const SVG_NS = 'http://www.w3.org/2000/svg';
const ICON_PATHS = {
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  person: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  search: 'M10.5 4a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM20 20l-4.5-4.5',
};
const LABEL = { close: '닫기', cancel: '취소', confirm: '확인', myLists: '내 목록', sharedLists: '공유받은 목록', pickTitle: '목록 바꾸기' };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// 고정 SVG 아이콘. 경로는 이 파일의 상수에서만 온다.
export function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'i');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICON_PATHS[name]);
  svg.append(path);
  return svg;
}

// 화면 모듈이 같이 쓰는 아이콘 버튼. 줄 안에 있어도 줄의 클릭(재생)으로 번지지 않는다.
export function iconButton(name, label, onClick, className = 'ib') {
  const button = el('button', className);
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.append(icon(name));
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

// 시트형 dialog를 만들어 붙이고 연다. 바깥을 누르거나 Esc로 닫힌다.
function makeDialog(children, onClose) {
  const dialog = el('dialog', 'menu');
  dialog.append(...children);
  dialog.addEventListener('click', (event) => {
    // 키보드 Enter로 누른 버튼의 click은 좌표가 0이라 바깥으로 오인하니 dialog 자신을 누른 경우만 본다.
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    const outside = event.clientX < box.left || event.clientX > box.right
      || event.clientY < box.top || event.clientY > box.bottom;
    if (outside) dialog.close();
  });
  dialog.addEventListener('close', () => {
    dialog.remove();
    onClose?.();
  }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

function textButton(text, className = 'btn', type = 'button') {
  const button = el('button', className, text);
  button.type = type;
  return button;
}

// 목록 고르기. 고른 목록의 id를 주고, 닫으면 null을 준다.
export function openListPicker({ playlists, sharedPlaylists, currentId }) {
  return new Promise((resolve) => {
    let chosen = null;
    const listButton = (playlist) => {
      const button = textButton(playlist.name);
      if (playlist.id === currentId) button.setAttribute('aria-current', 'true');
      button.addEventListener('click', () => {
        chosen = playlist.id;
        dialog.close();
      });
      return button;
    };
    const children = [el('h2', null, LABEL.pickTitle), el('p', 'kicker', LABEL.myLists), ...playlists.map(listButton)];
    if (sharedPlaylists.length > 0) {
      children.push(el('p', 'kicker', LABEL.sharedLists), ...sharedPlaylists.map(listButton));
    }
    const close = textButton(LABEL.close);
    close.addEventListener('click', () => dialog.close());
    children.push(close);
    const dialog = makeDialog(children, () => resolve(chosen));
  });
}

// ⋯ 메뉴. items: {label, danger?, run}[]. 줄을 누르면 먼저 닫고 run을 부른다.
export function openMenu(items) {
  const children = items.map((item) => {
    const button = textButton(item.label);
    if (item.danger) button.classList.add('danger');
    button.addEventListener('click', () => {
      dialog.close();
      item.run();
    });
    return button;
  });
  const close = textButton(LABEL.close);
  close.addEventListener('click', () => dialog.close());
  children.push(close);
  const dialog = makeDialog(children);
}

// 이름 입력. 확인하면 다듬은 이름을, 취소하거나 닫으면 null을 준다. 빈 이름은 확인을 막는다.
export function askName({ value = '', title, max }) {
  return new Promise((resolve) => {
    let result = null;
    const input = el('input');
    input.type = 'text';
    input.maxLength = max;
    input.value = value;
    input.setAttribute('aria-label', title);
    const search = el('label', 'search glass');
    search.append(input);

    const submit = textButton(LABEL.confirm, 'btn', 'submit');
    const cancel = textButton(LABEL.cancel);
    cancel.addEventListener('click', () => dialog.close());
    const actions = el('div', 'acts');
    actions.append(cancel, submit);

    const form = el('form');
    form.append(search, actions);
    const syncSubmit = () => {
      submit.disabled = input.value.trim() === '';
    };
    input.addEventListener('input', syncSubmit);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      result = name;
      dialog.close();
    });

    const dialog = makeDialog([el('h2', null, title), form], () => resolve(result));
    syncSubmit();
    input.select();
  });
}
