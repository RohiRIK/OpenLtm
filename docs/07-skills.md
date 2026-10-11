# Skills & Agents

Skills are Claude Code prompt workflows. Each one packages a repeatable interaction into a named module that loads automatically when its description matches what you asked — or on demand. Agents are specialised subagents that the main thread (or a skill) spawns for a focused job in their own context.

OpenLTM ships four skills and two agents. Plugin skills and agents are namespaced as `openltm:<name>`.

---

## Skills

| Skill | What it does | Loads when you say… |
|-------|-------------|---------------------|
| `Ltm` | The memory contract: tool names, the recall-before / learn-after ritual, categories, project context items, and what the hooks already inject. Detail lives in `skills/Ltm/reference/` (tool parameters, context items, hooks). | "remember this", "what do we know about X", "did we decide on Y", "forget that memory", "restore project context", "set the project goal" — or before non-trivial work that touches past decisions |
| `MemoryReview` | A curation pass: pending session-end proposals → accept / reject; stale-flagged memories → revalidate or forget; conflicts and duplicates → supersede or forget. Asks before every delete. | "review memories", "clean up memory", "curate LTM", "what's pending", "any memory proposals" |
| `GitLearn` | Mines durable memories from past commits by spawning the `git-learner` agent — no API key needed. Memories are anchored to the changed files. | "learn from our git history", "mine the last 20 commits", "backfill memories since 2026-09-01", "onboard this repo into LTM" |
| `Spec` | Recalls prior decisions, explores the affected code, and writes testable acceptance criteria to `specs/<feature>.md`, then hands off to `ltm-planner`. | "spec this", "write a spec", "define what to build", "acceptance criteria" |

`GitLearn` can also be run directly: `/openltm:GitLearn --commits 20` or `/openltm:GitLearn --since 2026-09-01`.

## Agents

| Agent | What it does | Tools |
|-------|-------------|-------|
| `ltm-planner` | Plans a feature or refactor where prior decisions in LTM matter. Calls `recall`, `graph`, and `context` itself (read-only), opens every plan with a `## Memory Insights` section, and waits for confirmation before implementation. Honors a `### Pre-Plan Context` block if the main thread passes one. | Read, Grep, Glob, `recall`, `graph`, `context` |
| `git-learner` | Reads commit diffs in its own context and stores only durable learnings through `learn`. Spawned by `GitLearn`. | Bash (read-only git), Read, Grep, `learn`, `recall` |

---

## When to use which

- **Starting work in an area with history?** `Ltm` drives the ritual: `recall` first, `graph` the top hits, `learn` what is new afterwards. The SessionStart and UserPromptSubmit hooks already inject project context and prompt-relevant memories, so the skill tells Claude when a call would be redundant.
- **Pending proposals or a big refactor just landed?** Run `MemoryReview` — the SessionEnd hook only *proposes* memories, and the PostToolUse hook flags memories stale when a `git commit` touches the files they describe.
- **New repo, or turned on `gitLearnEnabled` late?** `GitLearn` backfills memories from history.
- **About to build something non-trivial?** `Spec` writes the acceptance criteria; `ltm-planner` turns them into a plan grounded in prior decisions.
- **Want the graph visualizer?** That is a command now: `/openltm:server start` (see [Commands](05-commands.md)).

---

## See also

- [README](../README.md) — back to the top
- [Commands](05-commands.md) — the `/openltm:*` slash commands
- [Hooks](06-hooks.md) — the events that inject context, record progress, propose memories, and flag stale ones
- [MCP Tools](08-mcp-tools.md) — the tool surface the skills and agents call
- [Configuration](04-configuration.md) — `gitLearnEnabled`, `gitLearnMinDiffChars`, `evaluateSessionLlm`
