# loop-bot

유튜브 링크와 음원 파일을 하나의 플레이리스트로 모아, 정한 순서대로 텔레그램 플레이어에서 이어 재생하는 개인용 텔레그램 봇이에요.

- 링크나 음원 파일을 봇에게 보내면 플레이리스트에 추가돼요.
- 채팅 아래 **🎵 플레이리스트** 버튼으로 미니앱을 열어 드래그로 순서를 바꾸고, 삭제하고, 링크를 붙여넣어요.
- **▶ 재생**을 누르면 순서대로 오디오가 오고, 첫 곡을 누르면 텔레그램 플레이어가 다음 곡으로 이어 재생해요. 반복은 플레이어의 반복 버튼으로 켜고 꺼요.

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

`.env`는 git에 올라가지 않아요. 토큰은 여기에만 넣으세요.

## 실행

```bash
. .venv/bin/activate
python -m loopbot
```

맥이 켜져 있고 이 명령이 실행 중일 때만 봇이 동작해요. 끄려면 `Ctrl+C`.

## 제한

- 영상 길이 최대 60분, 파일 최대 49MB
- 한 번에 링크 최대 10개
- 재생목록 링크와 라이브 방송은 받지 않아요

## 유튜브가 막을 때

"유튜브가 서버 접근을 막았어요 (쿠키 필요)"가 나오면, 브라우저 확장(예: Get cookies.txt LOCALLY)으로 youtube.com 쿠키를 `cookies.txt`로 내보내고 `.env`의 `YTDLP_COOKIES`에 그 파일 경로를 넣은 뒤 봇을 다시 실행하세요.

## 테스트

```bash
pytest
```
