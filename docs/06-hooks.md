# Hooks

Hooks are the lifeblood of OpenLTM. They run automatically at session boundaries — no manual setup, no opt-in checklist, no "remember to run this." On install, seven Claude Code lifecycle hooks wire themselves automatically; an optional git post-commit hook serves git-learn. You see them only when something goes wrong.

If a hook fails, run `/openltm:health` to diagnose.

---

## The eight hooks

**Seven Claude Code lifecycle hooks** (wired in `hooks/hooks.json`):

| Hook | Event (timeout) | What It Does |
|------|-------|-------------|
| `SessionStart` | Session opens, resumes, clears, or compacts (15s) | Injects project context plus a compact LTM index (id + title) of global and project memories. Source-aware — see below. |
| `UserPromptSubmit` | Every prompt (5s) | Adds up to 5 memories relevant to the prompt. Full-text only, ~50ms, never repeats a memory within a session. |
| `PostToolUse` | After a Bash call (10s) | When Claude runs a successful `git commit`, flags memories anchored to the committed files as stale. |
| `UpdateContext` | `Stop` — after every assistant turn (10s) | Upserts **one** progress line per session in `context_items` (files written or edited so far). |
| `EvaluateSession` | `SessionEnd` — once (60s) | Writes a session summary and queues memory proposals for review. |
| `SessionEnd` | `SessionEnd` — once | Spawns a detached `ltm janitor run --if-due`, at most once per 6h. No graph-server needed. Opt out with `LTM_JANITOR_ON_SESSION_END=0`. See [Janitor](13-janitor.md). |
| `PreCompact` | Before compaction (30s) | Snapshots context to `context-summary.md` so it survives compaction. |

