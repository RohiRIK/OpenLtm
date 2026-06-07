# Skills

Skills are Claude Code prompt workflows. Each one packages a repeatable interaction into a named, self-describing module that activates automatically at the right moment, or on demand when you need it.

Five ship with OpenLTM. They cover the full lifecycle: capture, recall, learn, render, and survive.

---

## The five skills

| Skill | What it does | When it activates |
|-------|-------------|-------------------|
| `ContinuousLearning` | Extracts patterns and insights from session transcripts | After session ends (via `EvaluateSession` hook) |
| `LtmServer` | Manages the graph visualization server lifecycle | `/openltm:admin server start\|stop\|status` |
| `GitLearn` | Extracts learnings from git commit diffs | After each commit (opt-in via `gitLearnEnabled`) |
| `Learned` | Surfaces and organises patterns learned across sessions | Session start, `/openltm:memory recall` |
| `session-context` | Manages per-project context injection and summarisation | Session start, pre-compaction |

---

## When to use which

- Just opened a session? **`Learned`** quietly injects the most relevant past memories before Claude writes its first response.
- About to commit work? **`GitLearn`** scans your diff (if enabled) and surfaces patterns worth keeping — but only if the diff crosses `gitLearnMinDiffChars`.
- Session ending? **`ContinuousLearning`** runs in the background, picks out decisions and gotchas, and stores them with the right category and importance.
- Want the visualizer running? **`LtmServer`** starts and stops the graph server on port 7332.
- About to hit the context limit? **`session-context`** writes a snapshot to `context-summary.md` so the next session picks up where this one left off.

---

## See also

- [README](../README.md) — back to the top
- [Hooks](hooks.md) — the events that trigger each skill
- [Configuration](configuration.md) — `gitLearnEnabled`, `gitLearnMinDiffChars`, `evaluateSessionLlm`
