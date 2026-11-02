# 미니앱 뮤직 플레이어 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 플레이리스트의 곡만 미니앱 안에서 재생하고, 화면을 꺼도 이어지며, 재생 중에 목록을 편집할 수 있게 한다.

**Architecture:** Supabase Edge Function `loopbot-api`가 Telegram initData로 사용자를 확인하고 목록 API와 곡 파일 전달을 맡는다. 미니앱은 정적 페이지이며 곡을 Cache Storage에 저장해 하나의 `<audio>`로 재생한다. 봇은 곡을 받아 저장하는 일과 채팅 `/play`만 남는다.

**Tech Stack:** Deno + TypeScript + `npm:postgres@3.4.5`, 바닐라 JS ES 모듈 + SortableJS 1.15.6, `node --test`, Python 3 + python-telegram-bot 22 + psycopg 3.

**Spec:** `docs/superpowers/specs/2026-11-02-miniapp-player-design.md`

## Global Constraints

- 비밀값은 출력·커밋·로그 금지. `.env` 내용을 출력하지 않는다. 텔레그램 파일 주소(토큰 포함)를 응답·로그에 남기지 않는다.
- 함수 비밀값 이름: `LOOPBOT_BOT_TOKEN`, `LOOPBOT_ALLOWED_USER_IDS`, `LOOPBOT_DATABASE_URL`. 선택: `LOOPBOT_DB_SCHEMA`(기본 `loopbot`).
- 테스트와 시험은 스키마 `loopbot_test`만 쓴다. 실제 `loopbot` 데이터를 바꾸는 테스트 금지.
- CORS 허용 출처는 `https://hanrio.github.io`만.
- 사용자에게 보이는 글은 한국어 `-요`체. 스펙의 문구를 그대로 쓴다.
- 커밋 형식 `<type>: <설명>`, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. 태스크마다 커밋하되 푸시는 지시가 있을 때만.
- 주석은 코드가 보여주지 못하는 이유만 쓴다.

## Review Focus

- 재생 중인 곡을 목록에서 빼거나 라이브러리에서 지웠을 때: 끝까지 재생하고 그 자리의 다음 곡으로 넘어간다. (Task 4)
- 목록의 모든 곡이 재생 불가이거나 목록이 비었을 때: 무한 루프 없이 멈춘다. (Task 4)
- 저장 요청이 진행 중일 때 또 편집하거나, 저장 대기 중에 미니앱으로 돌아와 목록을 다시 받을 때: 사용자의 최신 편집이 이긴다. (Task 4)
- initData에 한글 이름과 `signature` 필드가 있을 때: URL 인코딩을 푼 값으로 정확히 검증한다. (Task 2)
- 곡을 지운 뒤 다른 플레이리스트: 어디에도 남지 않고, 남의 곡·목록 id는 404이며 내용이 새지 않는다. (Task 2)

---

### Task 1: 시험 (메뉴 버튼 initData + 이어 재생)

코디네이터가 직접 수행한다. 버릴 코드다. 사용자 확인을 통과해야 Task 2로 간다.

**Files:**
- Modify: `webapp/bgtest.html`
- Create: `webapp/bgtest2.mp3` (ffmpeg로 880Hz, 60초). `webapp/bgtest.mp3`를 60초로 다시 만든다.

- [ ] **Step 1:** 페이지에 `initData 길이`를 표시한다. 곡 A, B를 `fetch` → Blob URL로 받아 `<audio>` 하나로 재생하고, `ended`에서 `src`를 바꿔 A → B → A로 반복한다. 전환 시각과 `visibilityState`를 기록해 돌아왔을 때 "화면을 끈 동안 N번 넘어감"을 보여준다.
- [ ] **Step 2:** 커밋·푸시 후 Pages 배포 확인. 일회성 호출로 메뉴 버튼을 시험 페이지로 설정한다(`setChatMenuButton`, 비밀값 출력 금지). 키보드 버튼을 지우지 않는다.
- [ ] **Step 3:** 사용자가 휴대폰에서 확인한다.
  - 메뉴 버튼으로 열었을 때 `initData 길이 > 0`. 기존 🎵 키보드 버튼으로 연 값도 기록한다.
  - 화면을 끄고 1분 이상 기다렸을 때 곡이 넘어간다.
  - 실패하면 멈추고 사용자와 설계를 다시 본다.

