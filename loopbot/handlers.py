import asyncio
import logging
import tempfile
from datetime import timedelta
from pathlib import Path

from telegram import KeyboardButton, ReplyKeyboardMarkup, Update, WebAppInfo
from telegram.error import BadRequest, RetryAfter, TelegramError, TimedOut
from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters

from loopbot.config import Config
from loopbot.db import TrackRepo
from loopbot.payload import MAX_LINKS, PayloadError, build_webapp_url, extract_youtube_urls, parse_action
from loopbot.youtube import FetchError, fetch_audio

PLAY_GAP_SECONDS = 0.5
# Telegram answers an upload only after processing it, which takes several seconds; PTB's 5 s default is too short.
UPLOAD_READ_TIMEOUT = 120
EMPTY_TEXT = "아직 곡이 없어요. 링크나 음원을 보내주세요"
NO_TITLE = "제목 없음"
NOT_AUDIO_TEXT = "음원 파일로 보내주세요 (mp3·m4a)"


def title_for_audio(title: str | None, performer: str | None, file_name: str | None) -> str:
    if title and performer:
        return f"{performer} - {title}"
    if title:
        return title
    if file_name:
        return Path(file_name).stem
    return NO_TITLE


def _keyboard(context: ContextTypes.DEFAULT_TYPE, user_id: int) -> ReplyKeyboardMarkup:
    cfg: Config = context.bot_data["cfg"]
    tracks = context.bot_data["repo"].list(user_id)
    button = KeyboardButton("🎵 플레이리스트", web_app=WebAppInfo(build_webapp_url(cfg.webapp_url, tracks)))
    return ReplyKeyboardMarkup([[button]], resize_keyboard=True, is_persistent=True)


async def _reply(update: Update, context: ContextTypes.DEFAULT_TYPE, text: str) -> None:
    """Reply with the up-to-date playlist keyboard attached."""
    msg = update.effective_message
    try:
        await msg.reply_text(text, reply_markup=_keyboard(context, update.effective_user.id))
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


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await _reply(update, context, "링크나 음원 파일을 보내면 플레이리스트에 추가돼요. 🎵 버튼으로 순서를 정하고 재생하세요.")


async def list_tracks(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    tracks = context.bot_data["repo"].list(update.effective_user.id)
    text = "\n".join(f"{i}. {t.title}" for i, t in enumerate(tracks, 1)) or EMPTY_TEXT
    await update.effective_message.reply_text(text)


async def play(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    tracks = context.bot_data["repo"].list(update.effective_user.id)
    if not tracks:
        await update.effective_message.reply_text(EMPTY_TEXT)
        return
    chat_id = update.effective_chat.id
    for i, track in enumerate(tracks):
        if i:
            await asyncio.sleep(PLAY_GAP_SECONDS)
        try:
            await _send_with_retry(lambda: context.bot.send_audio(chat_id, audio=track.file_id))
        except TelegramError:
            try:
                await _send_with_retry(
                    lambda: context.bot.send_message(chat_id, f"❌ 재생 실패: {track.title}")
                )
            except TelegramError:
                logging.exception("failed to send playback failure notice: %s", track.title)


async def add_url(update: Update, context: ContextTypes.DEFAULT_TYPE, url: str) -> None:
    msg = update.effective_message
    user_id = update.effective_user.id
    cfg: Config = context.bot_data["cfg"]
    await msg.reply_text(f"⏳ 받는 중: {url}")
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
        context.bot_data["repo"].add(user_id, title, sent.audio.file_id, audio.duration, url)
    except FetchError as e:
        await msg.reply_text(f"❌ 받지 못했어요: {url} ({e})")
        return
    except TimedOut:
        logging.exception("upload timed out: %s", url)
        await msg.reply_text(f"❌ 받지 못했어요: {url} (텔레그램 응답이 늦어요. 잠시 뒤 다시 보내주세요)")
        return
    except Exception:
        logging.exception("download failed: %s", url)
        await msg.reply_text(f"❌ 받지 못했어요: {url} (알 수 없는 오류)")
        return
    await _reply(update, context, f"✅ 추가됨: {title}")


async def on_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    urls = extract_youtube_urls(update.effective_message.text)
    if not urls:
        await update.effective_message.reply_text("유튜브 링크나 음원 파일만 받을 수 있어요")
    elif len(urls) > MAX_LINKS:
        await update.effective_message.reply_text(f"링크는 한 번에 {MAX_LINKS}개까지 넣을 수 있어요")
    else:
        for url in urls:
            await add_url(update, context, url)


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
    context.bot_data["repo"].add(update.effective_user.id, title, media.file_id, duration, None)
    await _reply(update, context, f"✅ 추가됨: {title}")


async def on_web_app_data(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    try:
        action = parse_action(update.effective_message.web_app_data.data)
    except PayloadError as e:
        await _reply(update, context, str(e))
        return
    context.bot_data["repo"].apply_order(update.effective_user.id, action.order, action.removed)
    await _reply(update, context, "✅ 저장했어요")
    if action.play:
        await play(update, context)
    for url in action.add:
        context.application.create_task(add_url(update, context, url))


async def on_unauthorized(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.effective_message:
        await update.effective_message.reply_text("사용 권한이 없어요")


def build_app(cfg: Config, repo: TrackRepo) -> Application:
    app = (
        Application.builder()
        .token(cfg.bot_token)
        .concurrent_updates(True)
        .media_write_timeout(120)
        .build()
    )
    app.bot_data.update(cfg=cfg, repo=repo, lock=asyncio.Lock())
    allowed = filters.User(user_id=cfg.allowed_user_ids)
    is_audio = filters.AUDIO | filters.Document.Category("audio/")
    commands = allowed & filters.UpdateType.MESSAGE
    app.add_handler(CommandHandler("start", start, filters=commands))
    app.add_handler(CommandHandler("list", list_tracks, filters=commands))
    app.add_handler(CommandHandler("play", play, filters=commands))
    app.add_handler(MessageHandler(allowed & filters.StatusUpdate.WEB_APP_DATA, on_web_app_data))
    app.add_handler(MessageHandler(allowed & filters.UpdateType.MESSAGE & is_audio, on_audio))
    app.add_handler(MessageHandler(allowed & filters.UpdateType.MESSAGE & filters.TEXT & ~filters.COMMAND, on_text))
    app.add_handler(MessageHandler(filters.ALL & ~allowed, on_unauthorized))
    return app
