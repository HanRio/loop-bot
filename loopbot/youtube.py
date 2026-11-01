from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yt_dlp
from yt_dlp.utils import DownloadError, ExtractorError

MAX_DURATION = 3600
MAX_BYTES = 49 * 1024 * 1024

_MSG_NOT_DOWNLOADED = "영상을 받지 못했어요"


class FetchError(Exception):
    pass


@dataclass(frozen=True)
class Audio:
    path: Path
    title: str
    duration: int | None
    performer: str | None


def check_limits(info: Mapping[str, Any]) -> None:
    duration = info.get("duration")
    if duration is not None and duration > MAX_DURATION:
        raise FetchError("너무 길어요 (최대 60분)")
    if info.get("is_live"):
        raise FetchError("라이브 방송은 받을 수 없어요")


def _download_error_message(exc: Exception) -> str:
    text = str(exc)
    if "Sign in to confirm" in text:
        return "유튜브가 서버 접근을 막았어요 (쿠키 필요)"
    if "Private video" in text:
        return "비공개 영상이에요"
    return _MSG_NOT_DOWNLOADED


def fetch_audio(url: str, workdir: Path, cookies: str | None) -> Audio:
    opts: dict[str, Any] = {
        "format": "bestaudio[ext=m4a]/bestaudio",
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "m4a"}],
        "outtmpl": str(workdir / "%(id)s.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
    }
    if cookies:
        opts["cookiefile"] = cookies

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
            check_limits(info)
            ydl.download([url])
    except (DownloadError, ExtractorError) as exc:
        raise FetchError(_download_error_message(exc)) from exc

    files = sorted(workdir.glob("*.m4a"))
    if not files:
        raise FetchError(_MSG_NOT_DOWNLOADED)
    path = files[0]
    if path.stat().st_size > MAX_BYTES:
        raise FetchError("파일이 너무 커요 (최대 49MB)")

    duration = info.get("duration")
    return Audio(
        path=path,
        title=info.get("title") or "제목 없음",
        duration=int(duration) if duration is not None else None,
        performer=info.get("uploader") or info.get("channel"),
    )
