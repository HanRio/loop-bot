# 미니앱 뮤직 플레이어

날짜: 2026-11-02

## 목표

플레이리스트에 있는 곡만 미니앱 안에서 재생한다. 텔레그램 기본 플레이어는 채팅방의 모든 오디오를 대기열로 잡아서 원하지 않는 곡까지 재생하기 때문이다. 화면을 꺼도 재생되는 것은 휴대폰에서 곡 하나로 확인했다.

성공 기준:

- 화면을 끈 채 플레이리스트가 다음 곡으로 이어지고 반복된다.
- 잠금화면과 이어폰으로 재생/일시정지, 이전/다음, 위치 이동을 할 수 있다.
- 재생을 멈추지 않고 목록을 편집할 수 있고, 미니앱이 닫히지 않는다.

범위 밖: 셔플, 받은 곡 정리 기능, 20MB 초과 곡의 미니앱 재생, 그룹에서 미니앱 열기, 미니앱에서 링크 추가.

## 구조

| 부품 | 하는 일 |
|---|---|
| 봇 (`loopbot/`) | 링크·음원을 받아 라이브러리에 저장한다. 채팅 재생 `/play`와 그룹 안내를 유지한다. |
| Supabase 함수 `loopbot-api` (`supabase/functions/loopbot-api/`) | 사용자를 확인하고, 목록을 읽고 쓰고, 곡 파일을 전달한다. |
| 미니앱 (`webapp/`) | 플레이어 화면, 재생, 곡 파일 캐시. |

음원은 텔레그램에만 둔다. Supabase Storage는 쓰지 않는다.

플레이어는 **메뉴 버튼이나 인라인 `web_app` 버튼**으로 연다. 키보드 버튼으로 연 미니앱은 `initData`가 비어 있어(문서 요약 기준, 1단계에서 실제 확인) 함수 인증을 할 수 없다. 대신 이렇게 열면 `sendData`를 쓸 수 없으므로 미니앱은 봇에 데이터를 보내지 않는다. 링크는 채팅에 붙여넣고, 긴 곡은 채팅에서 `/play`로 듣는다.

## 함수 API

기본 주소는 `https://<ref>.supabase.co/functions/v1/loopbot-api`. 응답은 JSON이고 곡 파일만 오디오 바이트다.

모든 요청은 `X-Telegram-Init-Data` 헤더에 `Telegram.WebApp.initData`를 담는다. Supabase의 JWT 검사는 끈다(`--no-verify-jwt`). 인증은 이 헤더로만 한다.

| 요청 | 본문 | 응답 |
|---|---|---|
| `GET /state` | | `{library: [{id, title, duration}], playlists: [{id, name, track_ids}], active_id}` |
| `POST /playlists` | `{name, track_ids}` | 만든 playlist. 활성이 된다. |
| `PUT /playlists/:id` | `{name, track_ids}` | 저장한 playlist. 활성이 된다. |
| `DELETE /playlists/:id` | | `{active_id}` |
| `PUT /active` | `{playlist_id}` | `{active_id}` |
| `DELETE /tracks/:id` | | `204` |
| `GET /tracks/:id/file` | | 오디오 바이트 |

규칙은 지금 `Store`와 같다:

- 플레이리스트가 하나도 없으면 `기본`을 만든다.
- 남의 곡·없는 곡 id는 무시하고, 중복은 첫 번째만 남긴다.
- 활성 목록을 지우면 남은 것 중 가장 최근 것이 활성이 된다.
- 이름은 앞뒤 공백을 지우고 20자로 자른다. 비면 `새 플레이리스트`.

오류 응답은 `{error: <code>}`이다.

| 상태 | code | 뜻 |
|---|---|---|
| 401 | `expired` | 서명 없음·위조·24시간 초과 |
| 403 | `forbidden` | 허용되지 않은 사용자 |
| 400 | `bad_request` | 본문 형식 오류 |
| 404 | `not_found` | 없는 곡·목록, 남의 곡·목록 |
| 413 | `too_big` | 텔레그램이 getFile을 거부한 20MB 초과 파일 |
| 502 | `upstream` | 텔레그램·DB 실패 |

