"""Drive on_web_app_data with the real bot against the Supabase test schema.

Usage: python -m scripts.e2e_webapp URL [URL ...]   (needs LOOPBOT_TEST_DATABASE_URL; posts to the first ALLOWED_USER_IDS chat)

Creates a playlist from the mini app payload, adds the URLs to it, plays it, then prints the stored state.
"""
import asyncio
import json
import logging
import os
import sys
from datetime import datetime, timezone
from types import SimpleNamespace

from dotenv import dotenv_values
from telegram import Bot, Chat, Message, Update, User, WebAppData

from loopbot.config import load_config
from loopbot.handlers import on_web_app_data
from loopbot.store.postgres import PostgresStore

logging.basicConfig(level=logging.WARNING)


async def main(urls: list[str]) -> None:
    env = dotenv_values(".env")
    cfg = load_config(env)
    user_id = next(iter(cfg.allowed_user_ids))
    store = PostgresStore(env.get("LOOPBOT_TEST_DATABASE_URL") or os.environ["LOOPBOT_TEST_DATABASE_URL"], schema="loopbot_test")
    store.reset()
    seed = store.add_track(user_id, "seed track", "unused-file-id", None, None)
    payload = {"v": 2, "playlist": None, "name": "e2e 플레이리스트", "tracks": [], "delete_tracks": [seed.id],
               "delete_playlist": False, "add": urls, "play": False}
    async with Bot(cfg.bot_token) as bot:
        msg = Message(1, datetime.now(timezone.utc), Chat(user_id, Chat.PRIVATE), from_user=User(user_id, "me", False),
                      web_app_data=WebAppData(json.dumps(payload), "🎵 플레이리스트"))
        msg.set_bot(bot)
        app = SimpleNamespace(tasks=[])
        app.create_task = lambda coro: app.tasks.append(asyncio.ensure_future(coro))
        context = SimpleNamespace(bot=bot, application=app,
                                  bot_data={"cfg": cfg, "store": store, "lock": asyncio.Lock()})
        await on_web_app_data(Update(1, message=msg), context)
        await asyncio.gather(*app.tasks)
    by_id = {t.id: t.title for t in store.library(user_id)}
    for playlist in store.playlists(user_id):
        print(f"{playlist.name}: {[by_id[i] for i in playlist.track_ids]}")
    print("active:", store.active_playlist(user_id).name, "| seed deleted:", seed.id not in by_id)
    store.close()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    asyncio.run(main(sys.argv[1:]))
