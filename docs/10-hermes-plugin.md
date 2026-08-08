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
| Migration history | split across two repos | single canonical `migrations/` 001–025 in OpenLtm core |
| CI | Security Scan 5 HIGH CVEs; bundle auto-push to protected main | Trivy 0/0; drift-gate workflow (no push) |
| Publish | n/a | tokenless OIDC provenance on npm |

## Install (any Hermes machine)

```bash
hermes plugins install RohiRIK/OpenLtm/hermes/openltm_hermes
hermes gateway restart   # plugin loads only at startup
```

This clones the repo (depth 1), installs the plugin subdir into
`~/.hermes/plugins/openltm_hermes/`, and Hermes loads it because the plugin's
`__init__.py` exposes `OpenLtmMemoryProvider` (resolves by **directory name** —
must stay `openltm_hermes`).

## Live machine (Rohi's homelab gateway) — symlink wiring

For a machine that already keeps a checkout of this repo, the most efficient
update is a symlink (verified against `plugins/memory/__init__.py` discovery — the
scanner follows links):

```bash
ln -s /home/rohi/projects/OpenLtm/hermes/openltm_hermes ~/.hermes/plugins/openltm_hermes
# then: hermes gateway restart
```

Then a `git pull` + gateway restart = live update with zero install drift.
⚠️ Never `hermes plugins remove/install --force/update` on a symlinked plugin
(rmtree fails on symlinks).

## Update flow (this repo)

1. Edit plugin sources under `hermes/openltm_hermes/`.
2. Run the 38-test plugin suite from a scratch copy (never against the live dir/DB):
   ```bash
   rm -rf /tmp/openltm-plugin-test && cp -r hermes/openltm_hermes /tmp/openltm-plugin-test
   cd /tmp/openltm-plugin-test && python3 -m pytest -q
   ```
3. OpenLtm core gates: `bun test && bun run typecheck` (unchanged by `hermes/`).
4. Commit + bump + release per [`../CONTRIBUTING.md`](../CONTRIBUTING.md).

## Where the DB lives

The plugin stores everything in `~/.hermes/openltm.db` (direct SQLite, WAL,
no server). The migration history is applied by the OpenLtm core runner
(`packages/openltm-core/src/migrations.ts`, versions 001–025) — the plugin itself
does not run migrations.