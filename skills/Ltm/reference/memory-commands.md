# Memory tools and commands — reference

Parameters and behaviour of the OpenLTM MCP tools (`mcp__plugin_openltm_memory__<name>`), plus the slash commands that wrap them. Back to the contract: [../SKILL.md](../SKILL.md).

## `learn` — store or reinforce a memory

| Field | Notes |
|-------|-------|
| `content` | Required. The insight, concise (~200 chars). State the rule *and* the reason. |
| `title` | Short noun phrase, ≤ 60 chars. Always pass it. |
| `category` | `preference \| architecture \| gotcha \| pattern \| workflow \| constraint`. Auto-detected when omitted, but pass it when you know it. |
| `importance` | 1–5, default 3. `5` never decays and is injected every session — reserve it for system-critical rules. |
| `tags` | Free-form strings for filtering. |
| `files` | Repo-relative paths the memory is about. A later `git commit` touching them flags the memory stale. |
| `project` | Scope to a project. Omit for a global memory. |

**Dedup:** equivalent content (case/punctuation-insensitive) reinforces the existing row (`confirm_count` +1) instead of inserting; a close elaboration of an existing memory also reinforces it. Re-learning a stale memory clears its stale flag. Secrets are scrubbed on write.

Skip `learn` for: facts readable from the code or `git log`, one-off command output, and anything already returned by `recall`.

## `recall` — search memories

| Field | Notes |
|-------|-------|
| `query` | Natural-language question. Full-text (FTS5) search, plus semantic search when an embedding provider is configured. |
| `project` / `category` | Filters. |
| `limit` | Default 10, max 50. |
| `since` / `until` | ISO dates. |
| `sort_by` | `relevance` (default) \| `created` \| `last_recalled` \| `recall_count`. |
| `verbose` | Full memory rows — includes `stale_flagged_at` / `stale_reason`. |
| `includeProvenance` | Attach the provenance chain. |

Ranking weighs relevance, importance, decay, project scope, and recall frequency. Stale (code-invalidated) memories are still returned but ranked lower. Omit `query` to list a project's top memories.

Query words are matched individually (any word can match), so FTS operators such as quotes, `*`, or `NOT` are treated as plain words. Write a descriptive question; more distinctive words rank better.

## `graph` — trace decision chains

`memory_ids` (seeds, usually the top recall hits) and `depth` 1–4 (default 2). Returns a reasoning block of chains, reinforcements, and conflicts.

## `relate` — link two memories

`{source_id, target_id, relationship_type}`. Relations are directional: `A supersedes B` means B is obsolete.

| Type | Meaning |
|------|---------|
| `supports` | Source is evidence for target |
| `contradicts` | Source conflicts with target |
| `refines` | Source is a more precise version of target |
| `depends_on` | Source requires target to hold |
| `related_to` | General association |
| `supersedes` | Source replaces target |

## `forget`, `revalidate`, `admin_audit`

- `forget {id, reason?}` — deletes the memory and its relations. Irreversible: show the memory and confirm with the user first.
- `revalidate {id}` — clears a stale flag after you have checked the memory still matches the code.
- `admin_audit {memory_id?, op?, session_id?, since?, limit?, verbose?}` — who wrote, changed, or deleted a memory, and when.

## `proposals` — memories proposed at session end

`{action: "list"}` returns pending proposals with their `session_id` and `index`; `{action: "accept", session_id, index}` stores one through `learn`; `{action: "reject", session_id, index}` discards it. Full curation flow: the **MemoryReview** skill.

## Slash commands

| Command | Use |
|---------|-----|
| `/openltm:memory recall\|learn\|forget\|relate\|propose` | Interactive wrappers around the tools above. `learn --save-context` also writes a context item. |
| `/openltm:project init\|analyze\|register` | Seed the project goal, pre-task brief, name/rename the project. |
| `/openltm:analyze-context [topic]` | Pre-task brief (context + recall). |
| `/openltm:health` | Health scores, hook activity, janitor status. |
| `/openltm:admin migrate\|scan\|audit` | Schema migrations, secret scan, audit log. |
| `/openltm:server start\|stop\|status` | Graph visualizer (UI on `:7332`, API on `:7331`). |
| `/openltm:onboard` | First-time setup wizard. |
