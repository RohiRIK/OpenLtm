# Janitor without graph-server

The janitor keeps the memory database healthy. It runs the same five steps whether it is started from the CLI, a hook, a timer, or graph-server:

1. **Embed backfill** — vectors for memories that have none (local llama.cpp by default; skipped when the server is down).
2. **Decay** — refreshes `decay_score`, deprecates stale low-importance memories.
3. **Archive** — moves dead deprecated memories into `memory_archive`.
4. **Promote** — turns eligible `context_items` into pending memories.
5. **Dedup suggestions** — near-duplicate pairs become *pending* review rows (`source = dedup:<a>:<b>`). Nothing is merged, superseded, or deleted automatically. Review them in the graph app or with `/openltm:health`.

None of this needs graph-server or Honker. The CLI opens the SQLite file directly.

---

## Run it

```bash
bunx @rohirik/openltm-core janitor run            # one pass, human summary
bunx @rohirik/openltm-core janitor run --json     # machine-readable result
bunx @rohirik/openltm-core janitor run --if-due   # skip unless the interval has elapsed
bunx @rohirik/openltm-core janitor status         # last run, next due, pending suggestions, lock
```

From a clone: `bun packages/openltm-core/src/cli/bin.ts janitor run`.

**Which database.** `--db <path>` > `LTM_DB_PATH` > `$CLAUDE_PLUGIN_DATA/openltm.db` > dev fallback. This is the same resolution `ltm memory` and the adapters use. A Claude marketplace install keeps its DB at `~/.claude/plugins/data/OpenLtm-openltm/openltm.db`. If you run the janitor from a plain shell, point at that path with `--db` or `LTM_DB_PATH`.

**Interval.** `--interval-minutes` > `LTM_JANITOR_INTERVAL_MINUTES` > the `ltm.janitor.intervalMinutes` setting (when > 0) > **360 (6h)**. Only `--if-due` consults it.

**Exit codes**

| Code | Meaning |
|---|---|
| 0 | Run finished cleanly, or was skipped because it was not due |
| 1 | Usage error |
| 2 | Runtime error, a step reported an error, or `--max-minutes` (default 60) was exceeded |
| 3 | Database not found. The janitor never creates one. |
| 4 | Another janitor run holds the lock |

**Single instance.** Every standalone run takes `<db>.janitor.lock` (atomic `O_EXCL` create) and fails closed with exit 4 if it is held. A lock whose owner PID is dead, or that is older than 6h, is reclaimed. graph-server's own `POST /api/janitor/run` and in-process interval do not take this lock yet; avoid running both at once against the same DB.

### Verify with every server down

```bash
export LTM_DB_PATH=/tmp/ltm-janitor-demo.db
bunx @rohirik/openltm-core memory learn --text "janitor demo memory" --category pattern
LTM_LLAMA_CPP_URL=http://127.0.0.1:9 bunx @rohirik/openltm-core janitor run   # exit 0
bunx @rohirik/openltm-core janitor run --if-due                               # skipped, exit 0
bunx @rohirik/openltm-core janitor status
```

---

## On session end (hook)

**Claude Code plugin.** `hooks/hooks.json` wires `SessionEnd` to `hooks/src/SessionEnd.ts`. Dev installs get the same entry in `~/.claude/settings.json` via `scripts/install-wiring.ts`. The hook spawns a **detached** `ltm janitor run --if-due --quiet` against the hook's DB and exits immediately, so it never delays session shutdown.

**Any other hook host.** Call the portable entrypoint with the DB path in the environment:

```bash
LTM_DB_PATH=/path/to/openltm.db bunx @rohirik/openltm-core hook --name SessionEnd
```

Behaviour shared by both:
- Throttled by `--if-due`, so at most one pass per interval (6h by default) however many sessions end.
- One line per attempt is appended to `<db dir>/janitor.log`.
- If the DB does not exist, nothing is spawned.
- Opt out with `LTM_JANITOR_ON_SESSION_END=0`.

---

## In the background (Linux + macOS)

The background units wake up on a short **check** cadence (hourly by default, `--check-minutes`). Each wake-up runs `janitor run --if-due`, so the 6h **run** interval is the one rule shared by timers, hooks, and manual runs. No Honker binary is needed on any platform.

`ltm janitor schedule` prints a ready-to-use unit with absolute paths for bun, the CLI, and your DB. Add `--write` to put the files in place. It never runs `systemctl` or `launchctl` itself; it prints those commands for you to run.

Use a stable CLI path in a unit. A path inside the `bunx` cache can be cleaned up, so install the package (`bun add -g @rohirik/openltm-core`) or a clone and pass `--bin <path to cli/bin.ts>` if needed. The command warns when it detects a cache path.

### Linux — systemd user timer

```bash
ltm janitor schedule systemd --db ~/.claude/plugins/data/OpenLtm-openltm/openltm.db --write
systemctl --user daemon-reload
systemctl --user enable --now openltm-janitor.timer
systemctl --user list-timers openltm-janitor.timer
loginctl enable-linger "$USER"     # optional: keep running while logged out
journalctl --user -u openltm-janitor.service   # logs
```

This writes `~/.config/systemd/user/openltm-janitor.{service,timer}`. The service is `Type=oneshot` with `Nice=10`, idle IO, and `SuccessExitStatus=4` (lock held is not a failure). The timer is `Persistent=true`, so missed checks run after resume.

Undo: `systemctl --user disable --now openltm-janitor.timer`, then remove the two files and `daemon-reload`.

### macOS — launchd agent

```bash
ltm janitor schedule launchd --db ~/.claude/plugins/data/OpenLtm-openltm/openltm.db --write
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.rohirik.openltm.janitor.plist
launchctl print gui/$(id -u)/com.rohirik.openltm.janitor | head -20
tail -f ~/Library/Logs/openltm-janitor.log
```

`StartInterval` is the check cadence; `RunAtLoad` checks once at login. Undo: `launchctl bootout gui/$(id -u)/com.rohirik.openltm.janitor`, then remove the plist.

### cron (either OS)

```bash
ltm janitor schedule cron --db /path/to/openltm.db   # prints one crontab line; add it with `crontab -e`
```

### No init system (containers, tmux)

```bash
ltm janitor daemon --db /path/to/openltm.db --check-minutes 60
```

This is a foreground loop that does `run --if-due` on every tick. Stop it with Ctrl-C or SIGTERM. If the DB is missing it exits 3; if the lock is held it logs and retries on the next tick.

---

## See also

- [Hooks](06-hooks.md) · [Configuration](04-configuration.md) · [Troubleshooting](09-troubleshooting.md)
