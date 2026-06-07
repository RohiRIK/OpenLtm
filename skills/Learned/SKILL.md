---
name: Learned
description: "Reference for retrieved patterns and lessons from past sessions; use when prior fixes, gotchas, decisions, or earlier sessions may apply, or when asked what we learned before."
user-invocable: false
version: 1.0.0
---

# Learned

Session learnings distilled into reusable patterns. Use this skill when past work, decisions, or fixes may apply to the current task.

## Quick Reference

| Trigger | Use |
|---------|-----|
| "what did we learn", "past patterns", "previous sessions" | Review accumulated knowledge |
| "what worked before", "known gotchas", "lessons learned" | Pull relevant session patterns |
| "review past decisions", "reference earlier fixes" | Check historical context |
| "when should I reuse this", "has this been solved before" | Search the learning summary |

## Knowledge Sources

- `skills/Learned/summary.md` — condensed session summaries and recent learning history, auto-updated by the EvaluateSession hook.
- Durable patterns also live in the LTM database — query them with `mcp__plugin_openltm_memory__recall`.

## How to Use

- Read the summary for a fast overview of recent learnings.
- Recall from LTM (`mcp__plugin_openltm_memory__recall`) when you need the exact reasoning, gotcha, or implementation detail behind a past decision.
- Prefer previously validated approaches when the current problem matches an earlier session.
- Treat the accumulated notes as project memory, not instructions to add new workflow logic.

## What It Helps With

- Reusing proven fixes
- Avoiding repeated mistakes
- Recovering context after compaction
- Finding implementation patterns that already worked
