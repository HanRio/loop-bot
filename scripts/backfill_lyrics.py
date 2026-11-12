"""Fill track_lyrics for tracks that have no row yet.

Usage: python -m scripts.backfill_lyrics [--schema loopbot|loopbot_test] [--dry-run]   (reads DATABASE_URL from .env)
"""
import argparse
import time

from dotenv import dotenv_values

from loopbot import lyrics
from loopbot.config import load_config
from loopbot.store.postgres import PostgresStore

PAUSE_SECONDS = 1
MISSING = (
    "SELECT t.id, t.title, t.duration FROM tracks t "
    "LEFT JOIN track_lyrics l ON l.track_id = t.id WHERE l.track_id IS NULL ORDER BY t.id"
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--schema", choices=("loopbot", "loopbot_test"), default="loopbot")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    cfg = load_config(dotenv_values(".env"))
    store = PostgresStore(cfg.database_url, schema=args.schema)
    try:
        rows = store._run(lambda cur: cur.execute(MISSING).fetchall())
        for index, (track_id, title, duration) in enumerate(rows):
            if args.dry_run:
                print(f"{track_id} (dry-run)")
                continue
            if index:
                time.sleep(PAUSE_SECONDS)
            found = lyrics.search(title, None, duration)
            store.save_lyrics(track_id, found)
            print(f"{track_id} {'찾음' if found else '없음'}")
    finally:
        store.close()


if __name__ == "__main__":
    main()
