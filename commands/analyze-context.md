---
description: "USE WHEN you want to analyze project context before starting work on a task. Calls context + recall, then synthesizes goals, decisions, gotchas, and relevant memories into a pre-task brief."
allowed-tools: ["mcp__plugin_openltm_memory__context", "mcp__plugin_openltm_memory__recall"]
---

Pre-task context analysis. Orchestrates context retrieval in the correct order and synthesizes a brief.

**Usage:**
```
/openltm:analyze-context [topic]
```

---

## Steps

**1 — Resolve project name:**

Use the project name shown in the injected SessionStart block (`## LTM Session: <name>`), or the repository directory name. `context` needs no name — it defaults to the current project; `recall` uses the name as a filter. If unsure, omit `project` on `recall` and search all projects.

**2 — Load project context:**

Call `mcp__plugin_openltm_memory__context()` — `project` defaults to the current project; pass it only to look at a different one.

Returns: `globals` (importance ≥ 4, all projects) + `scoped` (importance ≥ 3, this project only).

**3 — Search relevant memories:**

If a `[topic]` was given, call `mcp__plugin_openltm_memory__recall(query="<topic>", project="<project>")`.
If no topic, call `mcp__plugin_openltm_memory__recall(project="<project>", limit=5)` to surface the top recent memories.

**4 — Synthesize and present:**

```
## Context Brief — <project>

### Project State
Goals:     [from scoped context, type=goal]
Decisions: [from globals + scoped, category=architecture]
Gotchas:   [from globals + scoped, category=gotcha]

### Relevant to "<topic>"
- [id] <memory content> [category, importance★]
  ...

### Summary
<1-3 sentence synthesis: what matters for this task, what to avoid, what prior decisions apply>
```

If no memories found: `No prior context found — this looks like new territory.`

---

> This command is an alias for `/openltm:project analyze`. For full project management (init, register), use `/openltm:project`.
