#!/bin/bash
# PostgreSQL 17.5 + pgvector, downloaded once and run as a child process — no Docker.
#
#   scripts/pg.sh setup    fetch the binaries and create the cluster (idempotent)
#   scripts/pg.sh start | stop | status | psql | destroy
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PG_HOME="${PG_HOME:-$REPO_DIR/.pg}"
PG_BIN="$PG_HOME/dist/bin"
PG_DATA="$PG_HOME/data"
PG_PORT="${PG_PORT:-5433}"
PG_USER="pdf2audio"
PG_DB="pdf2audio"
PG_LOG="$PG_HOME/postgres.log"

RELEASE="v0.2.1"
# The `full` build of this release links Homebrew's icu4c, which is exactly the prerequisite
# shipping our own Postgres is meant to remove. `lite` links nothing outside /usr/lib.
VARIANT="lite"

case "$(uname -s)/$(uname -m)" in
  Darwin/arm64) PLATFORM="darwin-arm64" ;;
  Darwin/x86_64) PLATFORM="darwin-x64" ;;
  Linux/aarch64|Linux/arm64) PLATFORM="linux-arm64" ;;
  Linux/x86_64) PLATFORM="linux-x64" ;;
  *) echo "No prebuilt PostgreSQL for $(uname -s)/$(uname -m)"; exit 1 ;;
esac
URL="https://github.com/boomship/postgres-vector-embedded/releases/download/$RELEASE/postgres-$VARIANT-$PLATFORM.tar.gz"

# The published binaries record the build machine's absolute paths as their install names, so they
# run nowhere but the CI runner. DYLD_LIBRARY_PATH would mask it and must not be used — the
# hardened runtime strips DYLD_* — so rewrite the load commands to be relative instead. Anything
# absolute that is neither a system library nor present on disk is one of those stale paths.
relocate_macos() {
  local dist="$1"
  find "$dist/bin" "$dist/lib" -type f -print0 | while IFS= read -r -d '' f; do
    file "$f" | grep -q "Mach-O" || continue
    local id
    id=$(otool -D "$f" 2>/dev/null | tail -1)
    case "$id" in
      /*) [ -e "$id" ] || install_name_tool -id "@rpath/$(basename "$f")" "$f" 2>/dev/null || true ;;
    esac
    otool -L "$f" 2>/dev/null | tail -n +2 | awk '{print $1}' | while IFS= read -r dep; do
      case "$dep" in
        /usr/lib/*|/System/*|@*) continue ;;
        /*) [ -e "$dep" ] || install_name_tool -change "$dep" "@rpath/$(basename "$dep")" "$f" 2>/dev/null || true ;;
      esac
    done
    install_name_tool -add_rpath "@loader_path/../lib" "$f" 2>/dev/null || true
  done
}

setup() {
  if [ ! -x "$PG_BIN/postgres" ]; then
    echo "Downloading PostgreSQL 17.5 + pgvector ($PLATFORM)..."
    mkdir -p "$PG_HOME/dist"
    curl -fsSL "$URL" | tar -xz --strip-components=1 -C "$PG_HOME/dist"
    if [ "$(uname -s)" = "Darwin" ]; then relocate_macos "$PG_HOME/dist"; fi
    "$PG_BIN/postgres" --version
  fi

  if [ ! -f "$PG_DATA/PG_VERSION" ]; then
    echo "Creating the cluster..."
    "$PG_BIN/initdb" -D "$PG_DATA" -U "$PG_USER" --auth=trust --encoding=UTF8 >/dev/null
  fi

  start
  if ! "$PG_BIN/psql" -h 127.0.0.1 -p "$PG_PORT" -U "$PG_USER" -lqt | cut -d'|' -f1 | grep -qw "$PG_DB"; then
    "$PG_BIN/createdb" -h 127.0.0.1 -p "$PG_PORT" -U "$PG_USER" "$PG_DB"
    echo "Created database $PG_DB"
  fi
  echo "Ready: postgres://$PG_USER@localhost:$PG_PORT/$PG_DB"
}

start() {
  if "$PG_BIN/pg_ctl" -D "$PG_DATA" status >/dev/null 2>&1; then
    echo "Already running on port $PG_PORT"
    return
  fi
  # unix_socket_directories inside the data dir: the socket path is capped at 103 bytes and the
  # default /tmp is shared with any other Postgres on this machine.
  "$PG_BIN/pg_ctl" -D "$PG_DATA" -l "$PG_LOG" -w -o \
    "-p $PG_PORT -k $PG_DATA -c listen_addresses=127.0.0.1 -c max_connections=100 -c shared_buffers=512MB" start
}

case "${1:-}" in
  setup) setup ;;
  start) [ -f "$PG_DATA/PG_VERSION" ] || setup; start ;;
  stop) "$PG_BIN/pg_ctl" -D "$PG_DATA" -m fast stop 2>/dev/null || echo "Not running" ;;
  status) "$PG_BIN/pg_ctl" -D "$PG_DATA" status || true ;;
  psql) shift; exec "$PG_BIN/psql" -h 127.0.0.1 -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" "$@" ;;
  destroy)
    "$PG_BIN/pg_ctl" -D "$PG_DATA" -m immediate stop 2>/dev/null || true
    rm -rf "$PG_DATA" && echo "Cluster deleted; binaries kept. Run 'pnpm db:up' to start over." ;;
  *) sed -n '2,6p' "$0"; exit 1 ;;
esac
