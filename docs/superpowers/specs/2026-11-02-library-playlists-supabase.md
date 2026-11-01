# 라이브러리·다중 플레이리스트·Supabase 저장소

날짜: 2026-11-02

## 목표

1. 유튜브 링크를 한 번에 여러 개 보내도 안정적으로 처리한다. 진행 상황은 메시지 하나를 고쳐 가며 보여주고, 끝나면 요약을 보낸다.
2. 받은 음원은 전부 채팅에 오디오로 올라오고 **라이브러리**에 쌓인다. 사용자는 라이브러리에서 곡을 골라 **플레이리스트를 여러 개** 만들고 순서를 정해 재생한다.
3. 저장소를 SQLite와 Supabase(Postgres) 중에서 고를 수 있다. 다운로드(yt-dlp, ffmpeg)는 여전히 봇 프로세스가 한다. Supabase는 DB를 대신하고, 봇을 맥에서 서버로 옮겨도 데이터가 그대로 남게 한다.

Supabase는 서버 전체를 대신하지 못한다. Edge Function에서는 yt-dlp와 ffmpeg를 실행할 수 없고, 데이터센터 IP는 유튜브가 막는다.

## 데이터 모델

```python
@dataclass(frozen=True)
class Track:            # 라이브러리 곡
    id: int
    user_id: int
    title: str
    file_id: str
    duration: int | None
    source: str | None  # 유튜브 URL, 직접 보낸 음원이면 None

@dataclass(frozen=True)
class Playlist:
    id: int
    user_id: int
    name: str
    track_ids: tuple[int, ...]  # 재생 순서, 중복 없음
```

테이블(SQLite와 Postgres 같은 구조):

| 테이블 | 열 |
|---|---|
| `tracks` | id, user_id, title, file_id, duration, source, created_at |
| `playlists` | id, user_id, name, created_at |
| `playlist_tracks` | playlist_id → playlists ON DELETE CASCADE, track_id → tracks ON DELETE CASCADE, position, PK(playlist_id, track_id) |
| `user_state` | user_id PK, active_playlist_id → playlists ON DELETE SET NULL |

- 사용자마다 **활성 플레이리스트**가 하나 있다. 새로 받은 곡은 라이브러리에 들어가고 활성 플레이리스트 끝에도 붙는다. `/play`는 활성 플레이리스트를 재생한다.
- 플레이리스트가 하나도 없으면 `기본`을 만들어 활성으로 둔다.
- 기존 SQLite DB(`tracks`에 `position` 열이 있는 구버전)는 시작 시 한 번 이전한다. 사용자마다 `기본` 플레이리스트를 만들고, 기존 순서대로 곡을 넣고, `position` 열을 없앤다. 다시 실행해도 결과가 같아야 한다.

## 저장소 인터페이스 (`loopbot/store/__init__.py`)

```python
class Store(Protocol):
    def add_track(self, user_id: int, title: str, file_id: str, duration: int | None, source: str | None) -> Track
        # 라이브러리에 추가 + 활성 플레이리스트 끝에 붙임
    def library(self, user_id: int) -> list[Track]                 # 오래된 순
    def playlists(self, user_id: int) -> list[Playlist]            # 만든 순
    def active_playlist(self, user_id: int) -> Playlist            # 없으면 '기본' 생성
    def save_playlist(self, user_id: int, playlist_id: int | None, name: str, track_ids: Sequence[int]) -> Playlist
        # None이면 새로 만듦. 남의 곡·없는 곡 id는 무시, 중복은 첫 번째만. 저장한 목록을 활성으로 둠.
        # 남의/없는 playlist_id면 새로 만듦.
    def delete_playlist(self, user_id: int, playlist_id: int) -> None
        # 활성 목록을 지우면 남은 것 중 가장 최근 것, 없으면 다음 호출 때 '기본'
    def delete_tracks(self, user_id: int, track_ids: Sequence[int]) -> None
        # 라이브러리와 모든 플레이리스트에서 삭제. 남의 id는 무시.

def open_store(cfg: Config) -> Store   # cfg.database_url 있으면 Postgres, 없으면 SQLite(cfg.db_path)
```

