import asyncio
import logging
import tempfile
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path

from telegram import (
    Bot, CallbackQuery, Chat, InlineKeyboardButton, InlineKeyboardMarkup, InputMediaAudio, MenuButtonWebApp, Message,
    Update, WebAppInfo,
)
from telegram.error import BadRequest, RetryAfter, TelegramError, TimedOut
from telegram.ext import Application, CallbackQueryHandler, CommandHandler, ContextTypes, MessageHandler, filters

from loopbot import lyrics
from loopbot.access import Access
from loopbot.config import Config
from loopbot.payload import MAX_LINKS, extract_youtube_urls
from loopbot.store import Playlist, Store, Track
from loopbot.youtube import FetchError, fetch_audio

PLAY_GAP_SECONDS = 0.5
DELETE_CHUNK = 100  # Telegram's deleteMessages limit per call
ALBUM_SIZE = 10  # Telegram's sendMediaGroup limit
PICKER_MAX = 90  # Telegram caps an inline keyboard at about 100 buttons
CHAT_PLAY_TEXT = "▶️ 이 창에서 플레이"
CB_PICK = "cp:pick"
CB_CLOSE = "cp:close"
CB_STOP = "cp:stop"
CB_PLAY = "cp:play:"
PICK_TEXT = "어떤 플레이리스트를 이 창에서 재생할까요?"
NO_PLAYLIST_TEXT = "재생할 곡이 있는 플레이리스트가 없어요"
GONE_TEXT = "이 플레이리스트는 이제 재생할 수 없어요"
STOPPED_TEXT = "종료했어요"
FORBIDDEN_TEXT = "사용 권한이 없어요"
# Telegram answers an upload only after processing it, which takes several seconds; PTB's 5 s default is too short.
UPLOAD_READ_TIMEOUT = 120
EMPTY_TEXT = "아직 곡이 없어요. 링크나 음원을 보내주세요"
NO_TITLE = "제목 없음"
NOT_AUDIO_TEXT = "음원 파일로 보내주세요 (mp3·m4a)"
TIMED_OUT_REASON = "텔레그램 응답이 늦어요. 잠시 뒤 다시 보내주세요"
UNKNOWN_REASON = "알 수 없는 오류"
GROUP_START_TEXT = (
    "그룹에서는 텔레그램 규칙상 플레이리스트 앱을 바로 열 수 없어요. "
    "아래 버튼을 누르면 봇과의 개인 채팅이 열리고, 거기서 왼쪽 아래 메뉴 버튼으로 플레이리스트를 만들 수 있어요. "
    "그룹에서는 /play로 지금 플레이리스트를 이 방에 재생해요."
)


@dataclass(frozen=True)
class Added:
    url: str
    title: str


@dataclass(frozen=True)
class Failed:
    url: str
    reason: str


Outcome = Added | Failed


def batch_summary(outcomes: Sequence[Outcome], playlist_name: str) -> str:
    match outcomes:
        case [Added(title=title)]:
            return f"✅ 추가됨: {title}"
        case [Failed(url=url, reason=reason)]:
            return f"❌ 받지 못했어요: {url} ({reason})"
    added = sum(isinstance(o, Added) for o in outcomes)
    lines = [f"✅ {len(outcomes)}곡 중 {added}곡을 '{playlist_name}'에 추가했어요"]
    lines += [f"❌ {o.url} ({o.reason})" for o in outcomes if isinstance(o, Failed)]
    return "\n".join(lines)


def title_for_audio(title: str | None, performer: str | None, file_name: str | None) -> str:
    if title and performer:
        return f"{performer} - {title}"
    if title:
        return title
    if file_name:
        return Path(file_name).stem
    return NO_TITLE


def _active_tracks(store: Store, user_id: int) -> tuple[Playlist, list[Track]]:
    playlist = store.active_playlist(user_id)
    by_id = {t.id: t for t in store.library(user_id)}
    return playlist, [by_id[i] for i in playlist.track_ids]


def _markup(context: ContextTypes.DEFAULT_TYPE, chat: Chat) -> InlineKeyboardMarkup:
    if chat.type == Chat.PRIVATE:
        cfg: Config = context.bot_data["cfg"]
        return InlineKeyboardMarkup([
            [InlineKeyboardButton("🎵 플레이어 열기", web_app=WebAppInfo(cfg.webapp_url))],
            [InlineKeyboardButton(CHAT_PLAY_TEXT, callback_data=CB_PICK)],
        ])
    # Web app buttons work only in private chats, so a group gets a link that opens the private chat.
    url = f"https://t.me/{context.bot.username}?start=playlist"
    return InlineKeyboardMarkup([[InlineKeyboardButton("🎵 플레이리스트 열기 (개인 채팅)", url=url)]])


