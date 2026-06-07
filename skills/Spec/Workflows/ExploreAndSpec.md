# ExploreAndSpec

Ground the spec in existing code and prior decisions before writing a single requirement.

Tool names and the full ritual: `SkillSearch('ltm memory contract')` → the **Ltm** skill. Short version below.

## Thinking Pass (interleaved)

Start an extended thinking pass. During thinking, interleave tool calls rather than gathering sequentially:

- `mcp__plugin_openltm_memory__recall` with the feature topic — surfaces prior architecture decisions, gotchas, and patterns while reasoning is still forming. Use a natural-language query, not bare keywords.
- `mcp__plugin_openltm_memory__context` with the project name — restores existing goals, decisions, and gotchas for this project.
- `mcp__plugin_context-mode_context-mode__ctx_batch_execute` for codebase exploration — find existing files, types, and patterns the new code must conform to.

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
Numbered list. Each criterion must be testable — it becomes a task in `/plan` and a test case in `/build`.

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

## Hand off

- Feature work → run `/plan` against the spec.
- Bug fix → run `/test` (ProveIt) using the acceptance criteria as the failing-test target.
