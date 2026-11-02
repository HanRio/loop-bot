# loop-bot

유튜브 링크와 음원 파일을 라이브러리에 모으고, 플레이리스트를 여러 개 만들어 정한 순서대로 텔레그램 미니앱 플레이어에서 이어 재생하는 개인용 텔레그램 봇이에요.

## 사용법

- 링크나 음원 파일을 봇 채팅에 보내면 오디오가 채팅에 올라오고 **라이브러리**에 쌓여요. 지금 플레이리스트 끝에도 붙어요.
- 링크는 한 번에 여러 개 보내도 돼요. 줄바꿈이나 쉼표로 이어 붙여도 하나씩 받아요. 진행 상황은 메시지 하나가 바뀌며 보여주고, 끝나면 몇 곡을 넣었는지와 실패한 링크를 알려줘요.
- 왼쪽 아래 **메뉴 버튼**으로 플레이어를 열어요. 플레이어에서 라이브러리의 곡으로 플레이리스트를 만들고, 순서를 바꾸고, 곡을 지우고, 플레이리스트를 여러 개 관리해요. 저장한 플레이리스트가 지금 플레이리스트가 돼요.
- `/play`를 보내면 지금 플레이리스트의 곡이 순서대로 채팅에 오고, 첫 곡을 누르면 텔레그램 플레이어가 다음 곡으로 이어 재생해요. 플레이어는 왼쪽 아래 메뉴 버튼이나 채팅의 **🎵 플레이어 열기** 버튼으로 열어요.

명령어: `/start`(사용법 안내), `/list`(지금 플레이리스트 보기), `/play`(지금 플레이리스트를 채팅에 재생). 그룹에서는 플레이어 버튼이 동작하지 않아서, 그룹 안내 메시지의 링크 버튼으로 봇과의 개인 채팅을 열어 플레이어를 써요.

## 준비 (맥)

```bash
brew install ffmpeg deno
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
```

## `.env` 작성

```bash
cp .env.example .env
```

| 항목 | 값 |
|---|---|
| `BOT_TOKEN` | 텔레그램 @BotFather에서 `/newbot`으로 받은 토큰 |
| `ALLOWED_USER_IDS` | 내 텔레그램 user id (@userinfobot에서 확인). 여러 명이면 쉼표로 구분 |
| `WEBAPP_URL` | `https://hanrio.github.io/loop-bot/webapp/` |
| `YTDLP_COOKIES` | 선택. 유튜브가 막을 때 쓰는 cookies.txt 경로 |
| `DATABASE_URL` | 필수. Supabase 풀러 주소 (세션 모드, 포트 5432) |

`.env`는 git에 올라가지 않아요. 토큰과 비밀번호는 여기에만 넣으세요.

## 실행

```bash
. .venv/bin/activate
python -m loopbot
```

맥이 켜져 있고 이 명령이 실행 중일 때만 봇이 동작해요. 끄려면 `Ctrl+C`.

봇이 시작할 때 기본 메뉴 버튼을 `WEBAPP_URL`의 플레이어로 맞추고, 허용된 사용자 채팅에 따로 설정된 메뉴 버튼은 지워요. 메시지는 보내지 않아요.

## 저장소

저장은 Supabase(Postgres)에만 해요. `DATABASE_URL`이 없으면 봇이 시작하지 않아요. 봇을 다른 컴퓨터로 옮겨도 라이브러리와 플레이리스트가 그대로 남아요. 다운로드는 여전히 봇이 도는 컴퓨터에서 해요. Supabase에서는 yt-dlp를 돌릴 수 없어서 봇 자체를 대신할 수는 없어요.

### Supabase 구성

- 무료 요금제의 활성 프로젝트 한도 때문에 개인 도구용 `haru` 프로젝트 안에 넣었어요.
- 다른 앱과는 이렇게 분리돼요:
  - 전용 스키마 `loopbot` (테스트용 `loopbot_test`)
  - 전용 로그인 역할 `loopbot_app`. 이 두 스키마에만 권한이 있어요.
  - 모든 테이블에 RLS를 켜고, 정책은 `loopbot_app`에만 줬어요.
  - API(PostgREST)에 노출되지 않는 스키마라 anon 키로는 보이지 않아요.
