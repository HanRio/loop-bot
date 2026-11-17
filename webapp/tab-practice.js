// 연습 탭: 재생 속도와 구간 반복(A·B). 재생기는 위치 변화 이벤트를 밖으로 내주지 않아 주기적으로 위치를 본다.
import { $ } from './dom.js';
import { SPEED, loopCheck } from './ui-logic.js';

const KICKER = '곡의 어려운 부분을 나눠 익혀요';
// 재생기의 timeupdate와 비슷한 간격. 구간 끝에서 조금 늦게 돌아갈 수 있다.
const POLL_MS = 250;

const pad = (n) => String(n).padStart(2, '0');
const mmss = (sec) => {
  const s = Math.floor(sec);
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
};
const speedLabel = (speed) => `${speed.toFixed(2)}x`;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, onClick, className = '') {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

export function createPractice({ player }) {
  const root = $('tab-practice');
  // 구간: a, b는 초 단위이거나 아직 없으면 null.
  let loop = { a: null, b: null };
  let trackId;

  // 속도 막대. 구간 막대와 같은 모양이고, 진한 부분이 지금 속도다.
  const speedBar = el('input', 'loopbar');
  speedBar.type = 'range';
  speedBar.min = String(SPEED.min);
  speedBar.max = String(SPEED.max);
  speedBar.step = String(SPEED.step);
  speedBar.setAttribute('aria-label', '재생 속도');
  const speedValue = el('b', 'speed-value');
  speedBar.addEventListener('input', () => {
    player.setRate(Number(speedBar.value));
    paintSpeed();
  });
  const status = el('p', 'note');

  function paintSpeed() {
    const current = Math.min(SPEED.max, Math.max(SPEED.min, player.rate()));
    speedBar.value = String(current);
    speedBar.setAttribute('aria-valuetext', speedLabel(current));
    speedBar.style.setProperty('--progress', `${((current - SPEED.min) / (SPEED.max - SPEED.min)) * 100}%`);
    speedValue.textContent = speedLabel(current);
  }

  function paintStatus(position) {
    const a = loop.a === null ? '--:--' : mmss(loop.a);
    const b = loop.b === null ? '--:--' : mmss(loop.b);
    status.textContent = `${mmss(position)} · A ${a} · B ${b}`;
    paintBar(position);
  }

  // 구간 막대: 지금 위치를 끌어 옮기고, A~B 구간을 색으로 보여 준다.
  const bar = el('input', 'loopbar');
  bar.type = 'range';
  bar.min = '0';
  bar.step = '0.1';
  bar.setAttribute('aria-label', '구간 반복 위치');
  let dragging = false;
  bar.addEventListener('pointerdown', () => { dragging = true; });
  bar.addEventListener('input', () => {
    dragging = true;
    player.seek(Number(bar.value));
    paintStatus(Number(bar.value));
  });
  bar.addEventListener('change', () => { dragging = false; });
  bar.addEventListener('pointerup', () => { dragging = false; });

  const pct = (sec, total) => `${total > 0 ? Math.min(100, (sec / total) * 100) : 0}%`;
  function paintBar(position) {
    const total = player.duration();
    bar.max = String(total || 0);
    bar.disabled = !total;
    if (!dragging) bar.value = String(position);
    bar.style.setProperty('--progress', pct(position, total));
    bar.style.setProperty('--a', loop.a === null ? '0%' : pct(loop.a, total));
    // B가 없으면 A부터 끝까지가 아니라 A 한 점만 표시한다.
    bar.style.setProperty('--b', loop.b === null ? (loop.a === null ? '0%' : pct(loop.a, total)) : pct(loop.b, total));
  }

  function setLoop(next) {
    loop = next;
    paintStatus(player.position());
  }

  function tick() {
    const position = player.position();
    const range = loop.a !== null && loop.b !== null ? loop : null;
    const back = loopCheck(position, range);
    if (back === null) {
      paintStatus(position);
      return;
    }
    player.seek(back);
    paintStatus(back);
  }

  const speedHead = el('div', 'speed-head');
  speedHead.append(el('h2', '', '속도'), speedValue);
  const speedPanel = el('section', 'panel glass');
  speedPanel.append(
    speedHead,
    el('p', '', '느리게 들으며 박자와 가사를 익혀요.'),
    speedBar,
  );

  const loopPanel = el('section', 'panel glass');
  const abRow = el('div', 'ab');
  abRow.setAttribute('role', 'group');
  abRow.setAttribute('aria-label', '구간 반복');
  abRow.append(
    button('A 지점', () => setLoop({ ...loop, a: player.position() }), 'btn'),
    button('B 지점', () => setLoop({ ...loop, b: player.position() }), 'btn'),
    button('해제', () => setLoop({ a: null, b: null }), 'btn'),
  );
  loopPanel.append(el('h2', '', '구간 반복'), bar, abRow, status);

  root.replaceChildren(
    el('p', 'kicker', KICKER),
    el('h1', '', '연습'),
    speedPanel,
    loopPanel,
  );

  paintSpeed();
  paintStatus(player.position());
  setInterval(tick, POLL_MS);

  return {
    // 곡이 바뀌면 이전 곡의 구간을 버린다. 속도는 재생기가 그대로 유지한다.
    render(view = {}) {
      if (view.currentId !== undefined && view.currentId !== trackId) {
        trackId = view.currentId;
        loop = { a: null, b: null };
      }
      paintSpeed();
      paintStatus(player.position());
    },
  };
}
