---
description: "DEPRECATED — use /ltm:memory forget instead. Delete a specific memory by ID."
disable-model-invocation: true
argument-hint: "<memory-id> [reason]"
---

> ⚠ **Deprecated:** use `/ltm:memory forget` instead. This alias will be removed in v1.6.0.

1. Recall the memory to show what will be deleted: `mcp__ltm__ltm_recall` with the ID or a targeted query.
2. Show the user: content, tags, relations.
3. Confirm before deleting.
4. Call `mcp__ltm__ltm_forget` with `{ id }`.
5. Report: `Deleted [id]. N relations removed.`

Requires explicit ID — use `/recall` first if needed. Irreversible.
