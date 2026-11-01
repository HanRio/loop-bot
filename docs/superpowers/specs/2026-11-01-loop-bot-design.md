# loop-bot 설계

날짜: 2026-11-01

## 목적

유튜브 링크와 음원 파일을 하나의 플레이리스트로 모아, 내가 정한 순서대로 텔레그램 플레이어에서 이어 재생하고 반복을 켜고 끌 수 있게 하는 개인용 텔레그램 봇.

- 처음엔 혼자 사용, 괜찮으면 지인과 공유.
- 1단계: 내 맥에서 실행. 2단계: Oracle Cloud(무료 티어, 안 되면 Hetzner)로 이전.

## 핵심 결정

| 결정 | 이유 |
|---|---|
| 음원을 합치지 않는다. 곡마다 오디오 메시지 하나 | 순서 바꿔도 재가공 불필요 |
| 재생·다음 곡·반복은 텔레그램 기본 플레이어에 맡긴다 | 백그라운드 재생, 반복(끄기/전체/한 곡) 버튼이 이미 있음 |
| 업로드된 파일은 `file_id`만 저장해 재전송 | 재다운로드·재업로드 없이 즉시 전송 |
| 미니앱이 메인 UI, 서버 API 없이 `sendData`로 통신 | 웹서버·도메인·HTTPS 관리 불필요 |
| Docker 미사용. 맥은 venv, 서버는 venv + systemd | 사용자가 Docker 관리 부담 원치 않음 |
| 플레이리스트는 사용자당 하나 | YAGNI. 여러 개는 필요해지면 추가 |

## 구성

```
[텔레그램 앱] ⇄ (long polling) ⇄ [봇: Python, python-telegram-bot]
                                   ├─ yt-dlp + ffmpeg : 유튜브 → m4a
                                   └─ SQLite          : tracks 테이블
[미니앱: 정적 index.html, GitHub Pages]
   └─ 목록은 URL hash로 받고, 결과는 Telegram.WebApp.sendData로 봇에 전달
```

봇은 외부에서 들어오는 연결을 받지 않는다(long polling). 포트 개방 불필요.

## 사용 흐름

### 1. 곡 추가
- **채팅에 유튜브 링크 전송** 또는 **미니앱에서 링크 붙여넣기** → 봇이 "⏳ 받는 중: <url>" 안내 → yt-dlp로 m4a 추출 → `send_audio`로 업로드 → 응답의 `file_id`, 제목, 길이를 저장하고 목록 끝에 추가 → "✅ 추가됨: <제목>" + 갱신된 키보드.
- **채팅에 음원 파일 전송**(audio 메시지, 또는 mime이 `audio/*`인 document) → 다운로드 없이 `file_id`와 제목(파일명/메타데이터)을 저장 → "✅ 추가됨".
- 다운로드는 한 번에 하나씩 처리한다(전역 큐). 여러 개가 들어오면 순서대로 처리.

### 2. 미니앱 (🎵 플레이리스트 버튼)
- 채팅 하단 고정 reply keyboard에 `🎵 플레이리스트` 버튼(`web_app`). `sendData`는 reply keyboard로 연 미니앱에서만 동작하므로 메뉴 버튼이 아닌 이 방식을 쓴다.
- 버튼 URL: `<WEBAPP_URL>#d=<base64url(JSON)>`, JSON = `[{"i": track_id, "t": "제목"}, ...]`. 제목은 40자로 자른다.
- 키보드 URL은 보낸 시점의 스냅샷이므로, **목록이 바뀔 때마다 봇이 갱신된 키보드를 담은 메시지를 보낸다.**
- 미니앱 기능:
  - 목록 표시, 드래그로 순서 변경(SortableJS), 곡별 삭제 버튼
  - 유튜브 링크 입력란(여러 줄, 한 줄에 하나)
  - `저장` 버튼 / `▶ 재생` 버튼 → 아래 payload를 `sendData`로 보내고 닫힘
- payload:
  ```json
  {"v": 1, "order": [3, 1, 2], "add": ["https://youtu.be/..."], "play": true}
  ```
  - `order`에 없는 기존 id는 삭제로 처리.
  - 처리 순서: 순서/삭제 반영 → `add` 다운로드 큐에 추가 → `play`면 재생.
  - `play`와 `add`가 같이 오면 기존 목록을 먼저 재생하고, 새 곡은 다운로드되는 대로 "✅ 추가됨"으로 온다.

### 3. 재생 (`▶ 재생` 또는 `/play`)
- 목록 순서대로 `send_audio(file_id)`를 보낸다. 메시지 간 0.5초 간격, `RetryAfter`가 오면 지정 시간만큼 기다렸다가 재시도.
- 사용자는 첫 곡을 누르면 텔레그램 플레이어가 다음 곡으로 이어 재생하고, 반복은 플레이어 버튼으로 조절한다.