### Task 2: 함수 인증과 목록 API

**Files:**
- Create: `supabase/functions/loopbot-api/auth.ts`, `db.ts`, `app.ts`, `index.ts`, `deno.json`
- Test: `supabase/functions/loopbot-api/auth_test.ts`, `app_test.ts`

**Interfaces — Produces:**
```ts
// auth.ts
verifyInitData(initData: string, botToken: string, nowSec: number, maxAgeSec?: number): Promise<number | null> // user id. 기본 86400
// db.ts (모든 함수는 sql.begin 안에서 select set_config('search_path', schema, true) 후 실행)
createDb(dsn: string, schema: string): Db   // postgres(dsn, {max: 1, prepare: false}), bigint는 number로 파싱
interface Playlist { id: number; name: string; track_ids: number[] }
interface Db {
  state(userId): Promise<{library: {id: number; title: string; duration: number | null}[]; playlists: Playlist[]; active_id: number}>
  createPlaylist(userId, name: string, trackIds: number[]): Promise<Playlist>
  savePlaylist(userId, id: number, name: string, trackIds: number[]): Promise<Playlist | null>
  deletePlaylist(userId, id: number): Promise<number | null>  // 새 active_id, 없는 목록이면 null
  setActive(userId, id: number): Promise<number | null>
  deleteTrack(userId, id: number): Promise<boolean>
  fileId(userId, id: number): Promise<string | null>
  close(): Promise<void>
}
// app.ts
interface Deps { botToken: string; allowed: Set<number>; db: Db; fetch: typeof fetch; now(): number }
handle(req: Request, deps: Deps): Promise<Response>
```
경로는 스펙의 API 표대로이며 함수 이름 뒤의 경로로 매칭한다(`/loopbot-api/state`와 `/state` 모두). 활성 선택 규칙은 `loopbot/store/postgres.py`의 `_active_id`, 곡 필터링은 `save_playlist`를 그대로 옮긴다. PUT의 남의 목록은 404다.

- [ ] **Step 1: `auth_test.ts`를 쓴다.** 테스트 안에서 스펙 규칙대로 서명해 만든다. 검사: 정상 → user id, `hash` 변조 → null, 값 변조 → null, `auth_date`가 25시간 전 → null, 빈 문자열 → null, `user`에 `"first_name":"하늘"`과 `signature=abc` 필드가 있어도 정상 통과.
- [ ] **Step 2: 실패 확인.** `deno test --allow-env --allow-net supabase/functions/loopbot-api/auth_test.ts`
- [ ] **Step 3: `auth.ts` 구현.** 데이터 검사 문자열은 `hash`만 뺀 모든 필드를 키 순으로 `key=value`(디코딩 값), `\n`으로 잇는다. `secret = HMAC_SHA256(key="WebAppData", msg=botToken)`, `hash = hex(HMAC_SHA256(key=secret, msg=data_check_string))`. Web Crypto `crypto.subtle.verify`로 비교한다(상수 시간).
- [ ] **Step 4: `app_test.ts`를 쓴다.** `LOOPBOT_TEST_DATABASE_URL`로 실제 `loopbot_test`에 접속한다. 없으면 실패가 아니라 `ignore`. 시작 시 테스트 사용자 id(900001, 900002)의 행을 지운다. 곡은 SQL로 넣는다. 검사:
  - 서명 없음 401 `expired`, 비허용 사용자 403 `forbidden`.
  - `GET /state` 새 사용자는 `기본`이 생기고 active. id가 `typeof number`.
  - `POST /playlists`: 이름 공백 제거, 21자 → 20자, 빈 이름 → `새 플레이리스트`, 활성이 된다. 없는 곡·남의 곡 id 무시, 중복은 첫 번째만.
  - `PUT /playlists/:id`: 순서 유지. 남의 목록 404, 내용을 바꾸지 않음.
  - `track_ids`가 배열이 아니거나 `true`가 있으면 400 `bad_request`.
  - `DELETE /playlists/:id`: 활성을 지우면 남은 것 중 id 최대가 `active_id`. 마지막을 지우면 `기본`이 다시 생긴다.
  - `DELETE /tracks/:id`: 모든 플레이리스트에서 빠진다. 남의 곡 404.
  - `OPTIONS` 응답의 `Access-Control-Allow-Origin`이 `https://hanrio.github.io`, 허용 헤더에 `x-telegram-init-data`.
