// 연습 탭: 재생 속도와 구간 반복(A·B). 재생기는 위치 변화 이벤트를 밖으로 내주지 않아 주기적으로 위치를 본다.
import { $ } from './dom.js';
import { SPEEDS, loopCheck } from './ui-logic.js';

const KICKER = '곡의 어려운 부분을 나눠 익혀요';
// 재생기의 timeupdate와 비슷한 간격. 구간 끝에서 조금 늦게 돌아갈 수 있다.
const POLL_MS = 250;

const pad = (n) => String(n).padStart(2, '0');
const mmss = (sec) => {
  const s = Math.floor(sec);
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
};
const speedLabel = (speed) => (speed === 1 ? '1.0x' : `${speed}x`);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, onClick) {
  const node = el('button', '', label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

export function createPractice({ player }) {
  const root = $('tab-practice');
  // 구간: a, b는 초 단위이거나 아직 없으면 null.
  let loop = { a: null, b: null };
  let trackId;

  const speedButtons = SPEEDS.map((speed) => button(speedLabel(speed), () => {
    player.setRate(speed);
    paintSpeed();
  }));
  const status = el('p', 'note');

  function paintSpeed() {
    const current = player.rate();
    speedButtons.forEach((node, i) => {
      node.setAttribute('aria-pressed', String(Math.abs(SPEEDS[i] - current) < 0.001));
    });
  }

  function paintStatus(position) {
    const a = loop.a === null ? '--:--' : mmss(loop.a);
    const b = loop.b === null ? '--:--' : mmss(loop.b);
    status.textContent = `${mmss(position)} · A ${a} · B ${b}`;
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

  const speedRow = el('div', 'seg speed');
  speedRow.setAttribute('aria-label', '재생 속도');
  speedRow.append(...speedButtons);
  const speedPanel = el('section', 'panel glass');
  speedPanel.append(
    el('h2', '', '속도'),
    el('p', '', '느리게 들으며 박자와 가사를 익혀요.'),
    speedRow,
  );

  const loopPanel = el('section', 'panel glass');
  const abRow = el('div', 'ab');
  abRow.setAttribute('aria-label', '구간 반복');
  abRow.append(
    button('A 지점', () => setLoop({ ...loop, a: player.position() })),
    button('B 지점', () => setLoop({ ...loop, b: player.position() })),
    button('해제', () => setLoop({ a: null, b: null })),
  );
  loopPanel.append(el('h2', '', '구간 반복'), abRow, status);

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
