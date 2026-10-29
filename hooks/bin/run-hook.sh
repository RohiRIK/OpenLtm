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

# settings.json "env" values never pass through a shell: expand a leading ~/
# so LTM_DB_PATH="~/…" doesn't name a directory "~" in the project.
case "${LTM_DB_PATH:-}" in
  "~") LTM_DB_PATH=$HOME; export LTM_DB_PATH ;;
  "~/"*) LTM_DB_PATH="$HOME/${LTM_DB_PATH#"~/"}"; export LTM_DB_PATH ;;
esac

BUN=""
for candidate in \
  "/opt/homebrew/bin/bun" \
  "/usr/local/bin/bun" \
  "$HOME/.bun/bin/bun" \
  "$HOME/.volta/bin/bun" \
  "$HOME/.asdf/shims/bun"
do
  if [ -x "$candidate" ]; then
    BUN=$candidate
    break
  fi
done

# ── Slow path: source shell profile and retry ─────────────────────────────────
# Profiles are the user's code, not ours: `set -u` would abort this hook on any
# unset variable they read, and anything they print would land in the hook's
# stdout (which SessionStart injects into the session). Relax and silence them.
if [ -z "$BUN" ]; then
  set +u
  [ -f "$HOME/.zprofile" ]      && . "$HOME/.zprofile" >/dev/null 2>&1
  [ -f "$HOME/.bash_profile" ]  && . "$HOME/.bash_profile" >/dev/null 2>&1
  [ -f "$HOME/.profile" ]       && . "$HOME/.profile" >/dev/null 2>&1
  BUN=$(command -v bun 2>/dev/null)
fi

# ── Not found ─────────────────────────────────────────────────────────────────
if [ -z "$BUN" ]; then
  echo "LTM hook error: bun not found. Install bun or ensure it is in one of:" >&2
  echo "  /opt/homebrew/bin/bun  /usr/local/bin/bun  ~/.bun/bin/bun  ~/.volta/bin/bun  ~/.asdf/shims/bun" >&2
  exit 127
fi

# ── Packages ──────────────────────────────────────────────────────────────────
# Claude Code skips installing the plugin's packages (its bun.lock lists more
# than one workspace), so install them on first use — see scripts/ensure-deps.ts.
# SessionStart waits for the install; other hooks give it a moment, then skip
# this run quietly rather than crash.
if [ -n "$PLUGIN_ROOT" ] && [ -f "$PLUGIN_ROOT/scripts/plugin-runtime.ts" ] && {
  [ -n "${PLUGIN_DATA:-}" ] ||
  case "$PLUGIN_ROOT" in "${CODEX_HOME:-$HOME/.codex}"/plugins/cache/*) true ;; *) false ;; esac ||
  [ ! -f "$PLUGIN_ROOT/node_modules/@rohirik/openltm-core/package.json" ] || [ -d "$PLUGIN_ROOT/.deps-install.lock" ]
}; then
  case "${1:-}" in
    */SessionStart.ts) WAIT_MS=12000 ;;
    *) WAIT_MS=2000 ;;
  esac
  RUNTIME=$("$BUN" --no-env-file --config="$BUNFIG" "$PLUGIN_ROOT/scripts/plugin-runtime.ts" "$PLUGIN_ROOT" --wait-ms "$WAIT_MS") || exit 0
  if [ "$RUNTIME" != "$PLUGIN_ROOT" ]; then
    HOOK_DIR=$(CDPATH= cd -- "$(dirname -- "${1:-}")" 2>/dev/null && pwd -P)
    HOOK_PATH="$HOOK_DIR/$(basename -- "${1:-}")"
    case "$HOOK_PATH" in
      "$PLUGIN_ROOT"/*) HOOK="$RUNTIME/${HOOK_PATH#"$PLUGIN_ROOT"/}"; shift; set -- "$HOOK" "$@" ;;
    esac
    CLAUDE_PLUGIN_ROOT=$RUNTIME
    CLAUDE_PLUGIN_DATA=${PLUGIN_DATA:-${CLAUDE_PLUGIN_DATA:-}}
    LTM_CODEX_RUNTIME=$RUNTIME
    export CLAUDE_PLUGIN_ROOT CLAUDE_PLUGIN_DATA LTM_CODEX_RUNTIME
    BUNFIG="$RUNTIME/bunfig.toml"
    [ -f "$BUNFIG" ] || BUNFIG=/dev/null
  fi
fi

exec "$BUN" --no-env-file --config="$BUNFIG" run "$@"