async def _reply(update: Update, context: ContextTypes.DEFAULT_TYPE, text: str) -> None:
    """Reply with the player button attached."""
    msg = update.effective_message
    try:
        await msg.reply_text(text, reply_markup=_markup(context, update.effective_chat))
    except BadRequest:
        logging.exception("reply with keyboard rejected; resending without it")
        await msg.reply_text(text)


async def _send_with_retry(send):
    while True:
        try:
            return await send()
        except RetryAfter as e:
            wait = e.retry_after
            await asyncio.sleep(wait.total_seconds() if isinstance(wait, timedelta) else wait)


async def _best_effort(action, what: str) -> None:
    try:
        await action
    except TelegramError:
        logging.warning("%s failed", what, exc_info=True)


async def _delete_messages(bot: Bot, chat_id: int, message_ids: Sequence[int]) -> None:
    for start in range(0, len(message_ids), DELETE_CHUNK):
        await _best_effort(bot.delete_messages(chat_id, message_ids[start:start + DELETE_CHUNK]), "delete messages")


async def _send(context: ContextTypes.DEFAULT_TYPE, chat: Chat, text: str) -> None:
    """Send to the chat with the player button attached."""
    try:
        await context.bot.send_message(chat.id, text, reply_markup=_markup(context, chat))
    except BadRequest:
        logging.exception("send with keyboard rejected; resending without it")
        await context.bot.send_message(chat.id, text)


# Shown by Telegram in an empty chat, before Start. A bot cannot message anyone who has not started it.
BOT_DESCRIPTION = (
    "가사집을 보며 곡마다 느낀점을 쓰고, 플레이리스트를 반복해서 듣는 봇이에요.\n\n"
    "아래 시작 버튼을 누르면 사용법과 플레이어 버튼이 나와요."
)
START_TEXT = (
    "이 메시지 아래 🎵 플레이어 열기 버튼을 눌러 시작해요.\n\n"
    "가사집\n"
    "1. 위쪽 칸에서 가사집 목록을 골라요.\n"
    "2. 곡마다 가사 사진을 보며 느낀점을 써요. 쓰는 대로 저장돼요.\n"
    "3. 복사 버튼을 눌러 느낀점을 가져가요.\n\n"
    "노래 듣기\n"
    "1. 곡을 누르면 재생돼요. 화면을 꺼도 다음 곡으로 이어져요.\n"
    "2. 내 곡을 넣으려면 이 채팅에 유튜브 링크나 음원 파일을 보내요.\n\n"
    "채팅으로 듣기\n"
    "▶️ 이 창에서 플레이를 누르고 목록을 고르면 곡이 이 창에 묶여서 올라와요. 곡을 누르면 텔레그램 기본 플레이어로 들을 수 있어요. 다 들으면 종료를 눌러 주세요. 올라온 곡이 지워져서 다른 곡과 섞이지 않아요.\n\n"
    "긴 곡은 플레이어에서 재생되지 않을 수 있어요. 그럴 때는 채팅에서 /play로 들어요.\n"
    "버튼은 왼쪽 아래 🎵 플레이어에도 있어요."
)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.effective_chat.type != Chat.PRIVATE:
        await _reply(update, context, GROUP_START_TEXT)
        return
    # A username-allowed user has no known id until they message the bot, so the menu is set here, per chat.
    cfg: Config = context.bot_data["cfg"]
    await _best_effort(
        context.bot.set_chat_menu_button(chat_id=update.effective_chat.id, menu_button=_menu(cfg)),
        "menu button",
    )
    await _reply(update, context, START_TEXT)


