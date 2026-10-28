# Hermes Integration

Since **v2.12.0**, OpenLTM is the single home for the **Hermes memory provider**
plugin (the former `RohiRIK/hermes-brain` upstream was consolidated into this
repo and retired). Everything a Hermes install needs — plugin, canonical schema,
extraction logic, and tests — lives under [`hermes/`](../hermes/README.md).

## What changed (v2.12.0 consolidation)

| Area | Before | After |
|---|---|---|
| Plugin location | untracked `~/.hermes/plugins/openltm_hermes` + separate `hermes-brain` repo | `hermes/openltm_hermes/` in this repo (source of truth) |
| Schema | drift-prone inline SQL (25 objects) | `hermes/schema.sql` (canonical, column-terminal, folds migrations 007/011/013) |
| Auto-capture | keyword lists duplicated in `sync_turn` and `on_session_end`, with one-off regexes patched on per incident | one ordered rule table + named guards + shared distiller in `hermes/openltm_hermes/auto_capture.py` |
| Migration history | split across two repos | single canonical `packages/openltm-core/migrations/` 001–025 in OpenLtm core |
| CI | Security Scan 5 HIGH CVEs; bundle auto-push to protected main | Trivy 0/0; drift-gate workflow (no push) |
| Publish | n/a | tokenless OIDC provenance on npm |

## Install (any Hermes machine)

