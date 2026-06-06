---
name: GitLearn
description: "Mines LTM memories from past git commits. Use when onboarding a repo into LTM, backfilling history after enabling gitLearn, or harvesting patterns after a sprint."
user-invocable: false
version: 1.2.0
---

# GitLearn — Retroactive Git Commit Learning

Extract durable LTM memories from past git commits by delegating the read-and-extract
work to a Haiku subagent. The subagent reads the diffs and stores memories via the
`learn` MCP tool, so this path needs **no API key** and keeps the main thread's
context clean (raw diffs stay in the subagent).

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
a configured key. This skill runs interactively instead, so it spawns a **Haiku
subagent** via the Agent tool. Spawning a subagent is valid here because skills
execute in the live Claude Code session, which has the Agent tool available.

## Instructions for Claude

### Step 1 — Resolve scope

Determine the commit range from the invocation arg (default: last 10). Capture the
repo root so the subagent runs git in the right directory:

```bash
git rev-parse --show-toplevel
git log --pretty=format:'%H %s' -<N>   # or --since="<date>"
```

### Step 2 — Spawn one Haiku subagent

Call the Agent tool once with `subagent_type: "general-purpose"` and `model: "haiku"`.
A single subagent processes the whole batch — do not spawn one per commit.

Fill this template, substituting the repo root, the commit list, and the project name
(the repo directory basename):

```
You are mining durable engineering memories from git commits into the LTM database.
Work in repo root: <REPO_ROOT>

TASK:
1. For each commit hash below, run `git show --unified=3 --no-color <hash>` and read the diff.
   Commits: <HASH_LIST>
2. Extract ONLY durable, reusable learnings — architectural decisions, gotchas, or
   reusable patterns that would help in a FUTURE session. Each under 120 chars.
3. Skip noise: pure version bumps, changelog edits, pure-docs commits with no design
   rationale, trivial style/token renames, CI rebuild commits. If a commit teaches
   nothing reusable, store nothing for it.
4. Store each learning by calling `mcp__plugin_ltm_memory__learn` with:
   - content: the learning (concise, <120 chars)
   - category: architecture (decisions) | gotcha | pattern
   - importance: 3 for patterns/decisions, 4 for gotchas
   - project_scope: "<PROJECT_NAME>"
   - source: "git-commit:<short7hash>"
   - tags: up to 5 changed file paths from that commit
   The learn tool dedupes by content, so reinforcing is safe.

Be selective — quality over quantity. Only call git (read-only) and the learn MCP tool;
write no files. Return a compact table: short-hash | #memories stored | one-line reason,
plus the total count.
```

### Step 3 — Report

Relay the subagent's table and total. Memories are stored with
`source: "git-commit:<hash>"` and file-path tags, queryable via
`mcp__plugin_ltm_memory__recall`.

## Memory Integration

- Before: `mcp__plugin_ltm_memory__recall query="git commit patterns"` — check what's
  already stored, so the subagent reinforces rather than duplicates.
- After: confirm new rows with a recall scoped to the project.
