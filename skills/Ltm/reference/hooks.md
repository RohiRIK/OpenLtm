# What the hooks do — reference

OpenLTM's Claude Code hooks read and write the memory database for you. Knowing what they already did avoids redundant tool calls. Back to the contract: [../SKILL.md](../SKILL.md). Full hook documentation lives in the repo's `docs/06-hooks.md`.

| Hook | When | Effect on memory |
|------|------|------------------|
| `SessionStart` | Session begins, resumes, or is cleared | Injects the project's goal, decisions, gotchas, recent progress, and top memories (importance-5 globals first). Falls back to the last context snapshot if the DB is unavailable. |
| `UserPromptSubmit` | Each user prompt | Recalls a few memories relevant to the prompt and injects them — small and capped. |
| `Stop` | Claude finishes responding | Records or updates this session's `progress` row (files touched). |
| `SessionEnd` | Session closes | Reviews the session and **proposes** memories. Proposals are never written automatically — they wait for `proposals` accept/reject. |
| `PostToolUse` | After a Bash `git commit` | Flags memories anchored (via `learn`'s `files`) to the committed files as stale. |
| `PreCompact` | Before context compaction | Writes a context snapshot so the next session can restore it. |

The opt-in git post-commit extractor (`gitLearnEnabled`) calls an LLM API with a configured key; the **GitLearn** skill is the key-free, interactive alternative.

## Reading the signals

- **Injected context is present** → do not call `context` again for the same project; go straight to a targeted `recall` for the task.
- **Prompt-relevant memories were injected** → treat them as a first recall pass; recall again only for a different angle.
- **A memory shows `stale`** (in `recall` with `verbose: true`) → the code it describes changed. Re-read that code, then `revalidate` if it still holds, or `forget` / `learn` a corrected version if it does not.
- **Pending proposals exist** → offer a curation pass with the **MemoryReview** skill.

## Diagnosing

- No context at session start → run `/openltm:health` (hook activity, DB access, errors).
- Structured hook events are logged as JSONL under the plugin data directory (`logs/ltm.jsonl`); `/openltm:health` summarises the last 24 hours.
- `bun` missing from the hook's PATH shows up as `LTM hook error: bun not found` — install Bun or put it on a standard path.
