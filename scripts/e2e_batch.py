"""Send URLs through on_text with the real bot and a temp SQLite store.

Usage: python -m scripts.e2e_batch URL [URL ...]   (posts to the first ALLOWED_USER_IDS chat)
"""
import asyncio
import logging
import sys
import tempfile
from datetime import datetime, timezone
from types import SimpleNamespace

from dotenv import dotenv_values
from telegram import Bot, Chat, Message, Update, User

from loopbot.config import load_config
from loopbot.handlers import on_text
from loopbot.store.sqlite import SqliteStore

logging.basicConfig(level=logging.WARNING)


async def main(urls: list[str]) -> None:
    cfg = load_config(dotenv_values(".env"))
    user_id = next(iter(cfg.allowed_user_ids))
    with tempfile.TemporaryDirectory() as d:
        store = SqliteStore(f"{d}/t.db")
        async with Bot(cfg.bot_token) as bot:
            user = User(user_id, "me", False)
            msg = Message(1, datetime.now(timezone.utc), Chat(user_id, Chat.PRIVATE), from_user=user,
                          text="\n".join(urls))
            msg.set_bot(bot)
            context = SimpleNamespace(bot=bot, bot_data={"cfg": cfg, "store": store, "lock": asyncio.Lock()})
            await on_text(Update(1, message=msg), context)
        by_id = {t.id: t.title for t in store.library(user_id)}
        for playlist in store.playlists(user_id):
            print(f"{playlist.name}: {len(playlist.track_ids)}", [by_id[i] for i in playlist.track_ids])
        store.close()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    asyncio.run(main(sys.argv[1:]))
