import asyncio
import logging
import tempfile
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path

from telegram import (
    Bot, Chat, InlineKeyboardButton, InlineKeyboardMarkup, MenuButtonWebApp, Message, Update, WebAppInfo,
)
from telegram.error import BadRequest, RetryAfter, TelegramError, TimedOut
from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters

from loopbot.config import Config
from loopbot.payload import MAX_LINKS, extract_youtube_urls
from loopbot.store import Playlist, Store, Track
from loopbot.youtube import FetchError, fetch_audio

PLAY_GAP_SECONDS = 0.5
DELETE_CHUNK = 100  # Telegram's deleteMessages limit per call
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
        return InlineKeyboardMarkup([[InlineKeyboardButton("🎵 플레이어 열기", web_app=WebAppInfo(cfg.webapp_url))]])
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
    await _reply(
        update,
        context,
        "링크나 음원 파일을 보내면 라이브러리와 지금 플레이리스트에 추가돼요. "
        "왼쪽 아래 메뉴 버튼으로 플레이어를 열어요.",
    )


async def list_tracks(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    playlist, tracks = _active_tracks(context.bot_data["store"], update.effective_user.id)
    body = "\n".join(f"{i}. {t.title}" for i, t in enumerate(tracks, 1)) or EMPTY_TEXT
    await update.effective_message.reply_text(f"🎵 {playlist.name}\n{body}")


async def play(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    store: Store = context.bot_data["store"]
    user_id = update.effective_user.id
    _, tracks = _active_tracks(store, user_id)
    if not tracks:
        await update.effective_message.reply_text(EMPTY_TEXT)
        return
    chat_id = update.effective_chat.id
    # Keyed by chat: message ids are per chat, and in a private chat the chat id is the user id.
    await _delete_messages(context.bot, chat_id, store.play_messages(chat_id))
    sent_ids: list[int] = []
    for i, track in enumerate(tracks):
        if i:
            await asyncio.sleep(PLAY_GAP_SECONDS)
        try:
            sent = await _send_with_retry(lambda: context.bot.send_audio(chat_id, audio=track.file_id))
            sent_ids.append(sent.message_id)
        except TelegramError:
            try:
                await _send_with_retry(
                    lambda: context.bot.send_message(chat_id, f"❌ 재생 실패: {track.title}")
                )
            except TelegramError:
                logging.exception("failed to send playback failure notice: %s", track.title)
    store.set_play_messages(chat_id, sent_ids)


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
        context.bot_data["store"].add_track(user_id, title, sent.audio.file_id, audio.duration, url)
        await _best_effort(sent.delete(), "upload delete")
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
    context.bot_data["store"].add_track(user_id, title, media.file_id, duration, None)
    await _best_effort(msg.delete(), "audio delete")
    await _send(context, update.effective_chat, f"✅ 추가됨: {title}")


async def on_unauthorized(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.effective_message:
        await update.effective_message.reply_text("사용 권한이 없어요")


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


class _AllowedUser(filters.UpdateFilter):
    def __init__(self, cfg: Config) -> None:
        super().__init__(name="allowed user")
        self._cfg = cfg

    def filter(self, update: Update) -> bool:
        user = update.effective_user
        return user is not None and self._cfg.is_allowed(user.id, user.username)


def build_app(cfg: Config, store: Store) -> Application:
    app = (
        Application.builder()
        .token(cfg.bot_token)
        .concurrent_updates(True)
        .media_write_timeout(120)
        .post_init(_set_menu_button)
        .build()
    )
    app.bot_data.update(cfg=cfg, store=store, lock=asyncio.Lock())
    allowed = _AllowedUser(cfg)
    is_audio = filters.AUDIO | filters.Document.Category("audio/")
    commands = allowed & filters.UpdateType.MESSAGE
    app.add_handler(CommandHandler("start", start, filters=commands))
    app.add_handler(CommandHandler("list", list_tracks, filters=commands))
    app.add_handler(CommandHandler("play", play, filters=commands))
    app.add_handler(MessageHandler(allowed & filters.UpdateType.MESSAGE & is_audio, on_audio))
    app.add_handler(MessageHandler(allowed & filters.UpdateType.MESSAGE & filters.TEXT & ~filters.COMMAND, on_text))
    app.add_handler(MessageHandler(filters.ALL & ~allowed, on_unauthorized))
    app.add_error_handler(on_error)
    return app
