# 실시간 가사 설계 (단계 2-가사)

날짜: 2026-11-12 · 상태: 승인 대기

## 목적

플레이어 화면 위쪽에 가사를 보여 준다. 지금 부르는 줄이 강조되고 노래를 따라 자동으로 넘어간다. 따라 부르기가 목적이다.

## 정한 것 (인터뷰)

| 항목 | 결정 |
|---|---|
| 보여 줄 곳 | 전체 플레이어 위쪽 (지금 제목이 크게 나오는 자리) |
| 범위 | 자동 검색으로 찾을 수 있는 곡만. 붙여넣기·탭 맞추기·AI 받아쓰기는 이번에 하지 않는다 |
| 찾는 때 | 봇이 곡을 받을 때. 이미 있는 곡은 한 번 채우는 스크립트로 |
| 고르기 | 길이가 가장 비슷한 후보를 자동으로 붙인다. 플레이어의 "다른 가사 찾기"에서 후보를 골라 바꾼다 |
| 싱크 | ± 버튼, 0.5초 단위. 곡마다 저장 |
| 공유 | 가사와 싱크값은 곡에 붙는다. 그 곡을 볼 수 있는 사람은 모두 같은 가사를 본다. 바꾸기·조절은 곡 주인과 관리자만 |

## 조사 결과

라이브러리 12곡으로 시험했다 (2026-11-12).

- LRCLIB 검색(`/api/search?q=`): 싱크 가사 2곡 ("나는 일어섭니다", "내 모습 이대로").
- syncedlyrics 라이브러리: NetEase 1곡, Musixmatch·Megalobiz 0곡.
- 한국 CCM은 공개 가사 DB에 적다. 처음엔 가사 붙는 곡이 적다는 걸 화면이 자연스럽게 받아야 한다.

그래서 출처는 LRCLIB 하나로 시작한다. NetEase는 붙이지 않는다 (1곡 늘자고 의존성 추가하지 않음). 나중에 넓힐 때 `lyrics_search` 한 곳만 고치면 되게 둔다.

## 구성

```
봇이 곡을 받음 ─▶ lyrics_search(제목·가수·길이) ─▶ LRCLIB
        │                        │
        ▼                        ▼
   tracks 저장            track_lyrics 저장 (찾음 / 없음)
                                 │
미니앱 플레이어 ◀─ GET /lyrics/:id ┘
   "다른 가사 찾기" ─▶ GET /lyrics/:id/candidates ─▶ (Edge Function이 LRCLIB 검색)
   후보 고름 ─▶ PUT /lyrics/:id {lrclib_id}
   ± 조절 ─▶ PUT /lyrics/:id/offset {offset_ms}
```

### 1. DB: `007_track_lyrics.sql`

`loopbot`과 `loopbot_test` 두 스키마에 같은 표를 만든다.

```sql
create table if not exists loopbot.track_lyrics (
  track_id   bigint primary key references loopbot.tracks (id) on delete cascade,
  status     text not null check (status in ('found', 'none')),
  source     text,            -- 'lrclib'
  source_id  bigint,          -- LRCLIB 레코드 id
  synced     text,            -- LRC 원문 ([mm:ss.xx] 줄)
  offset_ms  integer not null default 0,
  searched_at timestamptz not null default now()
);
```

- `none`은 "찾아봤는데 없음"이다. 다시 찾지 않게 기억한다.
- 행이 없으면 "아직 안 찾음"이다.
- 기존 표와 같은 RLS 정책을 붙인다.

### 2. 봇 (파이썬)

- 새 파일 `loopbot/lyrics.py`
  - `clean_title(title: str, performer: str | None) -> str`: 유튜브 제목에서 가수 접두어("F.I.A - "), 괄호·대괄호 꼬리("(Official Video)", "[LIVE]"), "|"·" / " 뒤 영어 제목, "피아버전" 같은 표기를 걷어 낸다. 표로 테스트한다.
  - `search(title: str, artist: str | None, duration: int | None) -> Lyrics | None`: LRCLIB `/api/search`를 부르고, 싱크 가사가 있는 후보 중 길이 차이가 가장 작은 것을 고른다. 길이 차이가 15초를 넘으면 버린다. 시간 제한 8초, 실패하면 None (곡 받기를 막지 않는다).
  - User-Agent는 일반 이름(`loopbot (lyrics)`)만 쓴다.
- `youtube.py`의 `Audio`에 `artist`, `track` 필드를 더한다 (yt-dlp `info["artist"]`, `info["track"]`. 있으면 쓰고 없으면 None).
- `handlers._fetch_one`에서 곡을 저장한 뒤 `search`를 돌려 `store.save_lyrics(track_id, result)`로 저장한다. 음원 파일로 보낸 곡(`on_audio`)도 제목·길이로 같은 검색을 한다.
- 가사 검색 실패는 사용자에게 알리지 않는다. 곡 추가 메시지는 그대로다.

