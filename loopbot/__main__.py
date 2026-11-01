import logging
import os
import sys

from dotenv import load_dotenv

from loopbot.config import load_config
from loopbot.handlers import build_app
from loopbot.store import open_store


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    logging.getLogger("httpx").setLevel(logging.WARNING)  # request URLs contain the bot token
    load_dotenv()
    try:
        cfg = load_config(os.environ)
    except ValueError as e:
        print(e)
        sys.exit(1)
    build_app(cfg, open_store(cfg)).run_polling()


if __name__ == "__main__":
    main()
