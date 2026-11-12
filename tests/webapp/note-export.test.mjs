import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TEMPLATE,
  TEMPLATE_MAX,
  songTitle,
  validTemplate,
  renderNotes,
} from '../../webapp/note-export.js';

// 유튜브 영상 제목에서 곡명만 뽑는다.
test('songTitle picks the song title from common video title shapes', () => {
  const cases = [
    ['F.I.A - F.I.A LIVE WORSHIP - 슬픈 마음 있는 사람 (찬송가 91장/피아버전) / TAKE THE NAME OF JESUS WITH YOU (FIA.ver)', '슬픈 마음 있는 사람'],
    ['F.I.A - F.I.A LIVE WORSHIP - 슬픈 마음 있는 사람 (찬송가 91장/피아버전) / TAKE THE NAME…', '슬픈 마음 있는 사람'],
    ['F.I.A - 나의 가장 낮은 마음 / HUMBLE AND LOWLY SPIRIT - 피아워십', '나의 가장 낮은 마음'],
    ['F.I.A - 마귀들과 싸울지라 (찬송가 348장/피아버전) / UP AND FIGHT AGAINST THE DEVIL (FIA.ver) - 피아워십', '마귀들과 싸울지라'],
    ['F.I.A - 마귀들과 싸울지라 (찬송가 348장/피아버전) / UP AND FIGHT AGAINST THE DEVIL (FIA.ver)…', '마귀들과 싸울지라'],
    ['F.I.A - 1. 나는 일어섭니다 (Official) | I SHALL STAND | 피아워십 정규 4집', '나는 일어섭니다'],
    ['ANOINTING - 13 빛으로 비추시네 (Official Video) ㅣ 어노인팅예배캠프2023 #Chapter2', '빛으로 비추시네'],
    ['MARKERS WORSHIP - 주의 자녀로 산다는 것은 - 마커스워십 | 소진영 인도 |  Living as Children of the Lord', '주의 자녀로 산다는 것은'],
    ['WELOVE CREATIVE TEAM - WELOVE | 우리가 주를 더욱 사랑하고 | Loving You More [애가 | Love in the Lament]', '우리가 주를 더욱 사랑하고'],
    ['F.I.A - F.I.A LIVE WORSHIP - 부르신 곳에서 (피아버전) | At The Place Where You Call (FIA.ver)', '부르신 곳에서'],
    ['WECCLESIA 위클레시아 - 예수 늘 함께하시네 | Jesus Always With Me', '예수 늘 함께하시네'],
    ['HILLSONG - Oceans (Where Feet May Fail)', 'Oceans'],
    ['내 곡 이름', '내 곡 이름'],
    ['나의 노래 - 피아워십', '나의 노래'],
    ['Just Title', 'Just Title'],
    ['나의 사랑/나의 생명', '나의 사랑/나의 생명'],
    ['F.I.A - 주님-나의 힘', '주님-나의 힘'],
    ['피아워십', '피아워십'],
    ['1004', '1004'],
    ['', ''],
  ];

  for (const [raw, expected] of cases) {
    assert.equal(songTitle(raw), expected, `input: ${raw}`);
  }
});

test('songTitle returns empty string for non-string input', () => {
  assert.equal(songTitle(undefined), '');
  assert.equal(songTitle(null), '');
});

test('validTemplate requires the feeling placeholder, non-blank text, and the length limit', () => {
  assert.equal(validTemplate(DEFAULT_TEMPLATE), true);
  assert.equal(validTemplate('{제목}'), false);
  assert.equal(validTemplate('   '), false);
  assert.equal(validTemplate(''), false);
  assert.equal(validTemplate('{느낀점}' + 'a'.repeat(TEMPLATE_MAX - 5)), true);
  assert.equal(validTemplate('{느낀점}' + 'a'.repeat(TEMPLATE_MAX - 4)), false);
});

test('renderNotes with the default template gives title and feeling on two lines', () => {
  assert.equal(renderNotes(DEFAULT_TEMPLATE, [{ title: '제목', body: '내용' }]), '제목\n내용');
});

test('renderNotes skips blank-body rows but keeps playlist order numbers', () => {
  const template = '{번호}. {제목}\n{느낀점}';
  const rows = [
    { title: 'A', body: '  ' },
    { title: 'B', body: '좋다' },
    { title: 'C', body: '' },
    { title: 'D', body: '  good  ' },
  ];

  assert.equal(renderNotes(template, rows), '2. B\n좋다\n\n4. D\ngood');
});

test('renderNotes joins songs with a blank line', () => {
  const rows = [
    { title: 'A', body: 'a' },
    { title: 'B', body: 'b' },
  ];

  assert.equal(renderNotes(DEFAULT_TEMPLATE, rows), 'A\na\n\nB\nb');
});

test('renderNotes keeps placeholder-like text and $ patterns in a body literal', () => {
  const rows = [{ title: 'A', body: '{제목} $& $1' }];

  assert.equal(renderNotes(DEFAULT_TEMPLATE, rows), 'A\n{제목} $& $1');
});

test('renderNotes returns empty string when there are no rows', () => {
  assert.equal(renderNotes(DEFAULT_TEMPLATE, []), '');
});
