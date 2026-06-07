---
name: GitLearn
description: "Mines LTM memories from past git commits. Use when onboarding a repo into LTM, backfilling history after enabling gitLearn, or harvesting patterns after a sprint."
user-invocable: false
version: 1.3.0
---

# GitLearn — Retroactive Git Commit Learning

Extract durable LTM memories from past git commits by delegating the read-and-extract
work to the dedicated **`git-learner`** agent (shipped with this plugin). The agent
reads the diffs and stores memories via the `learn` MCP tool, so this path needs
**no API key** and keeps the main thread's context clean (raw diffs stay in the agent).

## Scope

| Invocation arg | Commits processed |
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

Determine the commit range from the invocation arg (default: last 10). Capture the
repo root so the subagent runs git in the right directory:

```bash
git rev-parse --show-toplevel
git log --pretty=format:'%H %s' -<N>   # or --since="<date>"
```

### Step 2 — Spawn the `git-learner` agent once

Call the Agent tool once with `subagent_type: "git-learner"`. A single agent processes
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

Relay the subagent's table and total. Memories are stored with
`source: "git-commit:<hash>"` and file-path tags, queryable via
`mcp__plugin_openltm_memory__recall`.

## Memory Integration

- Before: `mcp__plugin_openltm_memory__recall query="git commit patterns"` — check what's
  already stored, so the subagent reinforces rather than duplicates.
- After: confirm new rows with a recall scoped to the project.