### 4. 보조 명령어 (몰라도 사용 가능)
- `/start`: 안내 + 키보드 표시
- `/list`: 현재 순서를 텍스트로
- `/play`: 재생

## 데이터

SQLite 파일 하나(`data/loopbot.db`).

```sql
CREATE TABLE tracks (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  position   INTEGER NOT NULL,
  title      TEXT    NOT NULL,
  file_id    TEXT    NOT NULL,
  duration   INTEGER,          -- 초, 모르면 NULL
  source     TEXT,             -- 유튜브 URL, 파일이면 NULL
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tracks_user ON tracks(user_id, position);
```

## 입력 검증·제약

- **접근 제한**: `.env`의 `ALLOWED_USER_IDS`(쉼표 구분)에 없는 사용자는 "사용 권한이 없어요" 응답 후 무시.
- **payload 검증**: JSON 파싱 실패, `v != 1`, `order`가 정수 배열이 아님, `order`에 내 것이 아닌 id 포함, 중복 id → 전부 거부하고 "목록이 바뀌었어요. 버튼을 다시 눌러주세요" 안내(갱신된 키보드 첨부).
- **링크 검증**: 호스트가 `youtube.com`, `www.youtube.com`, `m.youtube.com`, `music.youtube.com`, `youtu.be` 중 하나인 http(s) URL만. 한 번에 최대 10개.
- **길이·용량**: yt-dlp 메타데이터로 길이 60분 초과면 다운로드 전 거부. 결과 파일이 49MB 초과면 거부(봇 업로드 한도 50MB).
- **유튜브 차단 대비**: `.env`의 `YTDLP_COOKIES`에 cookies.txt 경로가 있으면 yt-dlp에 전달.

## 오류 처리

| 상황 | 사용자에게 |
|---|---|
| yt-dlp 실패(차단, 비공개, 삭제 영상) | "❌ 받지 못했어요: <제목 또는 url> (<짧은 사유>)" |
| 너무 김/큼 | "❌ 너무 길어요 (최대 60분)" |
| 지원하지 않는 링크 | "유튜브 링크나 음원 파일만 받을 수 있어요" |
| 빈 목록에서 재생 | "아직 곡이 없어요. 링크나 음원을 보내주세요" |
| 저장된 file_id 전송 실패 | 해당 곡만 "❌ 재생 실패: <제목>" 후 다음 곡 계속 |

임시 다운로드 파일은 업로드 후 성공·실패와 무관하게 삭제한다. 예외는 로그로 남긴다(stdout).

## 파일 구조

```
loop-bot/
├─ loopbot/
│  ├─ __main__.py     # 진입점: .env 로드, 앱 구성, polling 시작
│  ├─ config.py       # 환경변수 읽기·검증
│  ├─ db.py           # tracks 저장소 (add, list, apply_order, ...)
│  ├─ payload.py      # sendData payload 파싱·검증, 링크 검증, 키보드 URL 생성
│  ├─ youtube.py      # yt-dlp 호출 (메타 확인, m4a 추출)
│  └─ handlers.py     # 텔레그램 핸들러
├─ webapp/index.html  # 미니앱 (GitHub Pages로 배포)
├─ tests/             # pytest
├─ deploy/            # 2단계: setup.sh, loopbot.service
├─ requirements.txt
├─ .env.example
└─ README.md
```

## 환경변수 (`.env`)

```
BOT_TOKEN=            # @BotFather에서 발급 (사용자가 직접 입력)
ALLOWED_USER_IDS=     # 내 텔레그램 user id
WEBAPP_URL=           # GitHub Pages 주소
YTDLP_COOKIES=        # 선택
DB_PATH=data/loopbot.db
```

## 테스트

- **자동(pytest)**: payload 파싱·검증(정상, 깨진 JSON, 남의 id, 중복, 링크 초과), 링크 검증, 키보드 URL 인코딩/제목 자르기, db의 추가/재정렬/삭제/사용자 분리.
- **수동(맥)**: 실제 봇으로 링크 추가 → 파일 추가 → 미니앱 드래그·삭제·링크 추가 → 재생 → 텔레그램 플레이어 이어 재생·반복 확인.

## 단계

1. **맥 실행 (이번 범위)**: 위 기능 전부, `python -m loopbot`으로 실행. 미니앱은 GitHub Pages 배포.
2. **Oracle 이전 (다음 범위)**: `deploy/setup.sh`(apt로 ffmpeg, venv, pip 설치, systemd 등록)와 `loopbot.service`. 관리 명령은 README에 상태/재시작/로그 3줄.

## 범위 밖

플레이리스트 여러 개, 곡 구간 자르기, 미니앱 내 파일 업로드, 실시간 진행 표시(API 서버), 웹에서의 재생.
