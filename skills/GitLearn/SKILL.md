---
name: GitLearn
description: "Retroactive Git commit learning for extracting memories from git history; use when onboarding a repo, backfilling past learnings, or after a productive sprint. Trigger phrases: 'git learn', 'review past commits', 'backfill learnings'."
user-invocable: false
version: 1.0.0
---

# /git-learn — Retroactive Git Commit Learning

Extract LTM memories from past git commits in the current repository.

## Usage

```
/git-learn                    # last 10 commits
/git-learn --commits 20       # last N commits
/git-learn --since 2026-03-01 # commits since date
```

## When to Use

- Onboarding a new project into LTM — seed memories from existing commit history
- After enabling `gitLearnEnabled` for the first time — backfill past learnings
- After a productive sprint — extract patterns from a batch of commits

## Instructions for Claude

### Step 1 — Check config

Verify `gitLearnEnabled` is true in `~/.claude/config.json`. If not, warn:
> "gitLearnEnabled is false. Enable it first or this will have no effect on future commits."

### Step 2 — Collect commits

```bash
# Default: last 10
git log --oneline -10

# With --commits N
git log --oneline -N

# With --since <date>
git log --oneline --since="<date>"
```

### Step 3 — Extract from each commit

For each commit hash, run:

```bash
CLAUDE_PLUGIN_ROOT=<plugin-root> bun run <plugin-root>/hooks/src/GitCommit.ts   --extract "$(bun -e "
    const { spawnSync } = require('child_process');
    const hash = '<HASH>';
    const diff = spawnSync('git', ['show', '--unified=3', '--no-color', hash], { encoding: 'utf-8' }).stdout.slice(0, 4000);
    const message = spawnSync('git', ['log', '-1', '--pretty=format:%s', hash], { encoding: 'utf-8' }).stdout.trim();
    const files = spawnSync('git', ['diff-tree', '--no-commit-id', '-r', '--name-only', hash], { encoding: 'utf-8' }).stdout.trim().split('\n').filter(Boolean);
    const projectName = require('path').basename(process.cwd());
    console.log(JSON.stringify({ diff, commitMsg: message, hash, files, projectName }));
  ")"
```

Note: The `--extract` mode runs synchronously — wait for each before the next.

### Step 4 — Report

After processing all commits:

```
Processed <N> commits.
Memories stored: check with /recall or mcp__ltm__ltm_recall.
```

## Memory Integration

Before: `mcp__ltm__ltm_recall query="git commit patterns"` — check what's already stored.
After: memories appear with `source: "git-commit:<hash>"` and file tags.
