# Hooks

Hooks are the lifeblood of OpenLTM. They run automatically at session boundaries — no manual setup, no opt-in checklist, no "remember to run this." On install, four Claude Code lifecycle hooks and one git post-commit hook wire themselves automatically. You see them only when something goes wrong.

If a hook fails, run `/openltm:health` to diagnose.

---

## The five hooks

**Four Claude Code lifecycle hooks** (wired in `hooks/hooks.json`):

| Hook | Event | What It Does |
|------|-------|-------------|
| `SessionStart` | Session opens | Injects top memories + project context (goals, decisions, gotchas) |
| `UpdateContext` | Session stops | Saves session progress to `context_items` |
| `EvaluateSession` | Session stops | Extracts patterns from transcript into `memories` |
| `PreCompact` | Before compaction | Snapshots context to `context-summary.md` so it survives |

**One git post-commit hook** (wired into `.git/hooks/post-commit` by `scripts/install-wiring.ts`):

| Hook | Event | What It Does |
|------|-------|-------------|
| `GitCommit` | After git commit | Extracts learnings from diffs (opt-in via `ltm.gitLearnEnabled`) |

---

## How they execute

All hooks run via `hooks/bin/run-hook.sh` — a small wrapper that locates `bun` across Homebrew, nvm, and system installs before executing.

This is not a luxury. Claude Code spawns hooks in a stripped-PATH subprocess environment, and bare `bun` lookups fail with `exit 127` on a fresh shell. The wrapper checks six common install paths before giving up. If you ever move `bun` somewhere unusual, add the path to `run-hook.sh`.

---

## Lifecycle at a glance

```
SessionStart            ─▶ inject top memories + project context
   │
   │  (you work)
   │
SessionStop             ─▶ UpdateContext (save progress)
SessionStop             ─▶ EvaluateSession (extract patterns)
   │
PreCompact              ─▶ snapshot context-summary.md
   │
git commit (if enabled) ─▶ GitCommit (extract from diffs)
```

---

## See also

- [README](../README.md) — back to the top
- [Architecture](03-architecture.md) — full hook architecture spec
- [Configuration](04-configuration.md) — `gitLearnEnabled`, `gitLearnMinDiffChars`