## 보안

- initData 서명을 텔레그램 규칙대로 검사한다. 키는 `HMAC_SHA256("WebAppData", bot_token)`, 비교는 상수 시간으로 한다. `auth_date`가 24시간을 넘으면 거부한다.
- `user_id`는 검증한 initData에서만 얻는다. 요청 본문의 사용자 값은 받지 않는다.
- 비밀값은 Supabase 함수 비밀값에만 둔다: `LOOPBOT_BOT_TOKEN`, `LOOPBOT_ALLOWED_USER_IDS`, `LOOPBOT_DATABASE_URL`.
- 곡 파일은 함수가 스트림으로 넘긴다. 토큰이 든 텔레그램 주소는 응답·로그에 남기지 않는다.
- CORS는 `https://hanrio.github.io`만 허용한다.
- DB는 `loopbot_app` 역할로 접속하고 스키마는 `loopbot`만 쓴다. 테스트는 스키마 이름을 설정으로 바꿔 `loopbot_test`를 쓴다.
- haru의 다른 함수와 DB 객체는 건드리지 않는다.

## 플레이어

화면, 위에서 아래로:

1. 플레이리스트 선택. `+ 새 플레이리스트`를 고르면 이름을 받아 바로 만든다.
2. 재생 순서. 누르면 그 곡부터 재생, 재생 중인 곡 강조, ≡ 드래그(SortableJS), ✕ 빼기.
3. 라이브러리. ＋ 넣기, 🗑 삭제(확인 후).
4. `목록 삭제`와 안내 한 줄: "링크는 채팅에 붙여넣으면 추가돼요. 긴 곡은 채팅에서 /play로 들어요".
5. 화면 아래 고정 재생 바. 제목, 진행 바(끌어서 이동), 시간, ⏮ ⏯ ⏭ 🔁.

재생 상태:

```js
{
  playingPlaylistId, // 보고 있는 목록과 다를 수 있다
  currentTrackId,    // 목록에서 빠져도 끝까지 재생한다
  lastIndex,         // currentTrackId가 빠졌을 때 다음 곡 기준
  repeat,            // "all" | "one" | "off", 기본 "all"
  unplayable,        // too_big으로 확인한 곡 id 집합
}
```

다음 곡 계산은 화면과 떼어 순수 함수로 둔다: `nextTrack(trackIds, currentId, lastIndex, repeat, unplayable)`와 `prevTrack(...)`.

- 지금 곡이 목록에 있으면 그 위치 다음, 없으면 `lastIndex` 자리의 곡.
- `one`: 곡이 끝나면 같은 곡. ⏭·⏮는 `all`처럼 움직인다.
- `off`: 마지막 곡 다음은 `null`이고 재생을 멈춘다.
- 재생할 수 있는 곡이 없으면 `null`.

재생:

- `<audio>` 요소 하나를 계속 쓰고 `src`만 바꾼다. 화면이 꺼진 상태에서 넘어가려면 필요하다.
- 곡 파일은 `fetch`로 받아 Cache Storage에 곡 id 키로 저장하고 Blob URL로 재생한다. `file_id`는 곡마다 바뀌지 않아 캐시 갱신은 필요 없다. 곡을 삭제하면 캐시도 지운다.
- 지금 곡이 재생되기 시작하면 다음 곡을 미리 받는다.
- Cache Storage를 쓸 수 없으면 캐시 없이 재생한다.
- Media Session으로 제목, `play`, `pause`, `previoustrack`, `nexttrack`, `seekto`, 위치를 연결한다.
- 🔁와 마지막으로 본 플레이리스트는 `localStorage`에 둔다. 읽고 쓰기는 try/catch로 감싼다. 재생은 자동으로 시작하지 않는다.

저장과 동기화:

