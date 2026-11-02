// 서버로 보내는 쪽의 순서와 로컬 저장소. 화면과 재생은 모른다.
import { createSaver } from './saver.js';

const ACTIVE_RETRY_MS = 3000;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const readLocal = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const writeLocal = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 저장 공간이 막혀도 재생은 된다.
  }
};

// 플레이리스트마다 저장기 하나. save(value)는 {id, name, track_ids}를 서버에 보낸다.
export function createSaves({ save, onError, onSaved }) {
  const savers = new Map();
  // 성공한 저장 수. 목록을 받는 동안 저장이 끝났는지 알아본다.
  let savedCount = 0;
  const anyPending = () => [...savers.values()].some((s) => s.pending());
  const saveAndCount = async (value) => {
    const result = await save(value);
    savedCount += 1;
    return result;
  };
  return {
    update(value) {
      if (!savers.has(value.id)) {
        savers.set(
          value.id,
          createSaver(saveAndCount, {
            onError: (err) => onError(value.id, err),
            onSaved: () => {
              if (!anyPending()) onSaved();
            },
          }),
        );
      }
      savers.get(value.id).update(value);
    },
    pending: (id) => savers.get(id)?.pending() ?? false,
    saved: () => savedCount,
    flushAll: () => Promise.all([...savers.values()].map((s) => s.flush())),
    // 보내 봤자 소용없는 목록(지운 목록 등)의 저장을 버린다. 그 저장이 붙잡던 알림도 내린다.
    drop(id) {
      savers.get(id)?.cancel();
      savers.delete(id);
      if (!anyPending()) onSaved();
    },
  };
}

// 플레이리스트 이름. 앞뒤 공백을 떼고 서버와 같게 코드포인트 20자까지만 쓴다.
export const cleanName = (raw) => [...raw.trim()].slice(0, 20).join('');

// 드래그로 정한 순서에 목록 밖에서 생긴 곡을 붙인다. 화면 DOM에 없던 곡(새로 받은 곡)은 뒤에 둔다.
// 서버가 지운 곡은 current에 없으므로 빠진다.
export function mergeOrder(domIds, currentIds) {
  return [...domIds.filter((x) => currentIds.includes(x)), ...currentIds.filter((x) => !domIds.includes(x))];
}

// PUT /active는 한 번에 하나만 나간다. 대기 중에는 가장 최근 선택만 남는다.
// 실패하면 같은 선택을 3초 뒤 한 번만 다시 보내고, 그 뒤엔 조용히 멈춘다. 다음 선택이나 저장이 다시 맞춘다.
export function createActiveSender(send, onError) {
  let wanted = null;
  let busy = false;

  async function drain() {
    busy = true;
    let lastFailed = null;
    while (wanted !== null) {
      const id = wanted;
      wanted = null;
      try {
        await send(id);
        lastFailed = null;
      } catch (err) {
        onError(err);
        const retry = id === lastFailed;
        lastFailed = id;
        if (!retry && wanted === null) {
          wanted = id;
          await delay(ACTIVE_RETRY_MS);
        }
      }
    }
    busy = false;
  }

  return {
    request(id) {
      wanted = id;
      if (!busy) drain();
    },
  };
}
