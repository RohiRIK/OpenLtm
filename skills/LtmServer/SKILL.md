---
name: LtmServer
description: "Start, stop, or check the LTM graph visualization server; use when the user asks to open, launch, stop, kill, or check graph-server status."
disable-model-invocation: true
user-invocable: false
version: 1.1.0
---

# LTM Graph Server

Obsidian-style force graph at **http://localhost:7332** visualizing `ltm.db`.

## Quick Reference

| Detail | Value |
|--------|-------|
| UI (Next.js) | `:7332` — open this in browser |
| API + WebSocket | `:7331` — Next.js proxies `/api/*` here |
| PID file | `~/.claude/tmp/ltm-server.pid` |
| Log file | `~/.claude/tmp/ltm-server.log` |
| Server | `${CLAUDE_PLUGIN_ROOT}/src/graph-server.ts` |
| UI source | `${CLAUDE_PLUGIN_ROOT}/graph-app/` |

## Routing

| User says | Action |
|-----------|--------|
| start / open / launch | → `Workflows/Start.md` |
| stop / kill / close | → `Workflows/Stop.md` |
| status / running? | Check PID file, report URL or "not running" |

## Status Check (inline)

```bash
PID_FILE="$HOME/.claude/tmp/ltm-server.pid"
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    echo "Running — PID $PID — http://localhost:7332 (Next.js) + http://localhost:7331 (API)"
  else
    echo "Not running (stale PID file)"
  fi
else
  echo "Not running"
fi
```
