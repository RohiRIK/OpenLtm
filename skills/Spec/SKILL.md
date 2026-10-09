---
name: Spec
description: "Writes a grounded spec: recalls prior decisions from LTM, explores the affected code, then writes testable acceptance criteria to specs/<feature>.md. Use when the user asks to 'spec this', 'write a spec', 'define what to build', or 'write requirements / acceptance criteria' before planning or implementing a feature or bug fix."
user-invocable: false
---

# Spec

Before writing a spec, explore the codebase and recall prior decisions from LTM. Produces acceptance criteria that feed directly into planning (the `ltm-planner` agent) and into tests.

LTM tools and the recall → learn ritual live in one place: the **Ltm** skill ([../Ltm/SKILL.md](../Ltm/SKILL.md)).

## Workflow Routing

| Workflow | Trigger | File |
|----------|---------|------|
| **ExploreAndSpec** | "spec", "define what to build", "requirements", "acceptance criteria", "before we plan" | [Workflows/ExploreAndSpec.md](Workflows/ExploreAndSpec.md) |

## Examples

**Example 1: New feature on existing project**
```
User: "Spec out rate limiting for the API"
→ recall + context for auth/API decisions
→ Explores existing middleware and route files
→ Writes spec with acceptance criteria into specs/
→ Hands off to the ltm-planner agent
```

**Example 2: Bug investigation**
```
User: "Write a spec for the session token expiring too early"
→ recall for session/auth gotchas
→ Explores auth files and session logic
→ Writes spec with reproduce steps and acceptance criteria
→ Hands off to a failing test built from those criteria
```