- `loopbot/store/sqlite.py`: `SqliteStore(path)`.
- `loopbot/store/postgres.py`: `PostgresStore(dsn)`, psycopg 3, 스키마 `loopbot`, 연결 하나(autocommit 끄고 `with conn.transaction()`).
- 같은 동작 테스트(`tests/test_store_contract.py`)를 두 저장소에 돌린다. Postgres는 `LOOPBOT_TEST_DATABASE_URL`이 있을 때만.
- 저장소 메서드는 이벤트 루프 스레드에서만 부른다.

## 미니앱 ↔ 봇 데이터

미니앱 URL `#d=` 값(base64url, 패딩 없음, UTF-8 JSON):

```json
{"v": 2,
 "lib": [{"i": 3, "t": "곡 제목"}],
 "pls": [{"i": 1, "n": "기본", "t": [3, 5]}],
 "a": 1}
```

- `lib` 라이브러리 전체(오래된 순), `pls` 플레이리스트(만든 순), `a` 활성 플레이리스트 id.
- 전체 URL이 4096자를 넘으면 곡 제목을 40 → 20 → 8 → 0자로 줄인다. 플레이리스트 이름은 20자로 자른다.

미니앱 → 봇 `sendData` (4096바이트 이하):

```json
{"v": 2, "playlist": 1, "name": "출근길", "tracks": [5, 3],
 "delete_tracks": [], "delete_playlist": false, "add": ["https://youtu.be/..."], "play": true}
```

- `playlist`: 기존 id 또는 `null`(새 목록).
- `name`: 앞뒤 공백 제거 후 1~20자. 비면 `새 플레이리스트`.
- `tracks`: 그 플레이리스트의 재생 순서.
- `delete_tracks`: 라이브러리에서 지울 곡.
- `delete_playlist`: 참이면 그 목록 삭제(다른 필드 무시, `play` 무시).
- `add`: 유튜브 링크 최대 10개. 받은 곡은 그 플레이리스트 끝에 붙는다.
- `play`: 저장 후 그 플레이리스트 재생.
- 정수 id는 0 이상 2^63 미만, bool은 정수가 아니다. 형식 오류는 전부 "목록이 바뀌었어요. 버튼을 다시 눌러주세요".
- 처리 순서: delete_tracks → save_playlist(활성으로) → "✅ 저장했어요" + 키보드 → play → add(일괄 처리, 재생을 막지 않게 백그라운드 작업).

## 여러 링크 일괄 처리

- 링크 추출: 글에서 `https?://` 로 시작하는 토큰을 모두 찾는다(공백·줄바꿈·쉼표로 붙어 있어도). 유튜브 호스트만 남기고, 순서 유지, 중복 제거.
- 링크가 여러 개면 상태 메시지 하나를 보내고 고쳐 가며 진행을 보여준다: `⏳ 받는 중 (2/5): <제목 또는 url>`.
- 곡마다 오디오가 채팅에 올라온다(이 업로드로 file_id를 얻는다). 곡 하나가 실패해도 나머지는 계속 받는다.
- 끝나면 요약 하나: `✅ 5곡 중 4곡을 '<플레이리스트>'에 추가했어요` + 실패한 줄마다 `❌ <url> (<사유>)` + 갱신된 키보드.
- 링크가 하나여도 같은 경로를 쓴다(요약 문구만 `✅ 추가됨: <제목>`).

## Supabase 배치

- 새 프로젝트는 무료 한도(활성 2개)로 만들 수 없다. 기존 `haru` 프로젝트(개인 도구, NoteScan OCR)에 넣는다. 운영 중인 `study_proj`에는 넣지 않는다.
- 분리: 전용 스키마 `loopbot`, 전용 로그인 역할 `loopbot_app`(그 스키마에만 권한), 테이블 RLS 켬, PostgREST 노출 스키마에 넣지 않음.
- 마이그레이션은 `loop-bot/supabase/migrations/NNN_*.sql`. 봇은 `DATABASE_URL`(Supavisor 풀러, `loopbot_app.<ref>` 사용자)로 접속.
