#!/usr/bin/env bash
# Hot-reloading development loop for herdr-code.
#
#   ./scripts/dev.sh
#
# Frontend: Vite dev server with HMR, proxying /api and /ws to the Go server.
# Backend:  the server is rebuilt and restarted whenever a .go file changes,
#           then the browser tab is reloaded (xterm websockets cannot survive
#           a server restart, so the client has to reconnect from scratch).
#
# Environment:
#   HERDR_DEV_ADDR     Go server listen address (default 127.0.0.1:7681)
#   HERDR_DEV_PORT     Vite port (default 5199)
#   HERDR_DEV_SOCKET   optional --socket passed to the Go server
#   HERDR_DEV_NO_RELOAD=1  do not touch web/src/main.tsx after a restart
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
addr=${HERDR_DEV_ADDR:-127.0.0.1:7681}
port=${HERDR_DEV_PORT:-5199}
bin=/tmp/herdr-code-dev
log=/tmp/herdr-code-dev-server.log
pid=""
vite_pid=""

cleanup() {
  trap - INT TERM EXIT
  [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
  [[ -n "$vite_pid" ]] && kill "$vite_pid" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# macOS stat is -f, GNU coreutils is -c.
fingerprint() {
  local find_args=("$root/cmd" "$root/internal" "$root/embed.go" -name '*.go')
  if stat -f '%Fm' /dev/null >/dev/null 2>&1; then
    find "${find_args[@]}" -type f -exec stat -f '%Fm %z %N' {} + 2>/dev/null | sort | cksum
  else
    find "${find_args[@]}" -type f -exec stat -c '%Y %s %n' {} + 2>/dev/null | sort | cksum
  fi
}

start_server() {
  if ! (cd "$root" && go build -o "$bin" ./cmd/herdr-code); then
    printf '\033[31m[dev] build failed — keeping the previous server\033[0m\n'
    return 1
  fi
  if [[ -n "$pid" ]]; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
  local -a args
  args=(--addr "$addr")
  if [[ -n "${HERDR_DEV_SOCKET:-}" ]]; then
    args+=(--socket "$HERDR_DEV_SOCKET")
  fi
  (cd "$root" && exec "$bin" "${args[@]}") >>"$log" 2>&1 &
  pid=$!
  for _ in $(seq 1 50); do
    if curl -sf "http://$addr/api/health" >/dev/null 2>&1; then
      printf '\033[32m[dev] server ready on http://%s (pid %s)\033[0m\n' "$addr" "$pid"
      return 0
    fi
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.1
  done
  printf '\033[31m[dev] server did not become healthy — see %s\033[0m\n' "$log"
  return 1
}

reload_browser() {
  [[ "${HERDR_DEV_NO_RELOAD:-}" == "1" ]] && return 0
  # Touch the entry module: Vite has no hot boundary above it, so it full-reloads
  # the page and every terminal websocket re-attaches to the new server.
  if ! touch "$root/web/src/main.tsx"; then
    printf '\033[33m[dev] could not touch web/src/main.tsx to trigger reload\033[0m\n'
  fi
}

printf '\033[36m[dev] building server…\033[0m\n'
start_server || exit 1

if [[ -d "$root/web/node_modules" ]]; then
  (cd "$root/web" && HERDR_DEV_BACKEND="http://$addr" HERDR_DEV_PORT="$port" npm run dev -- --port "$port") &
  vite_pid=$!
else
  printf '\033[33m[dev] web/node_modules missing — run `cd web && npm install` first\033[0m\n'
  exit 1
fi

printf '\033[36m[dev] watching cmd/ internal/ for changes (Ctrl-C to stop)\033[0m\n'
last=$(fingerprint)
while sleep 1; do
  kill -0 "$vite_pid" 2>/dev/null || { printf '\033[31m[dev] vite exited\033[0m\n'; exit 1; }
  current=$(fingerprint)
  [[ "$current" == "$last" ]] && continue
  last=$current
  printf '\033[36m[dev] go change detected — rebuilding\033[0m\n'
  if start_server; then
    reload_browser
  fi
done
