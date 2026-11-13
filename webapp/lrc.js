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

// 붙여 넣은 가사를 빈 줄 없이 다듬은 줄 배열로.
export function plainLines(text) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

// [{t, text}]를 [mm:ss.cc]가사 형식으로. 탭으로 맞춘 싱크를 저장할 때 쓴다.
export function toLrc(lines) {
  return lines.map(({ t, text }) => {
    const cs = Math.round(Math.max(0, t) * 100);
    const mm = String(Math.floor(cs / 6000)).padStart(2, '0');
    const ss = String(Math.floor(cs / 100) % 60).padStart(2, '0');
    return `[${mm}:${ss}.${String(cs % 100).padStart(2, '0')}]${text}`;
  }).join('\n');
}