**One optional git post-commit hook** (written to `~/.claude/hooks/git/post-commit` by `scripts/install-wiring.ts`; the global `core.hooksPath` is only set when `ltm.gitLearnEnabled` is on and no other `core.hooksPath` is configured, because a global hooks path replaces every repository's own `.git/hooks`):

| Hook | Event | What It Does |
|------|-------|-------------|
| `GitCommit` | After any git commit | Extracts learnings from diffs (opt-in via `ltm.gitLearnEnabled`) and flags anchored memories stale |

---

## What each hook does

### SessionStart

Adds project context and LTM memories to each new context window. Behaviour depends on the `source` field Claude Code passes:

| `source` | Behaviour |
|---|---|
| `startup` | Resets the tool counter, auto-onboards once (`onboarded.flag`), and for a new project registers it and asks whether to create context files. |
| `clear` | Resets the tool counter; may show the new-project prompt; never onboards. |
| `resume` | Injects context with no prompts. |
| `compact` | Leads with the PreCompact snapshot and does not rebuild it from the DB. |

The LTM section is a **compact index** — `- [id] title` — capped at `ltm.injectTopN` (default 15) entries, of which globals (importance ≥ 4) take at most a third so they never crowd out project memories. Use the MCP `get` tool on an id for the full memory. New projects still get the globals. Pending staged memory conflicts and recently applied supersedes are listed, and one line appears when memory proposals are waiting: `💡 N memory proposal(s) pending — review with /openltm:memory propose review`. Everything injected is secret-scrubbed, and private-tagged memories are left out.

SessionStart never runs `git` and never edits Claude Code's own config.

### UserPromptSubmit

Recalls memories relevant to each prompt with full-text search only — no embeddings, no DB writes, about 50ms. It searches active memories that are global or belong to the current project and are not flagged stale. Words are matched by a light stem ("errors" finds "error"). A memory needs two matching words, or one distinctive word (4+ characters, in no other memory the prompt can see). Generic task words such as "add", "test", "fix" or "function" count half. Weak partial matches are dropped when another memory matches much better. It prints `LTM (relevant to this prompt):` followed by up to `ltm.promptRecallLimit` (default 5) lines of `- [id] (category) content`, each cut to 200 characters. A memory is never injected twice in a session. Memories SessionStart only listed in its index (id + title) can still be injected with their content. It prints nothing when there is no match, for slash commands, for prompts under 15 characters, or when `ltm.autoRecall` or `ltm.promptRecall` is `false`.

### PostToolUse

Runs after Claude makes a successful `git commit` (matcher `Bash`). It marks memories linked to the committed files as stale (importance-5 memories are exempt), so stale-flagging works without the global git hook. It is silent, never blocks, and is controlled by `ltm.gitInvalidateEnabled`.

### UpdateContext (Stop) and EvaluateSession (SessionEnd)

Claude Code fires `Stop` after **every** assistant turn, not when the session ends, so OpenLTM splits the work:

- **`UpdateContext`** reads the transcript at `transcript_path` and upserts a single progress line for the current session, keyed on `session_id`. Later turns rewrite the same row, so the 20-entry progress history counts sessions, not turns. It prints nothing.
- **`EvaluateSession`** runs once at `SessionEnd`. It writes a per-session summary to `${CLAUDE_PLUGIN_DATA}/learned/patterns/<date>-<session8>.md` and a rolling index to `${CLAUDE_PLUGIN_DATA}/learned/summary.md` — never into the plugin install directory. It queues proposals at `${CLAUDE_PLUGIN_DATA}/proposals/<session-id>.json` for `/openltm:memory propose` (or the MCP `proposals` tool). Proposals come from real tool errors only — harness errors, permission denials, user interrupts and rejections, very short messages and duplicates are dropped — plus, when `ltm.evaluateSessionLlm` is on, an LLM pass over the assistant's text (capped at 45s). It also removes UserPromptSubmit's per-session dedupe state.

### Config keys

| Key | Default | Used by |
|---|---|---|
| `ltm.injectTopN` | `15` | SessionStart index size |
| `ltm.autoRecall` | `true` | SessionStart directive + UserPromptSubmit |
| `ltm.promptRecall` | `true` | UserPromptSubmit |
| `ltm.promptRecallLimit` | `5` (1–20) | UserPromptSubmit |
| `ltm.gitInvalidateEnabled` | `true` | PostToolUse + GitCommit stale-flagging |
| `ltm.evaluateSessionLlm` | `false` | EvaluateSession LLM proposals |

See [Configuration](04-configuration.md) for where the config file lives.

---

## How they execute

All hooks run via `hooks/bin/run-hook.sh` — a small wrapper that locates `bun` across Homebrew, nvm, and system installs before executing.

This is not a luxury. Claude Code spawns hooks in a stripped-PATH subprocess environment, and bare `bun` lookups fail with `exit 127` on a fresh shell. The wrapper checks common install paths before giving up. If you ever move `bun` somewhere unusual, add the path to `run-hook.sh`.

Git-clone installs (`bash install.sh`) get the same events, matchers and timeouts wired into `~/.claude/settings.json` by `scripts/install-wiring.ts`; re-running it replaces LTM hooks from other checkouts rather than duplicating them. A plain `bun install` in a development checkout does not wire anything (opt in with `LTM_WIRE_HOOKS=1`).

---

## Lifecycle at a glance

```
SessionStart            ─▶ inject project context + compact LTM index
   │
UserPromptSubmit        ─▶ add prompt-relevant memories (every prompt)
PostToolUse (Bash)      ─▶ git commit → flag anchored memories stale
Stop                    ─▶ UpdateContext (upsert this session's progress line)
   │  (repeats every turn)
   │
PreCompact              ─▶ snapshot context-summary.md
SessionStart (compact)  ─▶ re-inject the snapshot
   │
SessionEnd              ─▶ EvaluateSession (summary + proposals)
SessionEnd              ─▶ janitor run --if-due (detached)

git commit (any repo)   ─▶ GitCommit (extract from diffs, if enabled)
```

**Other hook hosts** can use the portable dispatcher, which needs no plugin checkout: `ltm hook --name SessionStart` (prefill) and `ltm hook --name SessionEnd` (janitor if due; set `LTM_DB_PATH`).

---

## See also

- [README](../README.md) — back to the top
- [Architecture](03-architecture.md) — full hook architecture spec
- [Configuration](04-configuration.md) — `gitLearnEnabled`, `gitLearnMinDiffChars`, prompt recall keys
