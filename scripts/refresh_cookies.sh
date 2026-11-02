#!/usr/bin/env bash
# Re-export YouTube cookies from the dedicated Brave profile and install them on the server.
# Run on the Mac with that Brave window closed. LOOPBOT_SERVER (user@host) comes from .env.
set -euo pipefail
cd "$(dirname "$0")/.."

PROFILE="$HOME/.loopbot-brave/Default"
KEY="$HOME/.ssh/oracle-loopbot.key"
TEST_URL="https://www.youtube.com/watch?v=jNQXAC9IVRw"
SERVER="$(sed -n 's/^LOOPBOT_SERVER=//p' .env)"

if [ -z "$SERVER" ]; then
  echo ".env에 LOOPBOT_SERVER=user@host를 넣어주세요" >&2
  exit 1
fi
if [ ! -d "$PROFILE" ]; then
  echo "전용 Brave 프로필이 없어요. 먼저 로그인하세요:" >&2
  echo "open -na \"Brave Browser\" --args --user-data-dir=\"$HOME/.loopbot-brave\"" >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
.venv/bin/yt-dlp -q --cookies-from-browser "brave:$PROFILE" --cookies "$WORK/all.txt" --skip-download "$TEST_URL"

# The export holds every site in the profile; only YouTube and Google logins go to the server.
awk -F'\t' '/^# /{print; next} $1 ~ /(^|\.)(youtube|google)\.com$/ {print}' "$WORK/all.txt" > "$WORK/cookies.txt"
if ! grep -q 'youtube\.com' "$WORK/cookies.txt"; then
  echo "유튜브 쿠키가 없어요. 전용 Brave 창에서 부계정으로 로그인했는지 확인하세요" >&2
  exit 1
fi

scp -q -i "$KEY" "$WORK/cookies.txt" "${SERVER}:loop-bot/cookies.new"
ssh -i "$KEY" -o BatchMode=yes "$SERVER" "cd loop-bot && chmod 600 cookies.new && PATH=/usr/local/bin:\$PATH .venv/bin/yt-dlp -q --no-warnings --cookies cookies.new --skip-download '$TEST_URL' && mv cookies.new cookies.txt"
echo "✅ 서버 쿠키를 새로 넣었어요. 재시작은 필요 없어요"
