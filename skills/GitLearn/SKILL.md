---
name: GitLearn
description: "Mines durable LTM memories from past git commits through the git-learner agent (no API key needed). Use when the user says 'learn from our git history', 'mine the last N commits', 'backfill memories since <date>', 'onboard this repo into LTM', or wants to harvest patterns after a sprint."
argument-hint: "[--commits N | --since YYYY-MM-DD]"
version: 1.4.0
---

# GitLearn — Retroactive Git Commit Learning

Extract durable LTM memories from past git commits by delegating the read-and-extract
work to the dedicated **`git-learner`** agent (shipped with this plugin). The agent
reads the diffs and stores memories via the `learn` MCP tool, so this path needs
**no API key** and keeps the main thread's context clean (raw diffs stay in the agent).

## Scope

| Argument or request | Commits processed |
|----------------|-------------------|
| *(none)* | last 10 |
| `--commits N` | last N |
| `--since YYYY-MM-DD` | all commits since that date |

## When to Use

- Onboarding a new project into LTM — seed memories from existing commit history.
- Backfilling history after enabling `gitLearnEnabled` for the first time.
- Harvesting reusable patterns after a productive sprint.

## How It Works

The background post-commit hook (`GitCommit.ts`) calls an LLM API directly and needs
a configured key. This skill runs interactively instead, so it spawns the
**`git-learner`** agent via the Agent tool. Spawning an agent is valid here because
skills execute in the live Claude Code session, which has the Agent tool available.
The agent carries its own extraction rubric (signal-to-noise rules, category mapping,
storage fields), so this skill only has to supply the scope.

## Instructions for Claude

### Step 1 — Resolve scope

Determine the commit range from the arguments or the user's wording (default: last 10). Capture the
repo root so the subagent runs git in the right directory:

```bash
git rev-parse --show-toplevel
git log --pretty=format:'%H %s' -<N>   # or --since="<date>"
```

### Step 2 — Spawn the `git-learner` agent once

Call the Agent tool once with `subagent_type: "openltm:git-learner"` (plugin agents are namespaced by plugin name). A single agent processes
the whole batch — do not spawn one per commit. The agent's system prompt already holds
the extraction rubric, so the spawn prompt only supplies a `<scope>` block:

```xml
<scope>
REPO_ROOT: <repo root from git rev-parse --show-toplevel>
PROJECT_NAME: <repo directory basename>
COMMITS:
<one commit hash per line, from Step 1>
</scope>
```

Pass nothing else — no rubric, no instructions. The agent knows what to keep, what to
skip, how to map categories, and which fields to store.

### Step 3 — Report

Relay the subagent's table and total. Memories are tagged `git-commit:<hash>` and
anchored to the changed files (so later commits flag them stale), queryable via
`mcp__plugin_openltm_memory__recall`. Tool names and categories: the **Ltm** skill
([../Ltm/SKILL.md](../Ltm/SKILL.md)).

## Memory Integration

- Before: `mcp__plugin_openltm_memory__recall query="git commit patterns"` — check what's
  already stored, so the subagent reinforces rather than duplicates.
- After: confirm new rows with a recall scoped to the project.
