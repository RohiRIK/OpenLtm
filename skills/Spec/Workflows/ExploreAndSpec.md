# ExploreAndSpec

Ground the spec in existing code and prior decisions before writing a single requirement.

Tool names and the full ritual: the **Ltm** skill ([../../Ltm/SKILL.md](../../Ltm/SKILL.md)). Short version below.

## Thinking Pass (interleaved)

Start an extended thinking pass. During thinking, interleave tool calls rather than gathering sequentially:

- `mcp__plugin_openltm_memory__recall` with the feature topic — surfaces prior architecture decisions, gotchas, and patterns while reasoning is still forming. Use a natural-language query, not bare keywords.
- `mcp__plugin_openltm_memory__context` (project defaults to the current one) — restores the project's high-importance memories; skip it if SessionStart already injected them. `mcp__plugin_openltm_memory__context_items` adds the project goal, decisions, and gotchas.
- Read / Grep / Glob for codebase exploration — find existing files, types, and patterns the new code must conform to.

Let each tool result shape the next question rather than gathering everything up front. The goal is one coherent thinking pass that produces grounded constraints.

Record from thinking:
- Prior architecture decisions and known gotchas (from recall / context)
- Existing files and modules the feature must integrate with
- Types and interfaces that constrain implementation
- Patterns used nearby (naming, error handling, data flow)

## Write the Spec

Write the spec to `specs/<feature-slug>.md`. Include:

### What
One paragraph — what is being built and why.

### Existing context
- Relevant files found during exploration
- Prior decisions or constraints from LTM (cite memory IDs where they exist)

### Acceptance criteria
Numbered list. Each criterion must be testable — it becomes a step in the plan and a test case during implementation.

```
1. Given X, when Y, then Z
2. Edge case: when A is empty, return B
3. Existing behaviour C is unchanged
```

### Out of scope
Anything explicitly NOT being built in this iteration.

## After the Spec

- Durable constraint surfaced during speccing → `mcp__plugin_openltm_memory__learn` (category `constraint` or `architecture`).
- Spec builds on a prior decision → `mcp__plugin_openltm_memory__relate` to link the new memory to that decision (`depends_on` / `refines`).
- Project-level decision that belongs to this project's state → `mcp__plugin_openltm_memory__context_add` with `type: decision`.

## Hand off

- Feature work → spawn the `ltm-planner` agent with the spec path; it recalls prior decisions itself and returns a step-by-step plan.
- Bug fix → write a failing test from the acceptance criteria first, then fix.