- [ ] **Step 5: 실패 확인 후 `db.ts`, `app.ts`, `index.ts` 구현.** `index.ts`는 비밀값을 읽어 `Deno.serve`만 한다. 빠진 비밀값은 시작 때 오류다. 예외는 502 `upstream`으로 답하고 메시지만 로그에 남긴다.
- [ ] **Step 6: 통과 확인.** `set -a; . ./.env; set +a; deno test --allow-env --allow-net supabase/functions/loopbot-api/` (값을 출력하지 말 것)
- [ ] **Step 7: 커밋.** `feat: 플레이어 API 함수 (인증, 목록)`

### Task 3: 곡 파일 전달과 배포

**Files:**
- Modify: `supabase/functions/loopbot-api/app.ts`, `app_test.ts`

- [ ] **Step 1: 테스트 추가.** `deps.fetch`를 가짜로 넣는다.
  - 정상: 응답 본문이 파일 바이트, `Content-Type: audio/mp4`, `Cache-Control: private, max-age=31536000`, CORS 헤더.
  - getFile 400에 `file is too big` → 413 `too_big`.
  - 다른 getFile 실패 → 502 `upstream`.
  - 남의 곡 404, 그리고 fetch를 호출하지 않음.
  - 어떤 오류 응답 본문에도 봇 토큰이 없음.
- [ ] **Step 2: 실패 확인 후 `GET /tracks/:id/file` 구현.** `getFile` 후 파일 주소를 `fetch`해 `body`를 그대로 넘긴다. `Content-Length`가 있으면 전달한다.
- [ ] **Step 3: 통과 확인 후 커밋.** `feat: 곡 파일 전달`
- [ ] **Step 4: 코디네이터가 배포한다.** `.env`의 `BOT_TOKEN`, `ALLOWED_USER_IDS`, `DATABASE_URL`을 비밀값 이름으로 바꾼 임시 파일(스크래치패드, chmod 600)로 `supabase secrets set --env-file`을 실행하고 파일을 지운다. `supabase functions deploy loopbot-api --no-verify-jwt --project-ref <ref>`. haru의 기존 함수 목록이 그대로인지 확인한다.
- [ ] **Step 5: 실제 확인.** 서명 없는 `GET /state`가 401. 테스트에서 서명한 initData로 `GET /state`와 실제 곡 하나의 `/file`을 받아 크기가 0보다 큰지 본다. 실제 `loopbot` 데이터를 읽기만 한다.

### Task 4: 재생 순서와 저장 로직

**Files:**
- Create: `webapp/player/queue.js`, `webapp/player/saver.js`
- Test: `tests/webapp/queue.test.mjs`, `tests/webapp/saver.test.mjs`

**Interfaces — Produces:**
```js
// queue.js
export function nextTrack({trackIds, currentId, lastIndex, repeat, unplayable, manual}) // → id | null. manual은 ⏭·⏮ 입력
export function prevTrack({trackIds, currentId, lastIndex, unplayable})                 // → id | null
// saver.js
export function createSaver(save /* async (value) */, {delayMs = 500, onError, onSaved, setTimer, clearTimer}) 
// → {update(value), flush(): Promise<void>, pending(): boolean}
```

