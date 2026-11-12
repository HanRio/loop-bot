// LRC 가사를 읽고 지금 재생 위치에 맞는 줄을 찾는 순수 계산. DOM을 건드리지 않는다.

// [mm:ss], [mm:ss.x], [mm:ss.xx], [mm:ss.xxx] 한 개. 메타 태그([ar:..])는 숫자로 시작하지 않아 안 걸린다.
const TIME_TAG = /^\[(\d+):(\d{2})(?:\.(\d{1,3}))?\]/;

// 가사 한 줄을 시간표 여러 개와 글자로 나눈다. 시간표가 없으면 빈 배열.
function parseLine(line) {
  const times = [];
  let rest = line.trim();
  let match;
  while ((match = TIME_TAG.exec(rest))) {
    const [tag, minutes, seconds, fraction = ''] = match;
    times.push(Number(minutes) * 60 + Number(seconds) + Number(`0.${fraction || '0'}`));
    rest = rest.slice(tag.length);
  }
  return times.map((t) => ({ t, text: rest.trim() }));
}

// LRC 본문을 시간순 [{t, text}] 배열로 바꾼다.
export function parseLrc(text) {
  return text
    .split(/\r?\n/)
    .flatMap(parseLine)
    .sort((a, b) => a.t - b.t);
}

// 화면 시간 = 재생 위치 + offsetMs/1000. 그 시간 이하인 마지막 줄 index, 없으면 -1.
export function lineAt(lines, position, offsetMs) {
  const target = position + offsetMs / 1000;
  let index = -1;
  for (let i = 0; i < lines.length && lines[i].t <= target; i += 1) {
    index = i;
  }
  return index;
}
