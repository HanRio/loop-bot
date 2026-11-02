# 재생할 곡만 채팅방에 남기기

텔레그램 플레이어는 채팅방의 모든 오디오를 대기열로 잡는다. 그래서 재생 묶음만 채팅방에 남긴다.

## 동작

1. `play`: 지난번 재생 때 보낸 오디오 메시지를 먼저 지우고(best effort), 이번 목록을 보낸 뒤 보낸 메시지 id들을 저장한다.
2. 링크로 받은 곡(`_fetch_one`): `add_track` 성공 뒤 업로드한 오디오 메시지(`sent`)를 지운다(best effort). file_id는 메시지를 지워도 유효하다.
3. 사용자가 보낸 음원(`on_audio`): `add_track` 뒤 사용자 메시지를 지운다(best effort, 봇은 개인 채팅의 받은 메시지를 지울 수 있다).
4. 지우기 실패(48시간 지난 메시지 등)는 경고 로그만 남기고 계속한다.

## 저장소

`Store` Protocol(`loopbot/store/__init__.py`)에 추가:

```python
def play_messages(self, user_id: int) -> list[int]: ...          # 없으면 []
def set_play_messages(self, user_id: int, message_ids: Sequence[int]) -> None: ...
```

- `user_state`에 열 추가. 다른 열(`active_playlist_id`)은 건드리지 않는다. 행이 없으면 만든다(`active_playlist_id`는 NULL).
- SQLite: `play_message_ids TEXT NOT NULL DEFAULT '[]'`(JSON). 시작 시 `PRAGMA table_info(user_state)`에 없으면 `ALTER TABLE ... ADD COLUMN`.
- Postgres: `play_message_ids bigint[] NOT NULL DEFAULT '{}'`. 마이그레이션 `supabase/migrations/003_play_messages.sql`이 `loopbot`과 `loopbot_test` 둘 다 `ADD COLUMN IF NOT EXISTS`.
- `_set_active`의 upsert는 `play_message_ids`를 덮어쓰지 않아야 한다(이미 그렇게 열을 지정함).

## 핸들러 (`loopbot/handlers.py`)

```python
DELETE_CHUNK = 100  # deleteMessages 한도

async def _delete_messages(bot, chat_id: int, message_ids: Sequence[int]) -> None
    # 100개씩 bot.delete_messages(chat_id, chunk), 각 청크 TelegramError는 _best_effort처럼 경고만
```

- `play`: `old = store.play_messages(user_id)` → `await _delete_messages(...)` → 보내며 `sent.message_id` 모으기(실패 안내 텍스트 메시지는 모으지 않음) → `store.set_play_messages(user_id, ids)`. 목록이 비었으면 지우지도 저장하지도 않는다.
- `_fetch_one`: `add_track` 다음 줄에서 `await _best_effort(sent.delete(), "upload delete")`. try 블록 안에 두되 실패해도 Added를 돌려준다(_best_effort가 삼킴).
- `on_audio`: `add_track` 뒤 `await _best_effort(msg.delete(), "audio delete")`, 그다음 `_reply`. `_reply`는 `msg.reply_text`를 쓰는데 지운 메시지에 답장하면 BadRequest가 난다. 그러니 `on_audio`의 확인 메시지는 `context.bot.send_message(chat_id, text, reply_markup=_keyboard(...))`로 보낸다(키보드 BadRequest 폴백은 `_reply`와 같게). 필요하면 `_reply`에 `quote: bool = True` 대신 chat 기준 전송 헬퍼 `_send(context, chat_id, user_id, text)`를 만들고 `_reply`가 그것을 쓰게 해 중복을 없앤다.
- 링크 일괄 처리의 `add_urls`도 마지막에 `_reply(update, ...)`로 원래 텍스트 메시지에 답한다. 텍스트 메시지는 지우지 않으므로 그대로 둔다.

## 테스트 (먼저 작성, 실패 확인 후 구현)

- `tests/test_store_contract.py`(sqlite·postgres 둘 다):
  - 새 사용자 `play_messages` == []
  - set 후 get이 같은 순서
  - `set_play_messages`가 활성 플레이리스트를 바꾸지 않고, `save_playlist`가 play_messages를 지우지 않음
  - 다른 사용자와 섞이지 않음
- SQLite: 열이 없는 옛 DB(현재 SCHEMA로 만든 뒤 열 DROP)도 열고 동작.
- `tests/test_handlers.py`(가짜 bot/store, 기존 `_run_on_audio` 스타일):
  - `play`가 이전 id를 지우고 새 id를 저장
  - 101개 이전 id는 100+1로 나눠 지움
  - delete가 TelegramError여도 재생은 계속
  - `on_audio`가 사용자 메시지를 지우고 send_message로 확인
  - `_fetch_one` 성공 시 업로드 메시지 delete 호출(fetch_audio를 monkeypatch)
- 기존 테스트 전부 통과.