- [ ] **Step 1: 테스트 작성.** 실행: `node --test tests/webapp/`
  - `nextTrack`: `[1,2,3]` 현재 1 → 2. 3에서 `all` → 1. 3에서 `off` → null. `one` 자동 → 같은 곡, `one` + `manual` → 다음 곡.
  - 현재 2를 뺀 `[1,3]`, `lastIndex: 1` → 3. 마지막 곡을 뺀 `[1,2]`, `lastIndex: 2`, `all` → 1, `off` → null.
  - `unplayable: Set([2])`이면 1 → 3. 전부 재생 불가 → null. `[]` → null. 재생 불가 하나만 남은 `one` → null.
  - `prevTrack`: 처음에서 → 마지막. 빠진 곡이면 `lastIndex - 1` 자리.
  - `createSaver`: 0.5초 안의 여러 `update`는 저장 한 번(마지막 값). 저장 중 `update`는 끝난 뒤 최신 값으로 한 번 더. 실패하면 `onError` 호출 후 값을 유지하고 3초 뒤 다시 시도. `flush`는 대기 중인 값을 저장하고 끝날 때까지 기다린다.
- [ ] **Step 2: 실패 확인, 구현, 통과 확인.**
- [ ] **Step 3: 커밋.** `feat: 플레이어 재생 순서와 자동 저장 로직`

### Task 5: 플레이어 화면

**Files:**
- Create: `webapp/player/index.html`, `app.js`, `api.js`, `audio.js`, `fake-api.js`

**Interfaces — Consumes:** Task 2의 API, Task 4의 함수. **Produces:**
```js
// api.js
export class ApiError extends Error { code /* "expired" | "too_big" | ... */ }
export function createApi(baseUrl, initData) // → {state(), createPlaylist(name, ids), savePlaylist(id, name, ids), deletePlaylist(id), setActive(id), deleteTrack(id), file(id): Promise<Blob>}
// audio.js: <audio> 하나, Cache Storage('loopbot-tracks'), Media Session
export function createPlayer({api, onChange, onTrackEnd, onError}) 
// → {play(track), toggle(), seek(sec), prefetch(trackId), forget(trackId), position(), duration(), isPlaying()}
```

- [ ] **Step 1: 구현.** 화면, 재생 상태, 저장, 오류 표시는 스펙의 "플레이어" 절 그대로다. 기존 `webapp/index.html`의 CSS 변수와 행 구조를 재사용한다. 터치 영역은 44px 이상. 재생 바가 목록을 가리지 않게 `body`에 아래 여백을 둔다. `textContent`만 쓰고 `innerHTML`은 쓰지 않는다.
  - `fake-api.js`는 `location.hostname === "localhost"`일 때만 동적으로 불러온다. 메모리 안 곡 5개, `?fail=too_big`·`?fail=expired`·`?fail=save` 시나리오, 파일은 `../bgtest.mp3`.
  - 실제 함수 주소는 `app.js` 상수로 둔다(공개 값).
  - `initData`가 비어 있으면 API를 부르지 않고 "메뉴 버튼으로 다시 열어주세요"를 보여준다(localhost 제외).
- [ ] **Step 2: 코디네이터가 브라우저에서 375px로 확인한다.** `localhost`에서: 곡 재생과 자동 다음 곡, ⏮ ⏭ 🔁, 진행 바 이동, 재생 중 드래그·빼기·넣기, 재생 중 지금 곡 빼기, 다른 목록 보기 중 재생 유지, 새 목록 만들기, 저장 실패 표시 후 복구, `too_big` 건너뛰기, `expired` 안내, 콘솔 오류 없음, 스크린샷.
- [ ] **Step 3: 커밋.** `feat: 미니앱 플레이어 화면`

### Task 6: 전환

**시작 전에 코디네이터가 사용자 승인을 받는다.** 승인 후 한 번에 적용한다.

