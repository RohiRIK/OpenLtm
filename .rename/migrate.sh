#!/usr/bin/env bash
# Rename migration: ltm -> openltm / OpenLtm (brand + plumbing). Concept word "LTM" preserved.
# Usage:
#   bash .rename/migrate.sh            # DRY RUN — show per-token counts, change nothing
#   bash .rename/migrate.sh --apply    # apply text + manifest + dir rename (NO db, NO git)
#   bash .rename/migrate.sh --migrate-db   # migrate the live DB (run AFTER reinstall)
set -euo pipefail

REPO="/Users/rohirikman/Library/CloudStorage/GoogleDrive-rohi5054@gmail.com/My Drive/06-Projects/19-claude-code-plugins/claude-ltm-plugin"
cd "$REPO"

# Ordered literal replacements: longest/most-specific FIRST. Format: FROM<TAB>TO
# NOTE: E1 internal-namespace keys (config ltm.* namespace, ltm.janitor DB keys,
# LTM_CHANNEL, logger) are DEFERRED — they are a typed-object/DB-row refactor, not a
# safe literal swap (sed corrupts `ltm.<prop>` variable access). Tracked in plan.md.
read -r -d '' MAP <<'EOF' || true
RohiRIK/claude-ltm-plugin	RohiRIK/OpenLtm
claude-ltm-plugin	OpenLtm
mcp__plugin_ltm_memory	mcp__plugin_openltm_memory
@rohirik/ltm-core	@rohirik/openltm-core
packages/ltm-core	packages/openltm-core
ltm-ltm	OpenLtm-openltm
/ltm:	/openltm:
servers["ltm"]	servers["openltm"]
mcpServers"] as Record<string, unknown>)["ltm"]	mcpServers"] as Record<string, unknown>)["openltm"]
MCP_NAME = "ltm"	MCP_NAME = "openltm"
EOF

# Files to touch: tracked text only. Exclude lockfiles, binaries, db, the .rename workspace.
mapfile -t FILES < <(git ls-files | grep -vE '\.(db|db-shm|db-wal|png|jpg|jpeg|gif|ico|lock|mjs)$' | grep -vE '^\.rename/' | grep -vE 'bun\.lock')

apply=0; migratedb=0
[[ "${1:-}" == "--apply" ]] && apply=1
[[ "${1:-}" == "--migrate-db" ]] && migratedb=1

if [[ $migratedb -eq 1 ]]; then
  OLD="$HOME/.claude/plugins/data/ltm-ltm/ltm.db"
  NEWDIR="$HOME/.claude/plugins/data/OpenLtm-openltm"
  NEW="$NEWDIR/openltm.db"
  echo "DB migrate: $OLD -> $NEW"
  [[ -f "$OLD" ]] || { echo "!! old DB not found at $OLD — abort"; exit 1; }
  cp -f "$OLD" "$REPO/.rename/ltm.db.backup"        # safety backup
  mkdir -p "$NEWDIR"
  cp -f "$OLD" "$NEW"
  [[ -f "$OLD-shm" ]] && cp -f "$OLD-shm" "$NEW-shm" || true
  [[ -f "$OLD-wal" ]] && cp -f "$OLD-wal" "$NEW-wal" || true
  echo "DB copied. Backup at .rename/ltm.db.backup. Old DB left in place (delete manually once verified)."
  # Migrate DB-stored config rows: ltm.* setting keys -> openltm.*
  if command -v sqlite3 >/dev/null; then
    sqlite3 "$NEW" "UPDATE janitor_settings SET key = REPLACE(key,'ltm.','openltm.') WHERE key LIKE 'ltm.%';" 2>/dev/null \
      && echo "Config rows migrated (ltm.* -> openltm.*)" || echo "(no janitor_settings rows / table — skipped)"
  fi
  exit 0
fi

echo "=== Token report (current counts) ==="
while IFS=$'\t' read -r from to; do
  [[ -z "$from" ]] && continue
  n=$(grep -rFl -- "$from" "${FILES[@]}" 2>/dev/null | wc -l | tr -d ' ')
  printf '  %-50s -> %-30s  %s files\n' "$from" "$to" "$n"
done <<< "$MAP"

if [[ $apply -eq 0 ]]; then
  echo; echo "DRY RUN. Re-run with --apply to perform text+manifest+dir rename."; exit 0
fi

echo "=== Applying text replacements ==="
while IFS=$'\t' read -r from to; do
  [[ -z "$from" ]] && continue
  for f in "${FILES[@]}"; do
    [[ -f "$f" ]] || continue
    if grep -qF -- "$from" "$f" 2>/dev/null; then
      # literal, in-place; perl handles all metachars via \Q..\E
      FROM="$from" TO="$to" perl -i -pe 'BEGIN{$f=$ENV{FROM};$t=$ENV{TO};} s/\Q$f\E/$t/g' "$f"
    fi
  done
done <<< "$MAP"

echo "=== ltm.db filename (boundary-aware: not ltm.dbPath) ==="
for f in "${FILES[@]}"; do
  [[ -f "$f" ]] || continue
  if grep -qE 'ltm\.db' "$f" 2>/dev/null; then
    perl -i -pe 's/ltm\.db(?![A-Za-z])/openltm.db/g' "$f"
  fi
done

echo "=== Manifests (exact) ==="
jq '.name="openltm"' .claude-plugin/plugin.json > t && command mv -f t .claude-plugin/plugin.json
jq '.name="OpenLtm" | .plugins[0].name="openltm"' .claude-plugin/marketplace.json > t && command mv -f t .claude-plugin/marketplace.json
# mcp-server self name + package.json names handled by MAP? do explicitly:
perl -i -pe 's/\{ name: "ltm", version/{ name: "openltm", version/g' src/mcp-server.ts || true

echo "=== Directory rename ==="
if [[ -d packages/ltm-core && ! -e packages/openltm-core ]]; then
  git mv packages/ltm-core packages/openltm-core
elif [[ -e packages/openltm-core ]]; then
  echo "!! packages/openltm-core already exists — refusing to nest. Clean it first."; exit 1
else
  echo "(packages/ltm-core not found — already renamed)"
fi

echo "=== Done text stage. Next: bun install (regenerate lock), bunx tsc, bun test, fix fixtures. ==="