async def list_tracks(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    playlist, tracks = _active_tracks(context.bot_data["store"], update.effective_user.id)
    body = "\n".join(f"{i}. {t.title}" for i, t in enumerate(tracks, 1)) or EMPTY_TEXT
    await update.effective_message.reply_text(f"🎵 {playlist.name}\n{body}")


def _control_text(name: str, count: int) -> str:
    return f"🎵 {name} · {count}곡\n위 곡을 누르면 재생돼요. 다 들으면 종료를 눌러 주세요."


def _play_lock(context: ContextTypes.DEFAULT_TYPE, chat_id: int) -> asyncio.Lock:
    return context.bot_data.setdefault("play_locks", defaultdict(asyncio.Lock))[chat_id]


async def _send_single(bot: Bot, chat_id: int, track: Track) -> int | None:
    try:
        sent = await _send_with_retry(lambda: bot.send_audio(chat_id, audio=track.file_id))
        return sent.message_id
    except TelegramError:
        try:
            await _send_with_retry(lambda: bot.send_message(chat_id, f"❌ 재생 실패: {track.title}"))
        except TelegramError:
            logging.exception("failed to send playback failure notice: %s", track.title)
        return None


async def _send_album(bot: Bot, chat_id: int, tracks: Sequence[Track]) -> list[int]:
    if len(tracks) > 1:
        try:
            sent = await _send_with_retry(
                lambda: bot.send_media_group(
                    chat_id, [InputMediaAudio(t.file_id) for t in tracks], read_timeout=UPLOAD_READ_TIMEOUT
                )
            )
            return [m.message_id for m in sent]
        except TimedOut:
            # The album may have arrived, so resending could double it. Its ids are unknown either way.
            logging.exception("album send timed out")
            return []
        except TelegramError:
            logging.warning("album send failed; sending tracks one by one", exc_info=True)
    sent_ids: list[int] = []
    for i, track in enumerate(tracks):
        if i:
            await asyncio.sleep(PLAY_GAP_SECONDS)
        message_id = await _send_single(bot, chat_id, track)
        if message_id is not None:
            sent_ids.append(message_id)
    return sent_ids


async def _send_control(bot: Bot, chat_id: int, name: str, count: int) -> list[int]:
    markup = InlineKeyboardMarkup([[InlineKeyboardButton("⏹ 종료", callback_data=CB_STOP)]])
    try:
        sent = await _send_with_retry(
            lambda: bot.send_message(chat_id, _control_text(name, count), reply_markup=markup)
        )
        return [sent.message_id]
    except TelegramError:
        logging.exception("control message failed")
        return []


async def _play_in_chat(context: ContextTypes.DEFAULT_TYPE, chat_id: int, name: str, tracks: Sequence[Track]) -> None:
    store: Store = context.bot_data["store"]
    async with _play_lock(context, chat_id):
        # Keyed by chat: message ids are per chat, and in a private chat the chat id is the user id.
        await _delete_messages(context.bot, chat_id, store.play_messages(chat_id))
        sent_ids: list[int] = []
        try:
            for start in range(0, len(tracks), ALBUM_SIZE):
                if start:
                    await asyncio.sleep(PLAY_GAP_SECONDS)
                sent_ids += await _send_album(context.bot, chat_id, tracks[start:start + ALBUM_SIZE])
            sent_ids += await _send_control(context.bot, chat_id, name, len(tracks))
        finally:
            store.set_play_messages(chat_id, sent_ids)


async def play(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    playlist, tracks = _active_tracks(context.bot_data["store"], update.effective_user.id)
    if not tracks:
        await update.effective_message.reply_text(EMPTY_TEXT)
        return
    await _play_in_chat(context, update.effective_chat.id, playlist.name, tracks)


async def _show_picker(query: CallbackQuery, context: ContextTypes.DEFAULT_TYPE) -> None:
    store: Store = context.bot_data["store"]
    playlists = [p for p in store.playable_playlists(query.from_user.id) if p.track_ids]
    if not playlists:
        await query.answer(NO_PLAYLIST_TEXT, show_alert=True)
        return
    await query.answer()
    rows = [[InlineKeyboardButton(f"{p.name} ({len(p.track_ids)}곡)", callback_data=f"{CB_PLAY}{p.id}")]
            for p in playlists[:PICKER_MAX]]
    rows.append([InlineKeyboardButton("닫기", callback_data=CB_CLOSE)])
    # A button on an old message arrives with only chat and message_id, so everything goes through the bot.
    await context.bot.send_message(query.message.chat.id, PICK_TEXT, reply_markup=InlineKeyboardMarkup(rows))


async def _play_picked(query: CallbackQuery, context: ContextTypes.DEFAULT_TYPE) -> None:
    store: Store = context.bot_data["store"]
    try:
        playlist_id = int(query.data[len(CB_PLAY):])
    except ValueError:
        await query.answer(GONE_TEXT, show_alert=True)
        return
    found = store.playlist_tracks(query.from_user.id, playlist_id)
    if found is None or not found[1]:
        await query.answer(GONE_TEXT, show_alert=True)
        return
    playlist, tracks = found
    await query.answer()
    await _delete_messages(context.bot, query.message.chat.id, [query.message.message_id])
    await _play_in_chat(context, query.message.chat.id, playlist.name, tracks)


async def _stop_play(query: CallbackQuery, context: ContextTypes.DEFAULT_TYPE) -> None:
    store: Store = context.bot_data["store"]
    chat_id = query.message.chat.id
    await query.answer(STOPPED_TEXT)
    async with _play_lock(context, chat_id):
        ids = list(dict.fromkeys([*store.play_messages(chat_id), query.message.message_id]))
        await _delete_messages(context.bot, chat_id, ids)
        store.set_play_messages(chat_id, [])


async def on_chat_play(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    access: Access = context.bot_data["access"]
    if not access.is_allowed(query.from_user.id, query.from_user.username):
        await query.answer(FORBIDDEN_TEXT, show_alert=True)
        return
    if query.message is None:
        await query.answer()
        return
    if query.data == CB_PICK:
        await _show_picker(query, context)
    elif query.data == CB_CLOSE:
        await query.answer()
        await _delete_messages(context.bot, query.message.chat.id, [query.message.message_id])
    elif query.data.startswith(CB_PLAY):
        await _play_picked(query, context)
    elif query.data == CB_STOP:
        await _stop_play(query, context)
    else:
        await query.answer()


_bg_tasks: set[asyncio.Task] = set()


async def drain_background() -> None:
    await asyncio.gather(*_bg_tasks)


async def _save_lyrics(context: ContextTypes.DEFAULT_TYPE, track_id: int, query: str, artist: str | None, duration: int | None) -> None:
    try:
        found = await asyncio.to_thread(lyrics.search, query, artist, duration)
        context.bot_data["store"].save_lyrics(track_id, found)
    except lyrics.LyricsUnavailable:
        logging.warning("lyrics unavailable, will retry later: %s", query, exc_info=True)
    except Exception:
        logging.exception("lyrics failed: %s", query)


def _start_lyrics(context: ContextTypes.DEFAULT_TYPE, track, query: str, artist: str | None, duration: int | None) -> None:
    task = asyncio.create_task(_save_lyrics(context, track.id, query, artist, duration))
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)


async def _fetch_one(msg: Message, context: ContextTypes.DEFAULT_TYPE, user_id: int, url: str) -> Outcome:
    cfg: Config = context.bot_data["cfg"]
    try:
        async with context.bot_data["lock"]:
            with tempfile.TemporaryDirectory() as tmp:
                audio = await asyncio.to_thread(fetch_audio, url, Path(tmp), cfg.ytdlp_cookies)
                with open(audio.path, "rb") as f:
                    async def upload():
                        f.seek(0)  # a RetryAfter retry must re-read from the start
                        return await msg.reply_audio(
                            f,
                            title=audio.title,
                            performer=audio.performer,
                            duration=audio.duration,
                            read_timeout=UPLOAD_READ_TIMEOUT,
                        )

                    sent = await _send_with_retry(upload)
        title = title_for_audio(audio.title, audio.performer, None)
        track = context.bot_data["store"].add_track(user_id, title, sent.audio.file_id, audio.duration, url)
        await _best_effort(sent.delete(), "upload delete")
        _start_lyrics(context, track, audio.track or title, audio.artist or audio.performer, audio.duration)
    except FetchError as e:
        return Failed(url, str(e))
    except TimedOut:
        logging.exception("upload timed out: %s", url)
        return Failed(url, TIMED_OUT_REASON)
    except Exception:
        logging.exception("download failed: %s", url)
        return Failed(url, UNKNOWN_REASON)
    return Added(url, title)


def _progress(index: int, total: int, url: str) -> str:
    return f"⏳ 받는 중 ({index}/{total}): {url}"


async def add_urls(update: Update, context: ContextTypes.DEFAULT_TYPE, urls: Sequence[str]) -> None:
    msg = update.effective_message
    user_id = update.effective_user.id
    status = await msg.reply_text(_progress(1, len(urls), urls[0]))
    outcomes: list[Outcome] = []
    for index, url in enumerate(urls, 1):
        if index > 1:
            await _best_effort(status.edit_text(_progress(index, len(urls), url)), "status edit")
        # ponytail: a track joins whichever playlist is active when it lands, so switching mid-batch splits it; pinning a target needs a Store append-to-playlist call.
        outcomes.append(await _fetch_one(msg, context, user_id, url))
    await _best_effort(status.delete(), "status delete")
    playlist = context.bot_data["store"].active_playlist(user_id)
    await _reply(update, context, batch_summary(outcomes, playlist.name))


async def on_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    urls = extract_youtube_urls(update.effective_message.text)
    if not urls:
        await update.effective_message.reply_text("유튜브 링크나 음원 파일만 받을 수 있어요")
    elif len(urls) > MAX_LINKS:
        await update.effective_message.reply_text(f"링크는 한 번에 {MAX_LINKS}개까지 넣을 수 있어요")
    else:
        await add_urls(update, context, urls)


async def on_audio(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    msg = update.effective_message
    media = msg.audio
    if media is None:
        await msg.reply_text(NOT_AUDIO_TEXT)
        return
    title = title_for_audio(
        getattr(media, "title", None), getattr(media, "performer", None), media.file_name
    )
    duration = getattr(media, "duration", None)
    user_id = update.effective_user.id
    track = context.bot_data["store"].add_track(user_id, title, media.file_id, duration, None)
    await _best_effort(msg.delete(), "audio delete")
    await _send(context, update.effective_chat, f"✅ 추가됨: {title}")
    _start_lyrics(context, track, title, getattr(media, "performer", None), duration)


async def on_unauthorized(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.effective_message:
        await update.effective_message.reply_text(FORBIDDEN_TEXT)


ERROR_TEXT = "잠시 문제가 생겼어요. 잠시 뒤 다시 시도해주세요"


async def on_error(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    logging.error("unhandled error", exc_info=context.error)
    msg = getattr(update, "effective_message", None)
    if msg is None:
        return
    try:
        await msg.reply_text(ERROR_TEXT)
    except Exception:
        logging.exception("error notice failed")


def _menu(cfg: Config) -> MenuButtonWebApp:
    return MenuButtonWebApp("🎵 플레이어", WebAppInfo(cfg.webapp_url))


async def _set_menu_button(app: Application) -> None:
    cfg: Config = app.bot_data["cfg"]
    menu = _menu(cfg)
    # Per chat: Telegram accepts a default web app button but getChatMenuButton keeps reporting "commands".
    for user_id in sorted(cfg.allowed_user_ids):
        try:
            await app.bot.set_chat_menu_button(chat_id=user_id, menu_button=menu)
        except Exception:
            # A network blip here must not abort run_polling; the old button stays until the next start.
            logging.exception("menu button failed for user %s", user_id)


async def _on_startup(app: Application) -> None:
    await _best_effort(app.bot.set_my_description(BOT_DESCRIPTION), "bot description")
    await _set_menu_button(app)


class _AllowedUser(filters.UpdateFilter):
    def __init__(self, access: Access) -> None:
        super().__init__(name="allowed user")
        self._access = access

    def filter(self, update: Update) -> bool:
        user = update.effective_user
        return user is not None and self._access.is_allowed(user.id, user.username)


def build_app(cfg: Config, store: Store) -> Application:
    app = (
        Application.builder()
        .token(cfg.bot_token)
        .concurrent_updates(True)
        .media_write_timeout(120)
        .post_init(_on_startup)
        .build()
    )
    access = Access(cfg, store.allowed_usernames)
    app.bot_data.update(cfg=cfg, store=store, lock=asyncio.Lock(), access=access)
    allowed = _AllowedUser(access)
    is_audio = filters.AUDIO | filters.Document.Category("audio/")
    commands = allowed & filters.UpdateType.MESSAGE
    app.add_handler(CommandHandler("start", start, filters=commands))
    app.add_handler(CommandHandler("list", list_tracks, filters=commands))
    app.add_handler(CommandHandler("play", play, filters=commands))
    app.add_handler(MessageHandler(allowed & filters.UpdateType.MESSAGE & is_audio, on_audio))
    app.add_handler(MessageHandler(allowed & filters.UpdateType.MESSAGE & filters.TEXT & ~filters.COMMAND, on_text))
    app.add_handler(MessageHandler(filters.ALL & ~allowed, on_unauthorized))
    app.add_handler(CallbackQueryHandler(on_chat_play, pattern=r"^cp:"))
    app.add_error_handler(on_error)
    return app
