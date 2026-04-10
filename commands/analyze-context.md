---
description: "Analyze project context before starting work. Call at session start or before any significant task."
argument-hint: "[topic or task description]"
---

This command orchestrates context retrieval in the right order.

## Steps

**1 — Get project context:**
Call `mcp__ltm__ltm_context(project="<project>")`.

Returns: `globals` (importance ≥ 4) + `scoped` (importance ≥ 3).

**2 — Search relevant memories:**
Call `mcp__ltm__ltm_recall(query="<topic>")`.

Returns: FTS5 + semantic fallback results.

**3 — Synthesize:**
Note any decisions, gotchas, or patterns relevant to the user's request.

**4 — Proceed:**
Use the gathered context to inform your work. Quote relevant past decisions in your response.

## When to Use

- Before starting any significant feature
- When user asks about "how we do X"
- After receiving a requirements change
- At session start (before detailed work)

## Output Format

```
## Context Analysis — <project>

### Project State
- Goals: [from ltm_context scoped]
- Active Decisions: [from ltm_context globals]

### Relevant Memories
- [id] <memory> [category]

### Synthesis
<your summary of how this relates to prior work>
```