OpenLTM is in the [Hermes Plugin Catalog](https://hermes-agent.nousresearch.com/docs/plugins/openltm)
(entry: [`plugin-catalog/openltm.yaml`](https://github.com/NousResearch/hermes-agent/blob/main/plugin-catalog/openltm.yaml)),
so it installs by name at the reviewed, pinned commit:

```bash
hermes plugins install openltm
hermes gateway restart   # plugin loads only at startup
```

To run the tip of `main` instead of the catalog pin:

```bash
hermes plugins install RohiRIK/OpenLtm/hermes/openltm_hermes
```

Either path clones the repo (depth 1), installs the plugin subdir into
`~/.hermes/plugins/openltm/` (the manifest `name`), and Hermes loads it through the
plugin's `register(ctx)` → `ctx.register_memory_provider(...)`; select it with
`hermes config set memory.provider openltm`.

## Upgrading an installed plugin

A Hermes machine has the plugin in `~/.hermes/plugins/openltm/` in one of two
forms, and they upgrade differently. Check which one you have first:

```bash
ls -ld ~/.hermes/plugins/openltm           # "l…  -> /path/…" is a symlink; "d…" is a copied directory
grep '^version' ~/.hermes/plugins/openltm/plugin.yaml
```

- **Copied directory.** What `hermes plugins install` (catalog or repo path)
  creates. It is not a git checkout, so `git pull` does nothing for it. A
  catalog install takes `hermes plugins update openltm`, which only moves to the
  catalog pin (see [`11-publishing.md`](11-publishing.md)); for any other
  version, upgrade from an OpenLtm checkout of that version.
- **Symlink** to `hermes/openltm_hermes` in a checkout (below). Upgrading means
  updating that checkout. Never run `hermes plugins remove`, `install --force`
  or `update` on it (rmtree fails on symlinks).

From an OpenLtm checkout at the version you want, `hermes/upgrade-plugin.sh`
handles both:

```bash
hermes/upgrade-plugin.sh --check     # install kind, installed vs. this checkout's version
hermes/upgrade-plugin.sh             # copied: replace it with this checkout's plugin
                                     # symlink: leave it, say which checkout to update
hermes/upgrade-plugin.sh --pull      # symlink: also git pull --ff-only that checkout
hermes/upgrade-plugin.sh --link      # turn a copied install into a symlink to this checkout
hermes gateway restart               # the plugin loads only at startup
```

A replaced copy is kept in `~/.hermes/plugin-backups/openltm-<timestamp>/`,
outside `plugins/`, so Hermes never loads it. Settings (`openltm.json`) and the
DB live in `~/.hermes/`, not in the plugin dir, and are not touched. Add
`--dry-run` to see what would change, and `--plugin-dir DIR` if the plugin is
not in `$HERMES_HOME/plugins/openltm`. `--check` exits 3 when the plugin is
missing or a different version, so a verification run can gate on it.

### Live machine (Rohi's homelab gateway): symlink wiring

For a machine that already keeps a checkout of this repo, the most efficient
update is a symlink (verified against `plugins/memory/__init__.py` discovery; the
scanner follows links):

```bash
ln -s /home/rohi/projects/OpenLtm/hermes/openltm_hermes ~/.hermes/plugins/openltm
# or, replacing an existing copied install: hermes/upgrade-plugin.sh --link
# then: hermes gateway restart
```

Then a `git pull` + gateway restart = live update with zero install drift.

## Update flow (this repo)

1. Edit plugin sources under `hermes/openltm_hermes/`.
2. Run the plugin tests from a scratch copy (never against the live dir/DB):
   ```bash
   rm -rf /tmp/openltm-plugin-test && cp -r hermes/openltm_hermes /tmp/openltm-plugin-test
   cd /tmp/openltm-plugin-test && python3 -m pytest -q
   ```
   Extraction policy alone needs no third-party package:
   ```bash
   cd /tmp/openltm-plugin-test && python3 -m unittest test_auto_capture
   ```
3. OpenLtm core gates: `bun test && bun run typecheck` (unchanged by `hermes/`).
4. Commit + bump + release per [`../CONTRIBUTING.md`](../CONTRIBUTING.md).

## Provider-tool diagnostics (including scheduled jobs)

OpenLTM's eight functions are **direct Hermes memory-provider tools**, not
entries in the deferred-tool catalog. Call `openltm_brain_stats`,
`openltm_recall` and `openltm_learn` using their supplied tool schemas. Do not
send them through `tool_call`, search the deferred catalog for them, or import
them from `hermes_tools` inside `execute_code`. A failure of those routes does
not show that the memory provider or database is unavailable.

For a scheduled consolidation job:

1. Call `openltm_brain_stats` directly as the capability preflight. If the
   required direct schemas are absent or that call fails, stop with the exact
   error and retain the source queue; do not substitute the built-in `memory`
   tool, which writes different stores.
2. Recall before saving, then count a save only after the direct
   `openltm_learn` response returns a real memory ID. Existing/reinforced IDs are
   not newly created facts. A failed write remains unresolved.
3. Derive saved/retained/cleared counts from actual receipts and filesystem
   read-back, never intended classifications. No receipt means no saved claim;
   no verified cleanup means no cleared claim.

`hermes plugins doctor openltm --ci` checks discovery and provider registration.
Its `0 tool(s), 0 hook(s)` count is normal for this plugin: `register(ctx)`
registers a memory provider, whose tool schemas are exposed by Hermes when the
`memory` toolset is enabled. It does not register ordinary plugin tools/hooks.
The TypeScript `hooks/lib/pluginDoctor.ts` instead diagnoses the **Claude Code**
installation; its MCP/hook/migration findings are not a Hermes health verdict.
Doctor is advisory: inspect its reported failures, not just its process exit.

## Where the DB lives

The plugin stores everything in `$HERMES_HOME/openltm.db` — `~/.hermes/openltm.db`
for the default profile, `~/.hermes/profiles/<name>/openltm.db` for the others
(direct SQLite, WAL, no server). The plugin creates its own schema
(`init_schema()` in `openltm_hermes/_db.py`) and does not run OpenLtm's
migrations; a DB it creates has no `_schema_version` rows.

## Sharing one memory with Claude Code (2.17.1+)

Claude Code, the `ltm` CLI and the other adapters can use the Hermes DB instead
of their own, so a memory learned in either place is recalled in both. Point
`LTM_DB_PATH` at the Hermes profile's DB:

```json
// ~/.claude/settings.json
{ "env": { "LTM_DB_PATH": "~/.hermes/openltm.db", "LTM_EMBED_PROVIDER": "llamacpp" } }
```

or export both in your shell profile to share it with the CLI, OpenCode and Pi
too. `LTM_EMBED_PROVIDER=llamacpp` matches the plugin's recommended local
llama.cpp embedder (`"embedder": "llamacpp"` in `openltm.json`; see below. If
`openltm.json` picks another provider, set the same one). Restart
Claude Code, and the Hermes gateway after updating the plugin.

What happens on the first open:

- OpenLtm core runs its migrations on the Hermes DB. Where the Hermes schema
  already has a column, index or table a migration adds, the runner skips that
  statement and runs the rest, so every version is recorded. Nothing is dropped
  except `memories.embedding`: migration 010 moves the vectors to the
  `memory_embeddings` table first. Core backs up the DB before migrating, but
  stop the Hermes gateway and copy the DB (`sqlite3 ~/.hermes/openltm.db ".backup
  ~/openltm-hermes-backup.db"`) before the first open anyway.
- The Hermes plugin (2.17.1+) reads and writes vectors in whichever layout the
  DB has, so semantic recall keeps working after the move. **Update the Hermes
  plugin before pointing Claude Code at its DB** ([how](#upgrading-an-installed-plugin)): an older plugin with an
  embedder configured finds no `memories.embedding` column on the migrated DB,
  and its recall returns nothing.
- Vectors from different embedding models are not comparable, so each side
  only compares vectors from its own model, and each memory holds one vector.
  Core uses llama.cpp `bge-m3` by default. Set the plugin to the same server
  (`"embedder": "llamacpp"`, same `llamacpp_url` and `embedding_model` in
  `openltm.json`) so both sides write the same vectors. If the plugin has no
  `embedder` set it falls back to Ollama `nomic-embed-text`; with different
  models, core's janitor re-embeds memories with its own model, and those then
  match Hermes by keyword (FTS) only.
- Exact-text dedup keys differ between the two writers, so learning the very
  same sentence on both sides can store it twice; semantic dedup still catches
  it when both use the same model.

Each Hermes profile keeps its own DB; share only the one you point
`LTM_DB_PATH` at.