**Files:**
- Move: `webapp/player/*` → `webapp/` (기존 `webapp/index.html`을 대체). 경로·테스트 import 수정. `tests/webapp/` 유지.
- Delete: `webapp/player/fake-api.js`는 지우지 않고 `webapp/fake-api.js`로 옮긴다(localhost 전용). `webapp/bgtest*`는 지우고 fake 파일은 작은 시험음 `webapp/fake-audio.mp3`(5초)를 쓴다.
- Modify: `loopbot/handlers.py`, `loopbot/payload.py`, `loopbot/config.py`, `loopbot/store/__init__.py`, `loopbot/store/postgres.py`, `README.md`, `.env.example`, `scripts/e2e_batch.py`
- Delete: `loopbot/store/sqlite.py`, `scripts/sqlite_to_postgres.py`, `scripts/e2e_webapp.py`, `tests/test_sqlite_to_postgres.py`
- Test: `tests/test_handlers.py`, `tests/test_batch.py`, `tests/test_payload.py`, `tests/test_store_contract.py`, `tests/test_config.py`

- [ ] **Step 1: 테스트를 고친다.**
  - `load_config`: `DATABASE_URL`이 없으면 `ValueError`. `Config`에 `db_path` 없음.
  - `_markup`: 개인 채팅은 `InlineKeyboardMarkup`의 `web_app.url == cfg.webapp_url`. 그룹은 지금 테스트 유지.
  - `build_app`의 `post_init`이 `set_chat_menu_button(menu_button=MenuButtonWebApp("🎵 플레이어", WebAppInfo(cfg.webapp_url)))`를 호출하고 `send_message`는 호출하지 않는다.
  - `test_refresh_keyboards_*`, `build_webapp_url`, `parse_action`, `on_web_app_data` 테스트를 지운다. `extract_youtube_urls` 테스트는 유지한다.
  - 저장소 테스트는 Postgres만 돌리고 남는 메서드(`add_track`, `library`, `active_playlist`, `play_messages`, `set_play_messages`)만 검사한다. `LOOPBOT_TEST_DATABASE_URL`이 없으면 건너뛴다.
- [ ] **Step 2: 실패 확인 후 구현.** 스펙의 "봇 변경" 절대로 지운다. `_keyboard` 대신 `_markup(context, chat)`이고, `_reply`·`_send`의 `user_id` 인자는 필요 없으면 없앤다. `open_store`는 `PostgresStore(cfg.database_url)`만 만든다. 안 쓰게 된 상수와 import를 지운다. README는 사용법(메뉴 버튼, 링크는 채팅, `/play`), Supabase 함수와 비밀값, 제한을 현재 동작으로 다시 쓴다.
- [ ] **Step 3: 전체 통과 확인.** `set -a; . ./.env; set +a; .venv/bin/pytest -q`, `node --test tests/webapp/`, `deno test --allow-env --allow-net supabase/functions/loopbot-api/`. 각 출력의 통과 수를 보고한다.
- [ ] **Step 4: 커밋.** `feat: 미니앱을 플레이어로 전환`
- [ ] **Step 5: 코디네이터가 배포한다.** 푸시, Pages 확인, 봇 재시작(터미널 탭). 일회성 호출로 허용 사용자에게 "🎵 플레이어는 왼쪽 아래 메뉴 버튼으로 열어요" + `ReplyKeyboardRemove`를 한 번 보낸다.

### Task 7: 휴대폰 최종 확인

코디네이터가 항목을 안내하고 사용자가 확인한다. 고칠 것이 나오면 Task를 추가한다.

- [ ] 메뉴 버튼으로 열면 라이브러리와 플레이리스트가 보인다.
- [ ] 화면을 끈 채 다음 곡으로 넘어가고 전체 반복이 돈다.
- [ ] 잠금화면·이어폰으로 재생/일시정지, 이전/다음.
- [ ] 재생 중 드래그, 빼기, 넣기에도 끊기지 않고, 닫았다 열어도 저장돼 있다.
- [ ] 채팅에 링크를 붙여넣고 돌아오면 새 곡이 지금 목록에 보인다.
- [ ] 다시 열 때 두 번째 재생부터 곡이 바로 나온다(캐시).
