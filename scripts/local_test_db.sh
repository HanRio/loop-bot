#!/usr/bin/env bash
# 테스트 전용 로컬 Postgres를 켜고 스키마를 맞춘다. 127.0.0.1에서만 받고, 데이터는 실제 DB와 무관하다.
# 사용: eval "$(scripts/local_test_db.sh)" 뒤에 pytest 또는 deno test
set -euo pipefail
# 시스템 로케일이 ko_KR이면 서버가 시작하지 못한다.
export LC_ALL=en_US.UTF-8

PG_BIN="$(brew --prefix postgresql@17)/bin"
DATA_DIR="${LOOPBOT_TEST_PGDATA:-$HOME/.local/share/loopbot-test-pg}"
PORT="${LOOPBOT_TEST_PGPORT:-55432}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -f "$DATA_DIR/PG_VERSION" ]; then
  mkdir -p "$DATA_DIR"
  "$PG_BIN/initdb" -D "$DATA_DIR" -U postgres --auth=trust -E UTF8 --locale=en_US.UTF-8 >/dev/null
fi
if ! "$PG_BIN/pg_ctl" -D "$DATA_DIR" status >/dev/null 2>&1; then
  "$PG_BIN/pg_ctl" -D "$DATA_DIR" -l "$DATA_DIR/server.log" -w \
    -o "-p $PORT -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off" start >/dev/null
fi

psql_admin() { "$PG_BIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
if ! psql_admin -d postgres -tAc "select 1 from pg_database where datname = 'loopbot_test'" | grep -q 1; then
  psql_admin -d postgres -c "create database loopbot_test" >/dev/null
fi
for file in "$ROOT"/supabase/migrations/*.sql; do
  psql_admin -d loopbot_test -f "$file" >/dev/null 2>&1 || { echo "마이그레이션 실패: $file" >&2; exit 1; }
done

echo "export LOOPBOT_TEST_DATABASE_URL=postgresql://loopbot_app@127.0.0.1:$PORT/loopbot_test"
