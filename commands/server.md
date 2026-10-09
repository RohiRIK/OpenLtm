---
description: "Start, stop, or check the OpenLTM graph visualizer (UI on localhost:7332, API + WebSocket on localhost:7331). USE WHEN the user wants to open, launch, stop, kill, or check the memory graph server."
argument-hint: "<start|stop|status>"
allowed-tools: ["Bash"]
---

Parse the first word of the arguments as `<action>`: `start`, `stop`, or `status`. No argument → `status`.

| Detail | Value |
|--------|-------|
| UI (Next.js) | http://localhost:7332 — open this in the browser |
| API + WebSocket (Bun) | http://localhost:7331 — the UI proxies `/api/*` here |
| Bind address | `127.0.0.1` only — not reachable from other machines |
| API server | `${CLAUDE_PLUGIN_ROOT}/src/graph-server.ts` |
| UI source | `${CLAUDE_PLUGIN_ROOT}/graph-app/` |
| PID / logs | `~/.claude/tmp/ltm-server.pid`, `~/.claude/tmp/ltm-server.log`, `~/.claude/tmp/nextjs.log` |

---

## status

```bash
PID_FILE="$HOME/.claude/tmp/ltm-server.pid"
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "API: running (PID $(cat "$PID_FILE"))"
elif curl -s -o /dev/null --max-time 2 http://127.0.0.1:7331/api/stats; then
  echo "API: responding on :7331 (no PID file)"
else
  echo "API: not running"
fi
if curl -s -o /dev/null --max-time 2 http://127.0.0.1:7332; then
  echo "UI:  running — http://localhost:7332"
else
  echo "UI:  not running"
fi
```

Report the result in one line. If both are down, suggest `/openltm:server start`.

---

## start

**1 — Clear anything stale on 7331 / 7332:**

```bash
PID_FILE="$HOME/.claude/tmp/ltm-server.pid"
[ -f "$PID_FILE" ] && kill "$(cat "$PID_FILE")" 2>/dev/null
rm -f "$PID_FILE"
for port in 7331 7332; do
  lsof -ti ":$port" 2>/dev/null | xargs kill 2>/dev/null || true
done
mkdir -p "$HOME/.claude/tmp"
```

**2 — Start the API server (port 7331):**

```bash
nohup bun "${CLAUDE_PLUGIN_ROOT}/src/graph-server.ts" \
  > "$HOME/.claude/tmp/ltm-server.log" 2>&1 &
sleep 1
curl -s -o /dev/null --max-time 3 http://127.0.0.1:7331/api/stats \
  && echo "API up on http://localhost:7331" \
  || { echo "API failed to start — last log lines:"; tail -n 20 "$HOME/.claude/tmp/ltm-server.log"; }
```

The server writes its own PID to `~/.claude/tmp/ltm-server.pid`. Stop here if the API failed and show the log.

**3 — Start the UI (port 7332, loopback only):**

```bash
(
  cd "${CLAUDE_PLUGIN_ROOT}/graph-app" || exit 1
  [ -d node_modules ] || bun install --frozen-lockfile || bun install
  if [ -f .next/BUILD_ID ]; then MODE=start; else MODE=dev; fi
  nohup env NEXT_PUBLIC_WS_URL=ws://localhost:7331 \
    ./node_modules/.bin/next "$MODE" --hostname 127.0.0.1 --port 7332 \
    > "$HOME/.claude/tmp/nextjs.log" 2>&1 &
  echo "UI starting in $MODE mode (log: ~/.claude/tmp/nextjs.log)"
)
```

A production build (`bun run build` in `graph-app/`) starts faster; without one the dev server compiles on first load (~5–10 s).

**4 — Open the browser:**

```bash
URL="http://localhost:7332"
(command -v open >/dev/null && open "$URL") || (command -v xdg-open >/dev/null && xdg-open "$URL") || echo "Open $URL"
```

Report: `Graph server running — UI http://localhost:7332 · API http://localhost:7331`.

---

## stop

```bash
PID_FILE="$HOME/.claude/tmp/ltm-server.pid"
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  kill "$PID" 2>/dev/null && echo "Stopped API (PID $PID)" || echo "PID $PID was not running"
  rm -f "$PID_FILE"
fi
for port in 7331 7332; do
  lsof -ti ":$port" 2>/dev/null | xargs kill 2>/dev/null || true
done
echo "OpenLTM graph server stopped."
```

If a port is still held after a few seconds, re-run `stop`; only then fall back to `kill -9` on the PID that `lsof -ti :<port>` prints.