### 3. 기존 곡 채우기: `scripts/backfill_lyrics.py`

- `track_lyrics` 행이 없는 곡만 찾는다. 다시 돌려도 안전하다.
- `.env`의 DB 주소를 쓰고 화면에 찍지 않는다.
- 맥에서 한 번 돌린다 (봇을 돌리는 게 아니라 DB만 만진다).

### 4. Edge Function (`loopbot-api`)

| 요청 | 하는 일 | 권한 |
|---|---|---|
| `GET /lyrics/:id` | `{status, synced, offset_ms}` 또는 `{status: 'unknown'}` | 그 곡을 볼 수 있는 사람 (`readableFilter`) |
| `GET /lyrics/:id/candidates` | LRCLIB 검색 결과 중 싱크 있는 것 최대 8개: `{id, track, artist, duration}` | 곡 주인·관리자 |
| `PUT /lyrics/:id` `{lrclib_id}` | LRCLIB `/api/get/{id}`로 받아 저장, status=found | 곡 주인·관리자 |
| `PUT /lyrics/:id/offset` `{offset_ms}` | -30000..30000으로 자르고 저장 | 곡 주인·관리자 |

- 검색어는 `clean_title`과 같은 규칙의 TS 버전으로 만든다. 사용자가 고쳐서 다시 검색할 수 있게 `?q=`도 받는다.
- 바깥 요청은 8초 제한. 실패하면 502 `upstream`.

### 5. 미니앱

- 새 파일 `webapp/lrc.js` (순수 로직, 테스트 대상)
  - `parseLrc(text) -> [{t: 초, text}]`: `[mm:ss.xx]` 여러 개 붙은 줄, 빈 줄, 메타 태그(`[ar:]`) 처리. 시간순 정렬.
  - `lineAt(lines, position, offsetMs) -> index | -1`
- 새 파일 `webapp/player-lyrics.js` (화면)
  - 곡이 바뀌면 `GET /lyrics/:id`를 한 번 받아 캐시한다.
  - 찾음: `#player-hero` 자리에 가사 목록. 지금 줄은 진하게·크게, 나머지는 흐리게. 지금 줄이 가운데 오도록 부드럽게 스크롤 (reduced-motion이면 바로 이동). 줄을 누르면 그 시간으로 이동.
  - 위치는 재생 막대와 같은 화면 새로 고침 루프(`progressLoop`)에서 받는다.
  - 없음/아직: 지금처럼 제목을 크게 보여 준다.
  - 작은 줄: "싱크 −0.5 / +0.5", "다른 가사 찾기" (곡 주인·관리자만 보임).
  - "다른 가사 찾기"는 유리 시트: 검색어 칸(정리된 제목이 들어 있음) + 후보 목록(곡명·가수·길이). 고르면 저장하고 바로 보인다.
- `api.js`에 `lyrics(id)`, `lyricsCandidates(id, q)`, `chooseLyrics(id, lrclibId)`, `saveLyricsOffset(id, ms)`. `fake-api.js`에도 같은 것 (가짜 LRC 한 곡, 후보 2개).

## 하지 않는 것

- 가사 붙여넣기, 탭으로 맞추기, AI 받아쓰기·자동 맞춤
- 묵상·연습 탭에 가사 보이기
- NetEase 등 두 번째 출처
- 단어 단위(가라오케) 강조

## 오류와 빈 상태

- LRCLIB가 느리거나 죽어 있으면: 곡 추가는 그대로 되고 가사는 "아직"으로 남는다. 채우기 스크립트를 다시 돌리면 된다.
- 싱크 가사가 없는 후보만 있으면 고르지 않는다 (글만 있는 가사는 이번 범위 밖).
- 가사가 곡과 다르면 곡 주인이 "다른 가사 찾기"로 바꾼다. 후보가 없으면 "찾은 가사가 없어요"를 보여 준다.

## 테스트

- 파이썬: `clean_title` 표 테스트 (실제 라이브러리 제목 12개 모양), `search`의 후보 고르기(길이 차이·싱크 없음·15초 초과), LRCLIB 응답은 가짜로.
- TS: 새 경로 4개의 권한과 입력 검사 (`app_test.ts` 방식).
- 미니앱: `parseLrc`, `lineAt` 단위 테스트.
- 화면: 미리보기에서 가짜 가사로 줄 강조·스크롤·줄 누르기·싱크 조절 확인.

## 배포 순서

1. 마이그레이션 007 (두 스키마) — 되돌리기 어려운 DB 변경이라 실행 전에 승인받는다
2. Edge Function 배포
3. 봇 서버 배포
4. `backfill_lyrics.py` 한 번
5. 웹앱 배포 (stamp)

앞 단계가 없어도 뒤 단계가 깨지지 않게 한다: 미니앱은 `/lyrics`가 404면 제목만 보여 준다.
