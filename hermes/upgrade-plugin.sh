#!/usr/bin/env bash
# upgrade-plugin.sh — update the installed Hermes plugin from this checkout,
# whether it was installed as a copied directory or as a symlink.
#
#   hermes/upgrade-plugin.sh --check        report how it is installed and which version
#   hermes/upgrade-plugin.sh                upgrade it to this checkout's version
#   hermes/upgrade-plugin.sh --link         replace a copied install with a symlink to this checkout
#   hermes/upgrade-plugin.sh --pull         symlinked install: also `git pull --ff-only` the checkout it points at
#   hermes/upgrade-plugin.sh --dry-run      print what would change, change nothing
#   hermes/upgrade-plugin.sh --plugin-dir DIR   default: $HERMES_HOME/plugins/openltm (HERMES_HOME defaults to ~/.hermes)
#
# A copied install is replaced, never edited in place, and the old copy is kept
# under $HERMES_HOME/plugin-backups/ (outside plugins/, so Hermes never loads it).
# A symlinked install is never deleted or copied over: it is updated by updating
# the checkout it points at. Plugin settings (openltm.json) and the DB live in
# $HERMES_HOME, not in the plugin dir, so neither is touched.
#
# At most $OPENLTM_KEEP_BACKUPS (default 5) plugin backups are kept; a copied
# install identical to this source is left alone (no backup is made).
#
# Exit codes: 0 done / up to date, 1 error, 3 (--check) install missing or outdated.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$SCRIPT_DIR/openltm_hermes"
: "${HOME:?HOME is not set}"
HERMES_HOME="${HERMES_HOME-$HOME/.hermes}"
case "$HERMES_HOME" in
  ""|*[!/]*) ;;
  *) HERMES_HOME="" ;;
esac
case "$HERMES_HOME" in
  "") echo "error: refusing an empty or / HERMES_HOME" >&2; exit 1 ;;
esac
KEEP_BACKUPS="${OPENLTM_KEEP_BACKUPS:-5}"
case "$KEEP_BACKUPS" in ''|*[!0-9]*) echo "error: OPENLTM_KEEP_BACKUPS must be a number" >&2; exit 1 ;; esac
PLUGIN_DIR=""
MODE="upgrade"
DRY_RUN=0
PULL=0

usage() { sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --check) MODE="check" ;;
    --link) MODE="link" ;;
    --pull) PULL=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --plugin-dir) shift; PLUGIN_DIR="${1:?--plugin-dir needs a path}" ;;
    --plugin-dir=*) PLUGIN_DIR="${1#*=}" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
  shift
done

PLUGIN_DIR="${PLUGIN_DIR:-$HERMES_HOME/plugins/openltm}"
PLUGIN_DIR="${PLUGIN_DIR%/}"
BACKUP_ROOT="$HERMES_HOME/plugin-backups"

die() { echo "error: $*" >&2; exit 1; }
run() { if [ "$DRY_RUN" = 1 ]; then echo "would run: $*"; else "$@"; fi; }

