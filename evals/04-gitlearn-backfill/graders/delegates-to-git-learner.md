---
type: llm
focus: trace
---

The sandbox may or may not be a git repository. Pass only if ALL of these hold:
1. The agent resolved the commit scope with read-only git commands (for example `git rev-parse --show-toplevel` and `git log -5`) before doing anything else with commits.
2. If git found commits: it spawned the `git-learner` subagent exactly once for the whole batch (Agent/Task call whose subagent type contains `git-learner`), passing a scope block with REPO_ROOT, PROJECT_NAME, and the commit hashes — and the main thread did not read full diffs or call `learn` once per commit itself.
3. If git found no repository or no commits: it said so plainly and stored nothing, without inventing memories.
4. It ran no git command that changes repository state (commit, reset, checkout, push, rebase).
