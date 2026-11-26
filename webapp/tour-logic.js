// 첫 방문 안내(코치 마크)의 순서와 말풍선 위치. DOM을 건드리지 않는다.
export const TOUR_DONE_KEY = 'loopbot.tour.done';

// 단계 필드
// tab: 이동할 탭 번호(없으면 그대로). wait: 대상을 재기 전에 기다릴 ms(플레이어가 열리고 닫히는 시간).
// target: CSS 선택자(없으면 가운데 카드). waitClick: 대상을 눌러야 다음으로. waitClose: 열린 창이 닫혀야 다음으로.
// fallback: 대상이 화면에 없을 때 쓰는 문장.
const PLAYER_MOVE_MS = 450;

export const TOUR_STEPS = [
  { tab: 0, target: '#tab-conti .rows li', waitClick: true,
    text: '콘티에는 이번에 들을 곡이 순서대로 있어요. 곡을 눌러 들어 보세요.',
    fallback: '콘티에는 이번에 들을 곡이 순서대로 있어요. 곡을 누르면 바로 들을 수 있어요.' },
  { target: '#mini-open', waitClick: true,
    text: '지금 듣는 곡이 아래 막대에 떠요. 막대를 눌러 플레이어를 크게 열어 보세요.' },
  { wait: PLAYER_MOVE_MS, target: '#play', waitClick: true, text: '가운데 버튼으로 멈추고 다시 들어요. 눌러 보세요.' },
  { target: '#next', waitClick: true, text: '다음 곡으로 넘어가요. 눌러 보세요.' },
  { target: '#lyrics', waitClick: true, text: '가사를 보면서 들을 수 있어요. 눌러 보세요.' },
  { target: '#repeat', waitClick: true, text: '누를 때마다 전체 반복, 한 곡 반복, 반복 끄기로 바뀌어요. 눌러 보세요.' },
  { target: '#player-close', waitClick: true, text: '다 봤으면 이 버튼을 눌러 플레이어를 접어요.' },
  { tab: 1, target: '#tab-library .rows li', waitClick: true,
    text: '라이브러리에는 모든 곡이 있어요. 곡을 하나 눌러 보세요.',
    fallback: '라이브러리에는 내 곡이 모여요. 곡을 누르면 듣기와 담기 메뉴가 떠요.' },
  { target: '#song-add', waitClick: true,
    text: '‘플리에 추가’를 눌러 보세요. 여러 곡을 골라 한꺼번에 담을 수도 있어요.',
    fallback: '곡을 누르면 아래에 ‘플리에 추가’ 버튼이 떠요. 누르면 내 플리에 담겨요.' },
  { target: 'dialog.menu[open]', waitClose: true, text: '곡을 담을 플리를 골라 보세요.' },
  { text: '곡을 새로 넣고 싶으면 봇 채팅에 유튜브 링크나 음원 파일을 보내세요. 잠시 뒤 내 플리에 들어와요.' },
  { tab: 1, target: '#tab-library .lists', text: '‘공유 중’ 표시가 붙은 플리는 모두에게 공유됩니다. 내가 다운로드한 곡은 나만 볼 수 있어요.' },
  { target: '#tabs [data-tab="2"]', text: '묵상: 곡마다 가사와 악보를 보고 느낀점을 적어요.' },
  { target: '#tabs [data-tab="3"]', text: '연습: 속도를 늦추고 어려운 구간만 반복해 들어요.' },
  { target: '#tabs [data-tab="4"]', text: '랭킹: 이번 주, 이번 달 많이 들은 곡과 사람을 봐요.' },
];

// 말풍선 세로 위치. 대상 아래에 자리가 있으면 아래, 없으면 위, 대상이 없으면 가운데. 화면 밖으로 나가지 않게 자른다.
// rect: {top,bottom} | null, viewH: number, bubbleH: number. Returns top (px, number).
export function bubbleTop(rect, viewH, bubbleH, gap = 12, margin = 12) {
  if (!rect) return Math.max(margin, (viewH - bubbleH) / 2);
  const below = rect.bottom + gap;
  if (below + bubbleH <= viewH - margin) return below;
  const above = rect.top - gap - bubbleH;
  if (above >= margin) return above;
  return Math.max(margin, Math.min(below, viewH - margin - bubbleH));
}
