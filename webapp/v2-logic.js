// v2 화면이 쓰는 순수 계산. DOM을 건드리지 않는다.
import { nextTrack } from './queue.js';

const VIDEO_ID = /^[\w-]{6,20}$/;
const WAVE_MIN = 0.08;

// 셔플: 지금 곡이 아닌 들을 수 있는 곡 중 하나. 그런 곡이 없으면 지금 곡(들을 수 있을 때), 아니면 null.
export function shuffleNext({ trackIds, currentId, unplayable, random = Math.random }) {
  const playable = trackIds.filter((id) => !unplayable.has(id));
  const others = playable.filter((id) => id !== currentId);
  if (others.length > 0) return others[Math.floor(random() * others.length)];
  return playable.includes(currentId) ? currentId : null;
}

// 다음 곡. 한 곡 반복은 곡이 끝났을 때만 지키고, 손으로 넘기면 전체 반복처럼 움직인다.
// 셔플 + 반복 끔: 곡이 끝나 넘어갈 때는 아직 안 튼 곡(played에 없는 곡)만 고르고, 다 틀었으면 멈춘다.
export function pickNext({ trackIds, currentId, lastIndex, repeat, unplayable, shuffle, manual, random, played = new Set() }) {
  const keepOne = repeat === 'one' && !manual && trackIds.includes(currentId) && !unplayable.has(currentId);
  if (keepOne) return currentId;
  if (shuffle && repeat === 'off' && !manual) {
    const fresh = trackIds.filter((id) => !played.has(id));
    return fresh.length > 0 ? shuffleNext({ trackIds: fresh, currentId, unplayable, random }) : null;
  }
  if (shuffle) return shuffleNext({ trackIds, currentId, unplayable, random });
  return nextTrack({ trackIds, currentId, lastIndex, repeat: repeat === 'one' ? 'all' : repeat, unplayable });
}

// 곡마다 늘 같은 모양의 파형 막대(0.08~1). 실제 소리 분석이 아니라 장식이다.
// 앞뒤는 낮고 가운데가 높은 곡 흐름에 무작위를 섞고, 옆 막대와 부드럽게 잇는다.
export function waveform(seed, count) {
  const rand = mulberry(seed * 977 + 13);
  const out = [];
  let prev = 0.3;
  for (let i = 0; i < count; i += 1) {
    const energy = 0.25 + 0.7 * Math.sin((Math.PI * (i + 0.5)) / count) ** 0.8;
    const v = Math.min(1, Math.max(WAVE_MIN, energy * (0.55 + rand() * 0.6)));
    prev = prev * 0.45 + v * 0.55;
    out.push(Math.min(1, Math.max(WAVE_MIN, prev)));
  }
  return out;
}

// 참고 영상 썸네일. 이상한 id는 주소로 만들지 않는다.
export function coverUrl(videoId) {
  return typeof videoId === 'string' && VIDEO_ID.test(videoId) ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null;
}

export function formatTime(seconds) {
  const whole = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function mulberry(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
