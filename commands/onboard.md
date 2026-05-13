---
description: "Run the LTM onboarding wizard to set up memory for a new project"
allowed-tools: ["Bash"]
---

Runs the interactive 5-step terminal wizard for Claude LTM.

## When to use

Run when starting a new project to seed goal, preferences, and context into LTM.
Safe to re-run — idempotent by default (skips if already onboarded; use `--force` to redo).

## Usage

```bash
# Interactive (default)
bun run "${CLAUDE_PLUGIN_ROOT}/src/onboard.ts"

# Non-interactive (CI / scripted setup)
bun run "${CLAUDE_PLUGIN_ROOT}/src/onboard.ts" --non-interactive

# Force re-run even if already onboarded
bun run "${CLAUDE_PLUGIN_ROOT}/src/onboard.ts" --force
```

## Steps

| # | Name | What happens |
|---|------|-------------|
| 1 | Diagnose | Checks env vars, DB access, hook wiring — aborts on CRITICAL |
| 2 | Register | Names the project; writes entry to registry.json |
| 3 | Goal | Captures current objective; saved to context_items + memories |
| 4 | Tour | Shows key commands (recall, learn, health, propose) |
| 5 | Done | Writes `onboarded.flag` to `${CLAUDE_PLUGIN_DATA}/` |

## Flags

| Flag | Effect |
|------|--------|
| `--non-interactive` | Skips all prompts; derives project name from cwd; uses default goal |
| `--force` | Ignores existing `onboarded.flag` and runs all steps again |

## CRITICAL abort

If Step 1 finds CRITICAL issues (e.g. `CLAUDE_PLUGIN_DATA` not set, DB inaccessible), the wizard exits with code 1 and displays the failing checks. Fix these before continuing.

## What it saves

- `registry.json` — maps cwd to project name
- `context_items` — `goal` row for the project
- `memories` — goal stored as `architecture` importance-3 memory
- `onboarded.flag` — timestamp file preventing duplicate runs
