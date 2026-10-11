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
| Migration history | split across two repos | single canonical `migrations/` 001–025 in OpenLtm core |
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

## Live machine (Rohi's homelab gateway) — symlink wiring

For a machine that already keeps a checkout of this repo, the most efficient
update is a symlink (verified against `plugins/memory/__init__.py` discovery — the
scanner follows links):

```bash
ln -s /home/rohi/projects/OpenLtm/hermes/openltm_hermes ~/.hermes/plugins/openltm
# then: hermes gateway restart
```

Then a `git pull` + gateway restart = live update with zero install drift.
⚠️ Never `hermes plugins remove/install --force/update` on a symlinked plugin
(rmtree fails on symlinks).

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
{ "env": { "LTM_DB_PATH": "~/.hermes/openltm.db", "LTM_EMBED_PROVIDER": "ollama" } }
```

or export both in your shell profile to share it with the CLI, OpenCode and Pi
too. `LTM_EMBED_PROVIDER=ollama` matches the plugin's default embedder (see
below; if `openltm.json` picks another provider, set the same one). Restart
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
  plugin before pointing Claude Code at its DB**: an older plugin with an
  embedder configured finds no `memories.embedding` column on the migrated DB,
  and its recall returns nothing.
- Vectors from different embedding models are not comparable, so each side
  only compares vectors from its own model, and each memory holds one vector.
  The defaults differ: the Hermes plugin uses Ollama `nomic-embed-text`, core
  uses llama.cpp `bge-m3` when a llama-server is running. With different models,
  core's janitor re-embeds memories with its own model, and those then match
  Hermes by keyword (FTS) only. To share semantic recall, run core on the same
  model: add `"LTM_EMBED_PROVIDER": "ollama"` next to `LTM_DB_PATH` (core's Ollama
  default is `nomic-embed-text`, 768-d, the same key the plugin writes).
- Exact-text dedup keys differ between the two writers, so learning the very
  same sentence on both sides can store it twice; semantic dedup still catches
  it when both use the same model.

Each Hermes profile keeps its own DB; share only the one you point
`LTM_DB_PATH` at.
