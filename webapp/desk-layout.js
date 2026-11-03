// 넓은 화면 가사집 카드의 칸 배치 계산. DOM을 다루지 않는다. 입력은 바꾸지 않고 새 객체를 돌려준다.
export const DESK_MIN_RATIO = 0.3;
export const DESK_MAX_RATIO = 0.7;
export const DEFAULT_DESK = Object.freeze({
  a: Object.freeze(['sheet']),
  b: Object.freeze(['video', 'note']),
  ratio: 0.55,
});

const PANES = ['sheet', 'video', 'note'];

export function clampRatio(value) {
  if (!Number.isFinite(value)) return DEFAULT_DESK.ratio;
  return Math.min(DESK_MAX_RATIO, Math.max(DESK_MIN_RATIO, value));
}

// 저장된 글이 없거나 망가졌거나, 세 패널이 한 번씩 들어 있지 않으면 기본 배치로 돌아간다.
export function parseDesk(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return DEFAULT_DESK;
  }
  if (!data || !Array.isArray(data.a) || !Array.isArray(data.b)) return DEFAULT_DESK;
  const panes = [...data.a, ...data.b];
  const complete = panes.length === PANES.length && PANES.every((name) => panes.filter((p) => p === name).length === 1);
  if (!complete) return DEFAULT_DESK;
  return { a: [...data.a], b: [...data.b], ratio: clampRatio(data.ratio) };
}

// 끌어 놓기. 원래 칸이 비게 되고 목표가 다른 칸에 있으면 두 패널을 제자리에서 맞바꾼다. 칸은 비지 않는다.
export function movePane(desk, pane, target, where) {
  if (pane === target) return desk;
  const from = desk.a.includes(pane) ? 'a' : 'b';
  const to = desk.a.includes(target) ? 'a' : 'b';
  const columns = {
    a: desk.a.filter((name) => name !== pane),
    b: desk.b.filter((name) => name !== pane),
  };
  if (columns[from].length === 0) {
    const swap = (name) => (name === pane ? target : name === target ? pane : name);
    return { a: desk.a.map(swap), b: desk.b.map(swap), ratio: desk.ratio };
  }
  const at = columns[to].indexOf(target) + (where === 'after' ? 1 : 0);
  columns[to] = [...columns[to].slice(0, at), pane, ...columns[to].slice(at)];
  return { a: columns.a, b: columns.b, ratio: desk.ratio };
}
