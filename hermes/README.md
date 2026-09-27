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
│   └── ltm_extraction_logic.py # standalone heuristic extractor (reference; not loaded by the plugin)
└── openltm_hermes/             # THE Hermes memory plugin — source of truth
    ├── __init__.py             # OpenLtmMemoryProvider: tools, hooks, DB wiring
    ├── auto_capture.py         # automatic-capture policy: rules, guards, distillation
    ├── _db.py                  # FTS5-hardened storage layer
    ├── _providers.py           # embedding providers (Gemini / OpenAI / Ollama)
    ├── _secrets_scrubber.py    # PII/secret redaction
    ├── _project_memory.py      # project-scoped memory helpers
    ├── plugin.yaml             # name: openltm_hermes  (must match dir name + config memory.provider)
    ├── README.md               # plugin-specific docs
    └── test_*.py               # tests
```

## Automatic capture

`auto_capture.py` owns every decision about what gets remembered automatically:

- **Rules** — one ordered, declarative table (`RULES` = `USER_RULES` + `ASSISTANT_RULES`).
  Each rule is a `CaptureRule(name, side, keywords, category, importance)`.
  First match wins, so ordering encodes precedence.
- **Guards** — named, individually testable predicates:
  `is_transient_operational()` rejects runtime notifications;
  `is_read_only_memory_request()` rejects messages that are only read-only
  OpenLTM bookkeeping. A *mixed* message still passes, so a constraint stated
  alongside "call openltm_context" is kept.
- **Distillation** — `distill()` reduces a message to one self-contained
  declarative fact, stripping speech markers while preserving negations.

Two entry points return *decisions* and never touch the database:

| Function | Used by | Scope |
|---|---|---|
| `evaluate_turn(user, assistant)` | `sync_turn()` | one completed turn |
| `evaluate_session(messages)` | `on_session_end()` | whole conversation, max 5 facts |

Because both paths share one rule set and one distiller, a fact captured at
session end is classified and phrased identically to one captured per turn.

To add a fact class: add a `CaptureRule`. To change precedence: reorder the
tuple. To harden a guard: edit the named function. Nothing needs touching in
`__init__.py`.

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

Run the plugin test suite from a SCRATCH copy — never run against the
live `~/.hermes/plugins/openltm_hermes` dir or the live DB:

```bash
rm -rf /tmp/openltm-plugin-test && cp -r hermes/openltm_hermes /tmp/openltm-plugin-test
cd /tmp/openltm-plugin-test && python3 -m pytest -q
```

`test_auto_capture.py` needs **no third-party package and no Hermes runtime**,
so extraction policy can be verified anywhere:

```bash
rm -rf /tmp/openltm-plugin-test && cp -r hermes/openltm_hermes /tmp/openltm-plugin-test
cd /tmp/openltm-plugin-test && python3 -m unittest test_auto_capture
```

Both invocations are part of `bun run check:monthly` (the pytest one skips
cleanly when pytest is unavailable).

OpenLtm core gates (`bun test` / `bun run typecheck`) are unchanged by the
presence of `hermes/` (no TS code is affected).