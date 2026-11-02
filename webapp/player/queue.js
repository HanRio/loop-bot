// 재생 순서 계산. 목록과 상태를 받아 다음·이전 곡 id를 돌려준다.
// 목록은 바꾸지 않는다.

// lastIndex가 없거나 잘못된 값이면 0으로 본다. 그래야 결과가 항상 id 또는 null이다.
function safeIndex(lastIndex) {
  return Number.isInteger(lastIndex) && lastIndex >= 0 ? lastIndex : 0;
}

// 현재 곡 다음 자리. 아직 안 틀었으면 0, 목록에서 빠졌으면 lastIndex.
function nextStart(trackIds, currentId, lastIndex) {
  if (currentId == null) return 0;
  const at = trackIds.indexOf(currentId);
  return at === -1 ? safeIndex(lastIndex) : at + 1;
}

// 현재 곡 이전 자리. 아직 안 틀었으면 끝(처음에서 뒤로 가면 마지막 곡).
function prevStart(trackIds, currentId, lastIndex) {
  if (currentId == null) return trackIds.length;
  const at = trackIds.indexOf(currentId);
  return at === -1 ? safeIndex(lastIndex) - 1 : at - 1;
}

export function nextTrack({ trackIds, currentId, lastIndex, repeat, unplayable, manual }) {
  // 한 곡 반복은 목록에 있는 곡만 같은 곡을 다시 튼다. 빠진 곡은 lastIndex 자리로 넘어간다.
  if (repeat === 'one' && !manual && trackIds.includes(currentId) && !unplayable.has(currentId)) {
    return currentId;
  }
  const count = trackIds.length;
  let index = nextStart(trackIds, currentId, lastIndex);
  // 최대 한 바퀴만 돈다. repeat가 off면 끝에서 멈춘다.
  for (let step = 0; step < count; step += 1) {
    if (index >= count) {
      if (repeat !== 'all') return null;
      index = 0;
    }
    const id = trackIds[index];
    if (!unplayable.has(id)) return id;
    index += 1;
  }
  return null;
}

export function prevTrack({ trackIds, currentId, lastIndex, unplayable }) {
  const count = trackIds.length;
  let index = prevStart(trackIds, currentId, lastIndex);
  for (let step = 0; step < count; step += 1) {
    if (index < 0 || index >= count) index = count - 1;
    const id = trackIds[index];
    if (!unplayable.has(id)) return id;
    index -= 1;
  }
  return null;
}