- 스키마는 [`supabase/migrations/`](supabase/migrations/) 아래 파일이에요. `001`이 본 스키마, `002`가 테스트 스키마, `003`이 재생 메시지 기록이에요.
- 접속 주소는 세션 모드 풀러(포트 5432)를 써요. 형식은 `postgresql://loopbot_app.<프로젝트 ref>:<비밀번호>@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres`예요. 트랜잭션 모드(6543)에서는 동작하지 않아요.

### 미니앱 함수 (`loopbot-api`)

플레이어가 쓰는 함수는 [`supabase/functions/loopbot-api/`](supabase/functions/loopbot-api/)에 있어요. 텔레그램 `initData`의 서명을 함수가 직접 확인하고, 허용된 사용자만 자기 라이브러리를 읽고 바꿀 수 있어요. 그래서 배포할 때 JWT 검사(`--no-verify-jwt`)는 끄고 `initData` 검사는 함수가 해요.

```bash
supabase functions deploy loopbot-api --no-verify-jwt --use-api --project-ref <ref>
```

함수가 읽는 비밀값(Supabase 프로젝트의 secrets)은 이 이름들이에요. 값은 Supabase에만 넣고 저장소에는 쓰지 않아요.

| 이름 | 내용 |
|---|---|
| `LOOPBOT_BOT_TOKEN` | 봇 토큰. `initData` 서명 검사에 써요 |
| `LOOPBOT_ALLOWED_USER_IDS` | 허용된 텔레그램 user id. 쉼표로 구분 |
| `LOOPBOT_DATABASE_URL` | 위의 세션 모드 풀러 주소 (`loopbot_app` 역할) |
| `LOOPBOT_DB_SCHEMA` | 선택. 기본값 `loopbot` |

비밀값이 없으면 함수가 시작할 때 실패해요.

## 제한

- 영상 길이 최대 60분 (음질에 따라 약 50분 넘으면 49MB를 넘을 수 있어요), 파일 최대 49MB
- 음원은 파일이 아니라 음원(mp3·m4a)으로 보내야 해요
- 한 번에 링크 최대 10개
- 재생목록 링크와 라이브 방송은 받지 않아요
- 20MB가 넘는 곡(대략 40분 초과)은 플레이어에서 재생할 수 없어 채팅에서 `/play`로 들어요.
- Supabase 무료 전송량은 한 달 5GB이고 haru와 나눠 써요. 곡당 5MB면 약 1,000곡을 새로 받는 양이에요. 한 번 받은 곡은 휴대폰에 남아 다시 받지 않아요.

## 유튜브가 막을 때

"유튜브가 서버 접근을 막았어요 (쿠키 필요)"가 나오면, 브라우저 확장(예: Get cookies.txt LOCALLY)으로 youtube.com 쿠키를 `cookies.txt`로 내보내고 `.env`의 `YTDLP_COOKIES`에 그 파일 경로를 넣은 뒤 봇을 다시 실행하세요.

## 플레이어 시험 (로컬)

`webapp/`을 `localhost`에서 열면 가짜 API(`webapp/fake-api.js`)와 5초짜리 시험음(`webapp/fake-audio.mp3`)으로 화면을 시험할 수 있어요. `?fail=too_big`, `?fail=expired`, `?fail=save`로 오류 화면도 볼 수 있어요.

## 테스트

```bash
set -a; . ./.env; set +a
pytest
node --test 'tests/webapp/*.test.mjs'
deno test --config supabase/functions/loopbot-api/deno.json --allow-env --allow-net --allow-read supabase/functions/loopbot-api/
```

저장소 테스트는 `LOOPBOT_TEST_DATABASE_URL`이 있을 때만 돌아요. 없으면 건너뛰어요. 테스트는 Supabase의 `loopbot_test` 스키마만 써요.
