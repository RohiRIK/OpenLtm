---
description: "USE WHEN initializing a project goal, analyzing project context before starting work, or registering a project in the LTM registry. Groups init | analyze | register."
argument-hint: "<init|analyze|register> [args]"
---

Parse the first word of the arguments as `<subcommand>`. Pass remaining words as `<args>`.

If no subcommand given, show:

```
Usage: /openltm:project <subcommand>

  init      — seed a new project goal into the LTM context system
               /openltm:project init

  analyze   — analyze project context before starting work
               /openltm:project analyze [topic or task description]

  register  — register or rename a project in the LTM registry
               /openltm:project register [name] [path]
```

---

## init

The project defaults to the current one (resolved from the working directory). To give it a friendly name first, run `/openltm:project register`.

**1 — Check for an existing goal:**

Call `mcp__plugin_openltm_memory__context_items` with `{ type: "goal" }`.
If a goal exists, show it and ask: "Replace it?"

**2 — Ask for the goal:**
> "What is the current goal for **\<project\>**? (1–3 bullets, max 100 chars each)"

**3 — Write:**

Call `mcp__plugin_openltm_memory__context_add` with `{ type: "goal", content: "<goal>" }`. A new goal replaces the previous one.

**4 — Confirm:**
```
Project **<project>** seeded.
Goal: <goal>

Decisions, progress, and gotchas accumulate automatically via hooks.
```

Do NOT create context-goals.md or similar files. DB is the source of truth.

---

## analyze

This command orchestrates context retrieval in the right order.

**1 — Get project context:**
Call `mcp__plugin_openltm_memory__context()` — `project` defaults to the current project; pass it only to look at a different one.

Returns: `globals` (importance ≥ 4) + `scoped` (importance ≥ 3).

**2 — Search relevant memories:**
Call `mcp__plugin_openltm_memory__recall(query="<topic>")`.

**3 — Synthesize:**
Note any decisions, gotchas, or patterns relevant to the user's request.

**4 — Proceed:**
Use the gathered context to inform your work. Quote relevant past decisions in your response.

Output format:
```
## Context Analysis — <project>

### Project State
- Goals: [from context scoped]
- Active Decisions: [from context globals]

### Relevant Memories
- [id] <memory> [category]

### Synthesis
<your summary of how this relates to prior work>
```

---

## register

Maps the current directory (or any path) to a friendly name in the context registry.

**Usage:**
```
/openltm:project register                              # register cwd, ask for name
/openltm:project register my-project-name             # register cwd as given name
/openltm:project register /abs/path my-project-name   # register specific path
```

**Step 1 — Determine path and name:**
- Path: use argument if given, otherwise use current `cwd`
- Name: use argument if given; otherwise ask for a suggestion

**Step 2 — Validate name:** lowercase, alphanumeric + hyphens only, 3–40 chars.

**Step 3 — Read registry:** `cat ~/.claude/projects/registry.json` (treat missing as `{}`).

**Step 4 — Check for conflicts:** warn if name used by different path, or path registered under different name.

**Step 5 — Write registry:** add/update `{ "<path>": "<name>" }`.

**Step 6 — Create context folder:** `~/.claude/projects/<name>/` if missing.

**Step 7 — Offer migration:** if `~/.claude/projects/<slug>/` has context files, offer to copy them.

**Step 8 — Confirm:**
> Registered `<path>` as **<name>**.
> Run `/openltm:project analyze` to verify.
