// 전체 플레이어의 음소거 버튼과 볼륨 슬라이더. 그리는 일은 player-view가 맡는다.
import { $ } from './dom.js';
import { readLocal, writeLocal } from './store.js';

export const KEY_VOLUME = 'loopbot.player.volume';

// 저장된 값이 없거나 이상하면 최대(1)로 연다. readLocal은 없을 때 null을 주므로 Number(null)=0을 피한다.
export function readSaved() {
  const raw = readLocal(KEY_VOLUME);
  const value = raw === null || raw === '' ? NaN : Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 1;
}

export function initVolume(player, view) {
  // iPhone/iPad는 하드웨어 버튼으로 조절하므로 볼륨 조작은 숨긴다.
  if (!player.canSetVolume()) return view.paintVolume({ value: 1, enabled: false });

  let value = readSaved();
  // 음소거를 풀 때 돌아갈 값.
  let lastLevel = value > 0 ? value : 1;

  function apply(next, { save = true } = {}) {
    value = next;
    player.setVolume(value);
    if (value > 0) lastLevel = value;
    if (save) writeLocal(KEY_VOLUME, String(value));
    view.paintVolume({ value, enabled: true });
  }

  apply(value, { save: false });
  $('vol').addEventListener('input', (event) => apply(Number(event.target.value) / 100));
  $('mute').addEventListener('click', () => apply(value === 0 ? lastLevel : 0));
  return undefined;
}
