// 볼륨 버튼과 슬라이더. 넓은 화면은 슬라이더를 항상 보이고, 좁은 화면은 버튼을 눌러 펼친다.
import { $ } from './render.js';
import { readLocal, writeLocal } from './store.js';

const KEY_VOLUME = 'loopbot.player.volume';
const WIDE_QUERY = '(min-width: 760px)';

// 저장된 값이 없거나 이상하면 최대(1)로 연다. readLocal은 없을 때 null을 주므로 Number(null)=0을 피한다.
function readSaved() {
  const raw = readLocal(KEY_VOLUME);
  const value = raw === null || raw === '' ? NaN : Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 1;
}

export function initVolume(player) {
  // iPhone/iPad는 하드웨어 버튼으로 조절하므로 이 UI는 숨긴 채 둔다.
  if (!player.canSetVolume()) return;

  const button = $('volume');
  const pop = $('volume-pop');
  const range = $('volume-range');
  const icon = $('volume-icon');
  const wide = matchMedia(WIDE_QUERY);
  let value = readSaved();
  // 음소거를 풀 때 돌아갈 값.
  let lastLevel = value > 0 ? value : 1;

  function paint() {
    const muted = value === 0;
    range.value = String(value);
    range.style.setProperty('--progress', `${value * 100}%`);
    icon.setAttribute('href', muted ? '#i-mute' : '#i-volume');
    button.setAttribute('aria-pressed', String(muted));
  }

  function apply(next, { save = true } = {}) {
    value = next;
    player.setVolume(value);
    if (value > 0) lastLevel = value;
    if (save) writeLocal(KEY_VOLUME, String(value));
    paint();
  }

  function syncLayout() {
    pop.hidden = !wide.matches;
  }

  button.hidden = false;
  apply(value, { save: false });
  syncLayout();
  wide.addEventListener('change', syncLayout);

  range.addEventListener('input', () => apply(Number(range.value)));

  button.addEventListener('click', () => {
    if (wide.matches) {
      apply(value === 0 ? lastLevel : 0);
      return;
    }
    pop.hidden = !pop.hidden;
  });

  // 좁은 화면에서만 바깥을 누르거나 Escape로 닫는다. 넓은 화면은 슬라이더가 항상 보인다.
  document.addEventListener('pointerdown', (event) => {
    if (wide.matches || pop.hidden) return;
    if (button.contains(event.target) || pop.contains(event.target)) return;
    pop.hidden = true;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !wide.matches) pop.hidden = true;
  });
}