- 편집은 화면에 먼저 반영하고 0.5초 뒤 저장한다. 한 번에 요청 하나만 보내고, 그동안 바뀐 내용은 끝난 뒤 최신 상태로 한 번 더 보낸다.
- 저장에 실패하면 위쪽에 알리고, 편집 내용을 유지한 채 다시 시도한다.
- 플레이리스트를 고르면 `PUT /active`를 보낸다. 봇이 받은 새 곡은 이 활성 목록에 붙는다.
- 미니앱으로 돌아오면(`visibilitychange`) `GET /state`로 새로 불러온다. 저장 대기 중인 편집이 있으면 먼저 저장한다.

오류 표시:

| 상황 | 동작 |
|---|---|
| `expired` | "미니앱을 다시 열어주세요". 받아 둔 곡은 계속 재생 |
| `too_big` | "채팅 재생만 가능"으로 흐리게 표시, `unplayable`에 넣고 건너뜀 |
| 곡 받기 실패 | "받지 못했어요", 다음 곡으로. 연속으로 전부 실패하면 멈춤 |
| 재생할 곡 없음 | 재생을 멈추고 안내 |

## 봇 변경

- 시작할 때 메뉴 버튼을 `WEBAPP_URL`의 미니앱으로 설정한다. 메시지는 보내지 않는다(재시작할 때마다 오던 안내 메시지를 없앤다).
- 개인 채팅 답장의 버튼은 키보드 대신 인라인 `web_app` 버튼으로 바꾼다. 그룹은 지금처럼 개인 채팅을 여는 링크 버튼이다.
- 전환할 때 한 번만 `ReplyKeyboardRemove` 메시지를 보내 옛 키보드를 치운다.
- `build_webapp_url`, `parse_action`, `on_web_app_data`를 지운다.
- `DATABASE_URL`을 필수로 한다. 미니앱이 Supabase만 읽으므로 SQLite로는 동작하지 않는다. `SqliteStore`, `DB_PATH`, 옛 DB 이전 코드, `scripts/sqlite_to_postgres.py`, `scripts/e2e_batch.py`의 SQLite 사용을 지운다. 저장소 테스트는 `loopbot_test`로 돌린다.
- 봇이 더 쓰지 않는 저장소 메서드(`save_playlist`, `delete_playlist`, `delete_tracks`, `playlists`)와 시험 페이지(`bgtest.html`, `bgtest.mp3`)를 지운다.
- 채팅방 정리(재생 묶음·업로드 메시지 삭제)는 유지한다.

## 제한

- Supabase 무료 전송량은 한 달 5GB이고 haru와 나눠 쓴다. 곡당 5MB면 약 1,000곡을 새로 받는 양이다.
- 20MB 초과 곡(대략 40분 초과)은 채팅 재생만 된다.
- 휴대폰이 저장 공간을 비우면 받아 둔 곡이 지워질 수 있다. 다시 받는다.

## 순서와 확인

각 단계는 확인을 통과해야 다음으로 간다.

1. **시험.** 메뉴 버튼으로 시험 페이지를 연다. `initData`가 메뉴 버튼에서 차 있는지, 곡 두 개가 Blob URL로 화면을 끈 채 이어 재생되는지 사용자가 휴대폰에서 확인한다. 안 되면 멈추고 설계를 다시 본다.
2. **함수.** Deno 테스트로 서명 검사(정상, 위조, 만료, 비허용 사용자), 목록 규칙, 남의 곡 접근 거부를 `loopbot_test`에 돌린다. haru에 배포하고 실제 텔레그램 파일 한 곡을 받아 본다. 기존 기능에 영향이 없는 추가 작업이다.
3. **플레이어.** `nextTrack`·`prevTrack` 테스트. 브라우저에서 375px로 재생, 편집, 오류 표시를 가짜 API로 확인한다. 배포 전까지 새 페이지(`webapp/player/`)에서 만들어 기존 미니앱은 그대로 둔다.
4. **전환.** 사용자 승인 후 진행한다. 새 화면을 `webapp/index.html`로 옮기고 봇 변경과 삭제를 적용해 함께 배포한다.
5. **휴대폰 최종 확인.** 화면 끈 재생, 잠금화면 조작, 재생 중 편집, 링크 추가 후 목록 갱신. 사용자가 확인한다.
