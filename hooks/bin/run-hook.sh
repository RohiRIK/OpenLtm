#!/bin/sh
# run-hook.sh — Locate bun and run a hook TypeScript file.
# Called by hooks.json; the plugin system subprocess has a stripped PATH
# so we cannot rely on PATH lookup. Try well-known absolute locations first
# (fast, no shell startup overhead), then fall back to profile sourcing.
#
# Usage: run-hook.sh <hook.ts> [args...]
#
# --no-env-file: hooks run with the user's *project* as cwd; never let Bun
# auto-load that project's .env into LTM (it could redirect provider URLs or
# keys and leak memory text — security S6).
#
# --config: pin Bun to the plugin's own bunfig.toml. Otherwise Bun reads
# bunfig.toml from the project cwd, and a hostile `preload` there would run
# arbitrary code inside every LTM hook. If the plugin copy is missing, use an
# empty config (/dev/null) — never fall back to the project's.
#
# Keep candidate list in sync with BUN_CANDIDATES in hooks/lib/pluginDoctor.ts
set -u

PLUGIN_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." 2>/dev/null && pwd -P)
BUNFIG="$PLUGIN_ROOT/bunfig.toml"
if [ -z "$PLUGIN_ROOT" ] || [ ! -f "$BUNFIG" ]; then
  BUNFIG=/dev/null
fi

for candidate in \
  "/opt/homebrew/bin/bun" \
  "/usr/local/bin/bun" \
  "$HOME/.bun/bin/bun" \
  "$HOME/.volta/bin/bun" \
  "$HOME/.asdf/shims/bun"
do
  if [ -x "$candidate" ]; then
    exec "$candidate" --no-env-file --config="$BUNFIG" run "$@"
  fi
done

# ── Slow path: source shell profile and retry ─────────────────────────────────
# Profiles are the user's code, not ours: `set -u` would abort this hook on any
# unset variable they read, and anything they print would land in the hook's
# stdout (which SessionStart injects into the session). Relax and silence them.
set +u
[ -f "$HOME/.zprofile" ]      && . "$HOME/.zprofile" >/dev/null 2>&1
[ -f "$HOME/.bash_profile" ]  && . "$HOME/.bash_profile" >/dev/null 2>&1
[ -f "$HOME/.profile" ]       && . "$HOME/.profile" >/dev/null 2>&1

BUN=$(command -v bun 2>/dev/null)
if [ -n "$BUN" ]; then
  exec "$BUN" --no-env-file --config="$BUNFIG" run "$@"
fi

# ── Not found ─────────────────────────────────────────────────────────────────
echo "LTM hook error: bun not found. Install bun or ensure it is in one of:" >&2
echo "  /opt/homebrew/bin/bun  /usr/local/bin/bun  ~/.bun/bin/bun  ~/.volta/bin/bun  ~/.asdf/shims/bun" >&2
exit 127
