---
name: Spec
description: "Explores code + LTM, then writes acceptance criteria. USE WHEN defining what to build before planning."
user-invocable: false
---

# Spec

Before writing a spec, explore the codebase and recall prior decisions from LTM. Produces acceptance criteria that feed directly into `/plan`.

LTM tools and the recall → learn ritual live in one place: `SkillSearch('ltm memory contract')` loads the **Ltm** skill.

## Workflow Routing

| Workflow | Trigger | File |
|----------|---------|------|
| **ExploreAndSpec** | "spec", "define what to build", "requirements", "before plan" | `Workflows/ExploreAndSpec.md` |

## Examples

**Example 1: New feature on existing project**
```
User: "/spec add rate limiting to the API"
→ recall + context for auth/API decisions
→ Explores existing middleware and route files
→ Writes spec with acceptance criteria into specs/
→ Hands off to /plan
```

**Example 2: Bug investigation**
```
User: "/spec the session token expires too early"
→ recall for session/auth gotchas
→ Explores auth files and session logic
→ Writes spec with reproduce steps and acceptance criteria
→ Hands off to /test (ProveIt)
```