# realpath that also works on macOS without GNU coreutils.
real_path() { python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$1"; }

# `version: "x.y.z"` from a plugin.yaml, or "unknown".
yaml_version() {
  local v=""
  [ -f "$1/plugin.yaml" ] && v="$(sed -n 's/^version:[[:space:]]*"\{0,1\}\([^"[:space:]]*\)"\{0,1\}.*/\1/p' "$1/plugin.yaml" | head -n 1)"
  echo "${v:-unknown}"
}

[ -f "$SOURCE_DIR/plugin.yaml" ] || die "no plugin source at $SOURCE_DIR (run this script from an OpenLtm checkout)"
SOURCE_VERSION="$(yaml_version "$SOURCE_DIR")"
SOURCE_REAL="$(real_path "$SOURCE_DIR")"

if [ -L "$PLUGIN_DIR" ]; then
  KIND="symlink"
elif [ -d "$PLUGIN_DIR" ]; then
  KIND="copy"
elif [ -e "$PLUGIN_DIR" ]; then
  die "$PLUGIN_DIR exists but is not a directory or symlink"
else
  KIND="missing"
fi

installed_version() { if [ "$KIND" = missing ]; then echo "none"; else yaml_version "$PLUGIN_DIR"; fi; }

echo "plugin dir:  $PLUGIN_DIR"
echo "install:     $KIND"
if [ "$KIND" = symlink ]; then
  TARGET_REAL="$(real_path "$PLUGIN_DIR")"
  echo "points at:   $TARGET_REAL"
  [ -d "$TARGET_REAL" ] || die "the symlink is broken: $TARGET_REAL does not exist"
fi
echo "installed:   $(installed_version)"
echo "this source: $SOURCE_VERSION ($SOURCE_DIR)"
LEGACY_DIR="$HERMES_HOME/plugins/openltm_hermes"
if [ -e "$LEGACY_DIR" ] && [ "$LEGACY_DIR" != "$PLUGIN_DIR" ]; then
  echo "warning:     legacy plugin dir $LEGACY_DIR also exists; remove it so Hermes loads only one copy" >&2
fi

# A backup path that does not exist yet (mv into an existing dir would nest).
new_backup_path() {
  local base path n=1
  base="$BACKUP_ROOT/openltm-$(date +%Y%m%d-%H%M%S)"
  path="$base"
  while [ -e "$path" ]; do n=$((n + 1)); path="$base-$n"; done
  echo "$path"
}

# --- symlinked install: update the checkout it points at -------------------
upgrade_symlink() {
  local repo
  if [ "$TARGET_REAL" = "$SOURCE_REAL" ]; then
    echo "The symlink points at this checkout, so it already runs this source."
  fi
  if ! repo="$(git -C "$TARGET_REAL" rev-parse --show-toplevel 2>/dev/null)"; then
    [ "$PULL" = 1 ] && die "--pull: $TARGET_REAL is not inside a git checkout; update it by hand"
    echo "The symlink target is not inside a git checkout; update $TARGET_REAL by hand."
    return 0
  fi
  echo "checkout:    $repo ($(git -C "$repo" rev-parse --abbrev-ref HEAD) @ $(git -C "$repo" rev-parse --short HEAD))"
  if [ "$PULL" = 1 ]; then
    [ -z "$(git -C "$repo" status --porcelain)" ] || die "checkout $repo has uncommitted changes; commit or stash first"
    run git -C "$repo" pull --ff-only
  elif [ "$TARGET_REAL" != "$SOURCE_REAL" ]; then
    echo "Update that checkout (git -C $repo pull --ff-only), or re-run with --pull."
  fi
}

# Keep only the newest $KEEP_BACKUPS backups made by this script (names sort by
# time). Only directories named exactly openltm-YYYYMMDD-HHMMSS[-N] are touched,
# and the backup passed as $1 (the one just made) is never deleted, even when
# OPENLTM_KEEP_BACKUPS=0.
prune_backups() {
  local keep_path="${1:-}" all n i=0 b
  [ -d "$BACKUP_ROOT" ] || return 0
  # Portable (no GNU-only find flags, works on macOS): match names with bash [[ =~ ]].
  local re='^openltm-[0-9]{8}-[0-9]{6}(-[0-9]+)?$' d
  all=""
  for d in "$BACKUP_ROOT"/openltm-*; do
    [ -d "$d" ] && [ ! -L "$d" ] || continue
    [[ "${d##*/}" =~ $re ]] || continue
    all+="$d"$'\n'
  done
  all="$(printf '%s' "$all" | sort -V)"
  [ -n "$all" ] || return 0
  n="$(printf '%s\n' "$all" | wc -l)"
  while IFS= read -r b; do
    [ $((n - i)) -gt "$KEEP_BACKUPS" ] || break
    i=$((i + 1))
    [ -n "$keep_path" ] && [ "$b" = "$keep_path" ] && continue
    case "$b" in "$BACKUP_ROOT"/openltm-*) run rm -rf -- "$b" ;; esac
  done <<<"$all"
}

# True when the copied install matches the source (ignoring caches).
copy_is_current() {
  diff -rq -x __pycache__ -x .pytest_cache "$SOURCE_DIR" "$PLUGIN_DIR" >/dev/null 2>&1
}

# --- copied install: stage a fresh copy, back up the old one, swap ----------
install_copy() {
  local stage backup
  if [ "$KIND" = copy ] && copy_is_current; then
    echo "The copied install already matches this source; nothing to do."
    return 0
  fi
  stage="$BACKUP_ROOT/.staging-$$"
  backup="$(new_backup_path)"
  if [ "$DRY_RUN" = 1 ]; then
    [ "$KIND" = copy ] && echo "would move $PLUGIN_DIR to $backup"
    echo "would copy $SOURCE_DIR to $PLUGIN_DIR"
    return 0
  fi
  mkdir -p "$BACKUP_ROOT" "$(dirname "$PLUGIN_DIR")"
  rm -rf "$stage"
  cp -R "$SOURCE_DIR" "$stage"
  find "$stage" \( -name __pycache__ -o -name .pytest_cache \) -type d -prune -exec rm -rf {} +
  if [ "$KIND" = copy ]; then
    mv "$PLUGIN_DIR" "$backup"
    echo "backed up:   $backup"
  fi
  mv "$stage" "$PLUGIN_DIR"
  prune_backups "$backup"
}

link_to_source() {
  local backup
  backup="$(new_backup_path)"
  if [ "$KIND" = copy ]; then
    run mkdir -p "$BACKUP_ROOT"
    run mv "$PLUGIN_DIR" "$backup"
  fi
  run mkdir -p "$(dirname "$PLUGIN_DIR")"
  run ln -s "$SOURCE_REAL" "$PLUGIN_DIR"
  [ "$DRY_RUN" = 1 ] || prune_backups "$backup"
  if [ "$DRY_RUN" = 0 ] && [ "$KIND" = copy ]; then echo "backed up:   $backup"; fi
}

case "$MODE" in
  check)
    if [ "$KIND" = missing ]; then
      echo "status:      not installed"; exit 3
    elif [ "$(installed_version)" = "$SOURCE_VERSION" ]; then
      echo "status:      up to date"
    else
      echo "status:      outdated"; exit 3
    fi
    exit 0
    ;;
  link)
    if [ "$KIND" = symlink ] && [ "$TARGET_REAL" = "$SOURCE_REAL" ]; then
      echo "Already a symlink to this checkout."
    elif [ "$KIND" = symlink ]; then
      die "already a symlink to another checkout; remove it yourself (rm, not rm -r) if you want to relink"
    else
      link_to_source
    fi
    ;;
  upgrade)
    case "$KIND" in
      symlink) upgrade_symlink ;;
      copy|missing) install_copy ;;
    esac
    ;;
esac

if [ "$DRY_RUN" = 1 ]; then exit 0; fi
if [ -L "$PLUGIN_DIR" ]; then NOW_KIND=symlink; else NOW_KIND=copy; fi
echo "now:         $(yaml_version "$PLUGIN_DIR") ($NOW_KIND)"
echo "Restart Hermes so it loads the plugin: hermes gateway restart"
if [ "$KIND" = missing ]; then echo "Select it if you have not: hermes config set memory.provider openltm"; fi
