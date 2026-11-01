# loop-bot

유튜브 링크와 음원 파일을 라이브러리에 모으고, 플레이리스트를 여러 개 만들어 정한 순서대로 텔레그램 플레이어에서 이어 재생하는 개인용 텔레그램 봇이에요.

- 링크나 음원 파일을 봇에게 보내면 오디오가 채팅에 올라오고 **라이브러리**에 쌓여요. 지금 고른 플레이리스트 끝에도 붙어요.
- 링크는 한 번에 여러 개 보내도 돼요. 줄바꿈이나 쉼표로 이어 붙여도 하나씩 받아요. 진행 상황은 메시지 하나가 바뀌며 보여주고, 끝나면 몇 곡을 넣었는지와 실패한 링크를 알려줘요.
- 채팅 아래 **🎵 플레이리스트** 버튼으로 미니앱을 열어 라이브러리에서 곡을 골라 플레이리스트를 만들고, 순서를 바꾸고, 지우고, 링크를 붙여넣어요. 저장한 플레이리스트가 지금 플레이리스트가 돼요.
- **▶ 재생**을 누르면 순서대로 오디오가 오고, 첫 곡을 누르면 텔레그램 플레이어가 다음 곡으로 이어 재생해요. 반복은 플레이어의 반복 버튼으로 켜고 꺼요.

명령어: `/start`, `/list`(지금 플레이리스트 보기), `/play`(지금 플레이리스트 재생). 🎵 버튼으로 모두 할 수 있어요.

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
| `DB_PATH` | 기본값 `data/loopbot.db` |
| `DATABASE_URL` | 선택. Supabase 풀러 주소. 비우면 SQLite를 써요 |

`.env`는 git에 올라가지 않아요. 토큰은 여기에만 넣으세요.

## 실행

```bash
. .venv/bin/activate
python -m loopbot
```

맥이 켜져 있고 이 명령이 실행 중일 때만 봇이 동작해요. 끄려면 `Ctrl+C`.

## 저장소

기본은 SQLite(`DB_PATH`)예요. 예전 버전의 DB는 처음 실행할 때 한 번 옮겨지고, 그동안의 곡은 `기본` 플레이리스트에 같은 순서로 들어가요.

`DATABASE_URL`을 넣으면 Supabase(Postgres)에 저장해요. 봇을 다른 컴퓨터로 옮겨도 라이브러리와 플레이리스트가 그대로 남아요. 다운로드는 여전히 봇이 도는 컴퓨터에서 해요.

## 제한

- 영상 길이 최대 60분 (음질에 따라 약 50분 넘으면 49MB를 넘을 수 있어요), 파일 최대 49MB
- 음원은 파일이 아니라 음원(mp3·m4a)으로 보내야 해요
- 한 번에 링크 최대 10개
- 재생목록 링크와 라이브 방송은 받지 않아요

## 유튜브가 막을 때

"유튜브가 서버 접근을 막았어요 (쿠키 필요)"가 나오면, 브라우저 확장(예: Get cookies.txt LOCALLY)으로 youtube.com 쿠키를 `cookies.txt`로 내보내고 `.env`의 `YTDLP_COOKIES`에 그 파일 경로를 넣은 뒤 봇을 다시 실행하세요.

## 테스트

```bash
pytest
```
