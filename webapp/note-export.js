// 노트 내보내기의 순수 계산. DOM과 저장소는 모른다.

export const DEFAULT_TEMPLATE = '{제목}\n{느낀점}';
export const TEMPLATE_MAX = 2000;

const BRACKETED = /\([^)]*\)|\[[^\]]*\]|【[^】]*】/g;
const UNCLOSED = /\([^)]*$|\[[^\]]*$/;
const TAGS = /#\S+/g;
const ELLIPSIS = /…/g;
const SEPARATOR = /\s+-\s+|\s+\/\s+|\s*[|ㅣ｜]\s*/;
const NOISE = /워십|worship|\blive\b|official|정규|앨범|album|캠프|인도$|\bver\b|버전|찬양팀/i;
const HANGUL = /[가-힣]/;
const TRACK_NO = /^\d+[.)]?\s+/;
const PLACEHOLDER = /\{(제목|느낀점|번호)\}/g;

// 영상 제목에서 곡명만 뽑는다. 업로더와 부가 설명은 버린다.
export function songTitle(raw) {
  if (typeof raw !== 'string') return '';
  const noBrackets = raw.replace(BRACKETED, '').replace(UNCLOSED, '');
  const hasUploader = noBrackets.includes(' - ');
  const parts = noBrackets
    .replace(TAGS, '')
    .replace(ELLIPSIS, '')
    .split(SEPARATOR)
    .map((s) => s.trim())
    .filter(Boolean);
  const candidates = hasUploader ? parts.slice(1) : parts;
  const picked =
    candidates.find((s) => HANGUL.test(s) && !NOISE.test(s)) ??
    candidates.find((s) => !NOISE.test(s)) ??
    (parts[0] && !NOISE.test(parts[0]) ? parts[0] : raw.trim());
  const withoutNo = picked.replace(TRACK_NO, '');
  return (withoutNo || picked).trim();
}

// 템플릿이 쓸 만한지. 느낀점 자리가 있고, 비어 있지 않고, 길이 한도 안이어야 한다.
export function validTemplate(text) {
  return text.trim() !== '' && text.includes('{느낀점}') && text.length <= TEMPLATE_MAX;
}

// 느낀점이 빈 곡은 뺀다. 번호는 남은 곡끼리 센다. 한 번에 치환해서 본문 안의 글자는 다시 바뀌지 않는다.
export function renderNotes(template, rows) {
  const included = rows.filter((row) => row.body.trim() !== '');
  return included
    .map((row, index) => {
      const values = {
        제목: songTitle(row.title),
        느낀점: row.body.trim(),
        번호: String(index + 1),
      };
      return template.replace(PLACEHOLDER, (_, key) => values[key]);
    })
    .join('\n\n');
}
