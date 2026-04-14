#!/bin/sh
# run-hook.sh — Locate bun and run a hook TypeScript file.
# Called by hooks.json; the plugin system subprocess has a stripped PATH
# so we cannot rely on PATH lookup. Try well-known absolute locations first
# (fast, no shell startup overhead), then fall back to profile sourcing.
#
# Usage: run-hook.sh <hook.ts> [args...]
#
# Keep candidate list in sync with BUN_CANDIDATES in hooks/lib/pluginDoctor.ts
set -u

for candidate in \
  "/opt/homebrew/bin/bun" \
  "/usr/local/bin/bun" \
  "$HOME/.bun/bin/bun" \
  "$HOME/.volta/bin/bun" \
  "$HOME/.asdf/shims/bun"
do
  if [ -x "$candidate" ]; then
    exec "$candidate" run "$@"
  fi
done

# ── Slow path: source shell profile and retry ─────────────────────────────────
[ -f "$HOME/.zprofile" ]      && . "$HOME/.zprofile"
[ -f "$HOME/.bash_profile" ]  && . "$HOME/.bash_profile"
[ -f "$HOME/.profile" ]       && . "$HOME/.profile"

BUN=$(command -v bun 2>/dev/null)
if [ -n "$BUN" ]; then
  exec "$BUN" run "$@"
fi

# ── Not found ─────────────────────────────────────────────────────────────────
echo "LTM hook error: bun not found. Install bun or ensure it is in one of:" >&2
echo "  /opt/homebrew/bin/bun  /usr/local/bin/bun  ~/.bun/bin/bun  ~/.volta/bin/bun  ~/.asdf/shims/bun" >&2
exit 127
