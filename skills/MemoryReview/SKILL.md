---
name: MemoryReview
description: "Curation pass over OpenLTM memory: triage pending session-end proposals, stale-flagged memories, conflicting or superseded entries, and low-value duplicates, then accept, revalidate, relate, or forget them with the user's approval. Use when the user says 'review memories', 'clean up memory', 'curate LTM', 'what's pending', 'any memory proposals', 'prune stale memories', or after a refactor that may have invalidated what LTM knows."
allowed-tools: mcp__plugin_openltm_memory__proposals, mcp__plugin_openltm_memory__recall, mcp__plugin_openltm_memory__learn, mcp__plugin_openltm_memory__graph, mcp__plugin_openltm_memory__context_items, mcp__plugin_openltm_memory__revalidate, mcp__plugin_openltm_memory__relate, mcp__plugin_openltm_memory__admin_audit, Read, Grep, Glob
---

# MemoryReview — curate long-term memory

A deliberate pass that keeps LTM accurate: decide what pending proposals become memories, re-check memories the code has moved past, and retire duplicates and contradictions. Tool names and categories come from the **Ltm** skill ([../Ltm/SKILL.md](../Ltm/SKILL.md)); every tool below is `mcp__plugin_openltm_memory__<name>`.

## Rules

- Change memory **only through the MCP tools** — never run SQL or edit the database file.
- **Never `forget` without explicit approval.** Show the exact IDs and content first and wait for a yes that covers those IDs. Extra care for importance-5 memories.
- Prefer `relate … supersedes` over `forget` when the old memory explains *why* something changed.
- Keep a pass to about 20 items; offer another pass if more remain.

## Step 1 — Scope

Default to the current project. Ask only if the user hinted at something else ("all projects", "just proposals", "only stale ones").

## Step 2 — Gather (read-only)

Run these and collect candidates:

1. **Pending proposals** — `proposals {action: "list"}`. Each has a `session_id` and `index`.
2. **Stale memories** — `recall {project, verbose: true, limit: 50}` (no query lists the project's top memories; add a query to focus an area). Keep rows where `stale_flagged_at` is set; `stale_reason` names the commit or files.
3. **Conflicts and supersedes** — from those rows, note `contradicts` relations and `supersedes` targets that are still active. For a tangled area, `graph {memory_ids, depth: 2}` shows the chain.
4. **Duplicates and low value** — memories in the same category that say the same thing; operational noise (one-off command output, transient state); facts derivable from the code or `git log`.

## Step 3 — Present

One compact table per group, skipping empty groups:

```
### Pending proposals (3)
| # | session:index | category ★ | content | suggest |
|---|---------------|------------|---------|---------|
| 1 | a1b2c3d4:0 | gotcha ★4 | Bun prepare() caches statements… | accept |

### Stale (2)
| # | id | content | stale because | suggest |
```

Suggested actions: **accept / reject** (proposals) · **revalidate / rewrite / forget** (stale) · **supersede / forget** (conflicts, duplicates) · **keep**. Give a one-line reason for each. Then ask the user to approve, edit, or skip — accept batch answers such as "accept 1,3; reject 2; revalidate all stale".

## Step 4 — Apply approved actions

| Case | Do |
|------|----|
| Proposal accepted / rejected | `proposals {action: "accept" \| "reject", session_id, index}` |
| Stale but still true | Optionally Read the anchored files to confirm, then `revalidate {id}` |
| Stale and wrong | `learn` the corrected version (same category, `files` anchors), `relate {new, old, supersedes}`, then `forget` the old one only if approved |
| Conflict | Pick the winner with the user; `relate {winner, loser, supersedes}`; `forget` the loser only if approved |
| Duplicate | `learn` the clearest wording (it reinforces the match); `relate … supersedes` the extras; `forget` extras only if approved |
| Low value | `forget {id, reason}` only if approved |

`forget` is the one tool this skill does not pre-approve, so the user also sees a permission prompt for each delete.

## Step 5 — Report

```
Memory review — <project>
Proposals: 2 accepted, 1 rejected
Stale: 3 revalidated, 1 rewritten
Conflicts/duplicates: 2 superseded, 1 forgotten
Skipped: 4 (left for next pass)
```

If nothing was found: `Nothing to curate — no pending proposals, stale flags, or conflicts for <project>.`
