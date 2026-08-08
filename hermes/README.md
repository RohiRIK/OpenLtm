# Hermes memory plugin — OpenLTM

This directory is the single home of the **Hermes memory plugin** and its canonical
schema inside the OpenLTM repo. It is the consolidation target for the former
`RohiRIK/hermes-brain` upstream (schema + extraction) and the previously
untracked live plugin at `~/.hermes/plugins/openltm_hermes`.

## What lives here

```
hermes/
├── schema.sql                  # canonical Long-Term Memory schema (column-terminal; folds migrations 007/011/013 per Max review)
├── extraction/
│   └── ltm_extraction_logic.py # deterministic, LLM-free memory extraction heuristics (from hermes-brain)
└── openltm_hermes/             # THE Hermes memory plugin — source of truth
    ├── __init__.py             # OpenLtmMemoryProvider (R-1/R-3 hardened: FTS, recall, vector search, janitor)
    ├── _db.py                  # FTS5-hardened storage layer
    ├── _providers.py           # embedding providers (Gemini / OpenAI / Ollama)
    ├── _secrets_scrubber.py    # PII/secret redaction
    ├── _project_memory.py      # project-scoped memory helpers
    ├── plugin.yaml             # name: openltm_hermes  (must match dir name + config memory.provider)
    ├── README.md               # plugin-specific docs
    └── test_*.py               # 38 tests
```

## Install

Hermes supports the native install path `hermes plugins install <owner>/<repo>/<subdir>`:

```bash
hermes plugins install RohiRIK/OpenLtm/hermes/openltm_hermes
```

This clones the repo (depth-1), installs the plugin subdir into
`~/.hermes/plugins/openltm_hermes/`, then Hermes loads it because the plugin's
`__init__.py` exposes `OpenLtmMemoryProvider`.

## Where the DB lives

The plugin stores everything in a single local SQLite database:

```
~/.hermes/openltm.db
```

There is no server, no network dependency, and no separate DB — the plugin is a
direct-SQLite provider. `memory.provider: openltm_hermes` in `~/.hermes/config.yaml`
points Hermes at it.

## Update flow

1. Pull the latest `main` of OpenLtm.
2. Reinstall the plugin to refresh `~/.hermes/plugins/openltm_hermes`:
   ```bash
   hermes plugins install RohiRIK/OpenLtm/hermes/openltm_hermes
   ```
3. Restart the Hermes gateway (the plugin is only loaded at startup).

> The live plugin dir is a generated/installed copy — never edit it directly; edit
> this repo and reinstall. The migration history lives in OpenLtm's `migrations/`
> (canonical, 001–025) and is applied by the OpenLtm core runner, not by this plugin.

## Tests

Run the plugin test suite (38 tests) from a SCRATCH copy — never run against the
live `~/.hermes/plugins/openltm_hermes` dir or the live DB:

```bash
rm -rf /tmp/openltm-plugin-test && cp -r hermes/openltm_hermes /tmp/openltm-plugin-test
cd /tmp/openltm-plugin-test && python3 -m pytest -q
```

OpenLtm core gates (`bun test` / `bun run typecheck`) are unchanged by the
presence of `hermes/` (no TS code is affected).