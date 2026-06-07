# UX Specification — OpenLTM Plugin

**Version:** 1.0 (against plugin v1.9.0)
**Owner:** ui-ux-designer (dev-team)
**Status:** Vision document for system-architect + frontend-developer hand-off
**Last updated:** 2026-04-28
**Companion to:** `docs/PRD.md`

---

## 0. How To Read This Document

Sections 1–7 are **descriptive** — they document the as-built UX surface and its
current debt. Sections 8–9 are **prescriptive** — they define the magnificent
target UX and a simplified command surface. Wireframes use ASCII; flows use
Mermaid where rendered, monospace boxes elsewhere.

The contract with engineering is:

- §1–§3 must remain accurate as code changes (update on every UX-touching PR).
- §6–§7 are the bug list. Each row is a candidate work item.
- §8 is the north star. Land it incrementally; do not block on big-bang.

---

## 1. Interaction Model

### 1.1 The Plugin Lives In Three Layers

The LTM plugin meets the user across three distinct surfaces, each with very
different visibility and interaction semantics:

```
┌─────────────────────────────────────────────────────────────────────┐
│  L1 — INVISIBLE          L2 — INVOKED              L3 — EXPLORATORY │
│  (hooks + injection)     (slash + skills)          (graph app)      │
├─────────────────────────────────────────────────────────────────────┤
│  SessionStart            /openltm:memory recall        localhost:7331   │
│  PreCompact              /openltm:memory learn         (browser, opt-in)│
│  Stop → UpdateContext    /openltm:project init                          │
│  Stop → EvaluateSession  /openltm:health                                │
│                          /openltm:doctor                                │
│  (auto-redaction)        /openltm:admin <sub>                           │
│                                                                     │
│  Visibility: ZERO        Visibility: USER-DRIVEN   Visibility: PULL │
│  Frequency:  every msg   Frequency:  on demand    Frequency: rare   │
│  Failure:    silent      Failure:    visible       Failure: visible │
└─────────────────────────────────────────────────────────────────────┘
```

**L1 (Invisible)** is where the plugin *earns its keep*. The user never types a
command — context is injected, progress is captured, secrets are scrubbed.
When L1 works, the user feels Claude is just smarter today than it was yesterday.

**L2 (Invoked)** is where the user reaches for the plugin deliberately —
to recall before deciding, to learn after deciding, to diagnose when something
feels off. L2 is where command surface complexity hurts (see §9).

**L3 (Exploratory)** is the rarest path — opening a localhost browser to
inspect the memory graph. Used by power users (Pat) and during retrospectives.

### 1.2 Core Interaction Primitives

Every LTM user-facing operation reduces to one of four primitives:

| Primitive | What it does                                       | Examples                              |
|-----------|----------------------------------------------------|---------------------------------------|
| **Inject**| Push relevant memory *into* the session            | SessionStart, PreCompact, ambient ctx |
| **Capture**| Pull insight *out* of the session into the DB     | learn, UpdateContext, EvaluateSession |
| **Search**| User-driven query over stored memory               | recall, analyze                       |
| **Curate**| Modify the corpus (delete, link, merge, redact)   | forget, relate, scan, migrate         |

Anything that doesn't fit these primitives belongs in `system-architect`'s
domain or is a UX bug — flag it.

### 1.3 Entry Points

The plugin is reachable from these entry points, in order of frequency:

1. **Implicit (every session)** — SessionStart hook. ~95% of all plugin
   "use" by volume goes through here.
2. **MCP tool calls from Claude itself** — when CLAUDE.md instructions
   tell Claude to `recall` before non-trivial work.
3. **User slash command** — `/openltm:*` typed by the developer.
4. **Skill auto-trigger** — `ContinuousLearning`, `GitLearn`, `Learned`,
   `session-context` skills load when their trigger phrases appear.
5. **Browser** — graph-app at `localhost:7331`, only when manually started.

### 1.4 Invisible vs. Visible Default

The contract: **invisible by default, visible on action or failure.**

| Event                                     | Should user see? |
|-------------------------------------------|------------------|
| Context injected at SessionStart          | YES — one block, top of session |
| Memory captured by EvaluateSession        | NO  — silent, surface in /openltm:health |
| Secret scrubbed on write                  | NO  — log only; surface in /openltm:health |
| Hook crashes                              | YES — plain-English message |
| Recall returns 0 results                  | YES — with "did you mean" suggestion |
| Auto-redaction on user-typed input        | YES — show `[REDACTED:type]` inline so user knows |
| Decay nudge ("3 stale memories")          | NO  — opt-in, weekly summary, never per-session |
| Migration runs                            | YES — one line "schema upgraded vN → vN+1" |

Violations of this contract are UX bugs.

---

## 2. Command Reference & Flows

This section documents every active slash command and skill group that ships
in v1.4.20. Deprecated aliases are inventoried in §7.

### 2.1 `/openltm:memory` — The Core Loop

The single most-used command. Groups four subcommands.

#### 2.1.1 `/openltm:memory recall`

| | |
|---|---|
| **Purpose** | Search past memories before deciding. Primary read path. |
| **Trigger** | Manual (user types) OR Claude calls `mcp__plugin_openltm_memory__recall` per CLAUDE.md instructions. |
| **Inputs** | Positional `<query>` · `--category X` · `--project X` · `--limit N` (default 10) |
| **Output** | Per-result line: `[id] content · category · ★importance · ✓confirmed · #tags · →relations` |
| **Latency target** | < 200 ms p50 (PRD G2, Q1) |

**Happy path transcript:**

```
> /openltm:memory recall "javascript package manager"

Found 3 memories (FTS5 + 1 semantic):

  [m_142] We use Bun, never npm — 3-5x faster install            ★5  ✓4  #stack
  [m_201] bunx replaces npx (no -y flag needed)                  ★4  ✓2  #stack
  [m_087] uv replaces pip for Python                             ★4  ✓3  #stack

→ ranked by relevance, importance, recency
```

**Empty-result transcript (current — bad):**

```
> /openltm:memory recall "xyz framework"

No memories found.
```

**Empty-result transcript (target):**

```
> /openltm:memory recall "xyz framework"

No memories found for "xyz framework".

  Did you mean:
    • /openltm:memory recall "frontend framework"   (3 results)
    • /openltm:memory recall --category architecture  (12 results)

  Or capture this gap:
    • /openltm:memory learn "<insight about xyz>" --category architecture
```

**Error states:**

| Cause                  | Current message            | Ideal message |
|------------------------|----------------------------|---------------|
| MCP server unreachable | "tool call failed"         | `LTM MCP not running. Run /openltm:doctor.` |
| Empty DB               | "No memories found."       | `Empty LTM. Seed with /openltm:project init.` |
| FTS5 syntax error      | bubbled SQL error          | `Invalid FTS query. Wrap phrases in quotes.` |
| Project filter, no rows| "No memories found."       | `No memories tagged "{project}". Globals shown? [y/N]` |

#### 2.1.2 `/openltm:memory learn`

| | |
|---|---|
| **Purpose** | Persist a decision/gotcha/pattern in 1 keystroke. |
| **Trigger** | Manual after a decision, OR auto-extracted by EvaluateSession (proposes; user confirms in next session). |
| **Inputs** | Positional `<insight>` · `--category X` (default `pattern`) · `--importance N` (default 3) · `--project X` · `--tags t1,t2` · `--save-context` |
| **Output** | `Stored [m_xyz] in 89ms. Tagged: <tags>. Importance ★3.` |
| **Side effects** | Auto-redact secrets pre-write. With `--save-context`, also append to `context_items`. |

**Transcript:**

```
> /openltm:memory learn "RLS must be enabled before prod" --category gotcha --importance 5

Stored [m_318] in 67ms.
  Category: gotcha   Importance: ★5 (global — injects into every session)
  Project: OpenLtm
  Tags: (none — consider adding #supabase #security)

⚠ Importance 5 means this surfaces in EVERY future session, in EVERY project.
  If that's not intended, lower with: /openltm:memory learn ... --importance 3
```

**Smart-defaults transcript (G-C — auto-categorization, target):**

```
> /openltm:memory learn "RLS must be enabled before prod"

Stored [m_318] in 71ms.
  Suggested: category=gotcha (87% confidence) · importance=5 (matches "must" + "prod")
  Tags inferred: #supabase #security
  ↩ Accept   ⌫ Edit   ✗ Cancel
```

**Error states:**

| Cause                                       | Current | Ideal |
|---------------------------------------------|---------|-------|
| Empty `<insight>`                           | review-session fallback | Same — but show "Found 3 candidates: [list]" |
| Identical content already stored            | dedup silently | `Reinforced [m_142] (now ✓5).` |
| Conflicts with existing memory (G-F target) | none | `⚠ Conflicts with [m_142]: "<text>". Supersede? Coexist? Cancel?` |

#### 2.1.3 `/openltm:memory forget <id>`

| | |
|---|---|
| **Purpose** | Soft-delete a wrong/stale memory. |
| **Trigger** | Manual after a refactor or a recall surfaced something obsolete. |
| **Inputs** | Required `<id>` · optional `<reason>` |
| **Output** | `Deleted [m_xyz]. N relations removed.` |
| **Confirmation** | YES — show content + tags + relations first, ask "Delete? [y/N]" |

**Error states:**

| Cause                  | Current | Ideal |
|------------------------|---------|-------|
| Missing ID arg         | usage   | `Forget what? Try: /openltm:memory recall <topic> first.` |
| ID doesn't exist       | error   | `[m_xyz] not found. Already forgotten?` |
| User typo `m_138` for `m_318` | wrong delete | confirmation step prevents this |

#### 2.1.4 `/openltm:memory relate <src> <tgt> <type>`

| | |
|---|---|
| **Purpose** | Link two memories with a typed edge. |
| **Trigger** | Manual when tracing decision → gotcha chains. Powers the graph. |
| **Inputs** | `<src-id> <tgt-id> <type>` where type ∈ {supports, contradicts, refines, depends_on, related_to, supersedes} |
| **Output** | `Linked [src] → [tgt] (type)` |

**Discoverability gap:** the 6 valid types are documented in the command but
not surfaced if user types an invalid type. Ideal:

```
> /openltm:memory relate m_142 m_318 caused

Unknown relationship type "caused". Valid types:
  supports     contradicts    refines
  depends_on   related_to     supersedes

Did you mean: depends_on?
```

### 2.2 `/openltm:project` — Project Lifecycle

#### 2.2.1 `/openltm:project init`

| | |
|---|---|
| **Purpose** | Seed the goal that Claude sees on every SessionStart. |
| **Trigger** | First time in a new repo. |
| **Inputs** | Interactive: prompts for goal text. |
| **Output** | `Project <name> seeded. Goal: <text>.` |

**Flow:**

```
START
  │
  ▼
[1] cat registry.json — is this cwd registered?
  │
  ├─ NO  ──→ "Run /openltm:project register first." → END
  │
  └─ YES ─→ [2] check existing goal in DB
              │
              ├─ EXISTS ─→ "Current goal: <text>. Replace? [y/N]"
              │             │
              │             ├─ N → END (no change)
              │             └─ Y → continue
              │
              └─ NONE ───→ continue
                            │
                            ▼
                          [3] prompt: "What is the goal? (1-3 bullets)"
                            │
                            ▼
                          [4] write to context_items as type=goal
                            │
                            ▼
                          [5] confirm: "Project X seeded. Goal: <text>."
                            │
                            ▼
                           END
```

#### 2.2.2 `/openltm:project analyze [topic]`

| | |
|---|---|
| **Purpose** | Pre-task context retrieval. Calls `context` + `recall`, synthesizes. |
| **Trigger** | Before starting a non-trivial task. |
| **Output** | Three blocks: Project State, Relevant Memories, Synthesis. |

**UX critique:** this is what the user *should* be doing every time, but the
friction of typing it is the reason it's underused. **§8 proposes ambient
analyze on-keypress** (smart recall surfacing).

#### 2.2.3 `/openltm:project register [name] [path]`

| | |
|---|---|
| **Purpose** | Map cwd → friendly name in registry.json. |
| **Trigger** | First time in a new repo, or after moving a project. |
| **Output** | `Registered <path> as <name>.` |

**Edge cases:**
- Conflict: name used by different path → warn, ask user to disambiguate.
- Migration: legacy slug folder exists → offer to copy.

### 2.3 `/openltm:admin` — Power-User Ops

Three subcommands: `migrate`, `scan`, `server`. Detailed in commands/admin.md.

#### 2.3.1 `/openltm:admin migrate [status|up|down|reset|--legacy]`

| Arg       | Risk    | Confirmation |
|-----------|---------|--------------|
| `status`  | none    | none         |
| `up`      | low     | none         |
| `down`    | medium  | warn         |
| `reset`   | destructive | "type yes to confirm" |
| `--legacy`| medium  | warn before move |

**Output (status, target):**

```
Schema migrations
─────────────────
✓ 001_initial_schema       (applied 2025-12-01)
✓ 002_add_relations        (applied 2026-01-15)
✓ 003_add_decay_fields     (applied 2026-02-22)
○ 004_add_provenance       (pending — run /openltm:admin migrate up)

Legacy DB: ✓ none detected
```

#### 2.3.2 `/openltm:admin scan [--project X] [--dry-run]`

Scans existing memories for secrets. Auto-redacts unless `--dry-run`.

**Output:**

```
> /openltm:admin scan --dry-run

Scanned 318 memories.
  Found 2 candidates for redaction:
    [m_087]: AWS_ACCESS_KEY pattern at offset 142
    [m_201]: JWT-like token at offset 38

Run without --dry-run to apply redactions.
```

#### 2.3.3 `/openltm:admin server [start|stop|status]`

Manages the localhost graph-app server (port 7331).

**Output:**

```
> /openltm:admin server start

Graph server starting on http://localhost:7331 (PID 47218)
  ▸ Open in browser: http://localhost:7331
  ▸ Stop: /openltm:admin server stop
```

### 2.4 `/openltm:health` — Single Source of Truth

Replaces the deprecated `/openltm:doctor` and `/openltm:decay-report`.

**Output spec (current — already good, kept for reference):**

```
SCORE  STATUS              PROJECT              MEMORIES  STALE  CTX
  85   🟢 healthy           claude-config            142      3   4/4
  62   🟡 needs_attention   my-app                    38     12   2/4
  31   🔴 neglected         old-project                9      9   0/4

Memory Decay Summary
────────────────────
Active: 318  |  Deprecated: 12  |  Last decay run: 2026-04-21
At-risk (score < 0.25): 7 memories
```

**Improvement (§8):** add a `--fix` flag that suggests one action per row:

```
old-project: 31 🔴 → run `/openltm:memory forget` on top-3 stale ids: m_009, m_023, m_041
```

### 2.5 `/openltm:doctor` (deprecated) — Diagnostics

Currently aliased to `/openltm:health` per §7. The diagnostic surface (hook
checks, MCP reachability, schema version) lives in `/openltm:health`.

### 2.6 Skill Reference

| Skill                | Trigger phrases                                           | What user sees |
|----------------------|-----------------------------------------------------------|----------------|
| `ContinuousLearning` | "learn", "recall", "forget", "relate", session start      | Reference doc loads silently; Claude uses commands |
| `Learned`            | "what did we learn", "prior fixes"                        | Reference doc loads silently |
| `session-context`    | "restore context", "session notes"                        | Reference doc loads silently |
| `GitLearn`           | "git learn", "review past commits", "backfill learnings"  | Multi-turn flow: scan → propose → confirm |

**`GitLearn` is the only skill with a visible flow.** Spec for that flow
lives in §8 (onboarding wizard) since it's the centerpiece of new-user value.

---

## 3. Hook Experience Map

The four hooks are the *invisible* layer. The user's experience depends
entirely on how loud each one is and how it fails.

### 3.1 SessionStart

| | |
|---|---|
| **Fires** | Every Claude Code session opens (per `hooks.json`). |
| **User sees** | A `## Restored Project Context` block at top of session, max ~60 lines, containing goal + decisions + recent progress + gotchas + LTM globals/scoped. |
| **Latency budget** | < 500 ms (or felt as a startup stutter) |
| **Failure mode** | Silent — current pain point. If MCP isn't ready or DB is missing, no block appears and user has no idea why. |

**Delightful version:**
- Block has a one-line "freshness" indicator: `Last session: 2h ago, +3 progress entries`.
- A subtle separator before/after so the user can mentally bracket "what
  Claude already knows" vs. "what I'm about to type".
- Footer cue: `+12 more memories — /openltm:memory recall to explore`.

**Annoying version (avoid):**
- 60-line wall of text every session, no scannable hierarchy.
- Same content twice in a row (no de-dup vs. last session).
- Loud emoji banner that wastes vertical space.

**Current pain points:**
1. **Silent failure** — if context wasn't injected, user doesn't know.
   FIX: print a subtle `(LTM context unavailable — /openltm:doctor for details)` line.
2. **No "what changed since last session"** — every session looks the same
   even when nothing was learned. FIX: surface the diff.
3. **No quick way to disable per-session** — sometimes you just want a
   clean slate. FIX: `/openltm:project pause` (see §8).

### 3.2 PreCompact

| | |
|---|---|
| **Fires** | Before Claude Code compacts the context window. |
| **User sees** | Nothing directly. The hook regenerates `context-summary.md` (~60 lines) which becomes the SessionStart payload after compaction. |
| **Latency budget** | < 200 ms (compact already feels slow; don't add to it) |
| **Failure mode** | Silent — and worst-case: post-compact session loses context entirely. |

**Delightful version:**
- One-line confirmation in compact dialog: `LTM snapshot saved (60 lines).`
- After compact, the SessionStart block tags itself
  `(restored from compaction at 14:32)` so user knows what happened.

**Current pain points:**
1. **No user signal** that the snapshot succeeded. If it silently fails,
   the user finds out by Claude "forgetting" mid-task.
2. **No control over what survives** — user can't pin a memory to "must
   survive the next compact".

### 3.3 EvaluateSession (fires on Stop)

| | |
|---|---|
| **Fires** | Session end (Stop hook). |
| **User sees** | Nothing currently. (Per PRD §4.3, "promotes candidate insights for learning" — happens silently.) |
| **Failure mode** | Silent. If it ever auto-writes a wrong memory, the user discovers it on next recall. |

**Open Question OQ4** (PRD §9): Should EvaluateSession auto-write or always
propose? **UX recommendation: ALWAYS propose.** Auto-write violates the trust
contract. Proposed flow:

```
[End of session — user types /exit]
  │
  ▼
EvaluateSession scans session for insight candidates
  │
  ▼
  Found 0  →  silent exit
  Found 1+ →  Print proposal block AT SESSION END (before Claude exits):

    ┌─────────────────────────────────────────────────────────────┐
    │ LTM proposes capturing 2 insights from this session:        │
    │                                                             │
    │  [1] "RLS must be enabled before prod" · gotcha · ★5        │
    │  [2] "useDebounce hook pattern with cleanup" · pattern · ★3 │
    │                                                             │
    │  Run on next session start:                                 │
    │    /openltm:memory learn 1   — accept [1]                       │
    │    /openltm:memory learn 1,2 — accept both                      │
    │    /openltm:memory learn 0   — discard all                      │
    └─────────────────────────────────────────────────────────────┘
```

The proposals would be queued in a `pending_learnings` table; the next
SessionStart surfaces them.

### 3.4 UpdateContext (fires on Stop)

| | |
|---|---|
| **Fires** | Session end (Stop hook). |
| **User sees** | Nothing. Hook appends a `progress` row trimmed to last 20. |
| **Failure mode** | Silent. The next SessionStart simply doesn't show recent progress. |

**Delightful version:**
- Progress entries are auto-extracted from the session (commits made,
  files touched, decisions captured). User can opt to edit before write.
- One-line confirmation in goodbye message: `Saved 3 progress entries.`

---

## 4. Memory Lifecycle UX

End-to-end journey of a single memory, from birth to grave, mapped to the
user's experience at each step.

```
┌──────────────────────────────────────────────────────────────────┐
│                    THE MEMORY LIFECYCLE                          │
└──────────────────────────────────────────────────────────────────┘

  [1] BIRTH           [2] INJECTION      [3] CONFIRMATION   [4] AGING
  ───────────         ──────────────     ────────────────   ─────────
  user types          SessionStart       recall surfaces    no recalls
  /memory learn  ──→  injects globals ──→  it; user uses ──→ for 90d;
  OR                  + scoped (top      it (implicit          decay
  EvaluateSession     N) silently        confirm)              factor < 1
  proposes
  ✓ visible           ◌ invisible        ◌ invisible          ◌ invisible
                                                              FRICTION:
                                                              user has
                                                              no idea
                                                              it's aging

                                                                 │
                                                                 ▼
  [7] PURGE           [6] REDACTION     [5] FORGET / SUPERSEDE
  ───────────         ────────────       ──────────────────────
  decay cron          /openltm:admin scan    user runs /memory forget
  hard-deletes        finds secret       OR new memory supersedes
  if score=0          → redacts inline   → soft-delete + audit
  for 365d            ◌ silent for       ✓ explicit confirm
  ✗ NOT YET BUILT     auto-write          ✓ relations cleaned
                      ✓ visible for      FRICTION:
                      retroactive scan   user must remember
                                         the right ID
```

### 4.1 Friction Points (current)

| Stage         | Friction                                                | Impact |
|---------------|---------------------------------------------------------|--------|
| Birth         | Must pick category + importance manually                | Skips |
| Injection     | No "what's new since last session" diff                 | Doesn't know |
| Confirmation  | Implicit — no UI to thumbs-up/down a recall result     | Decay scorer flies blind |
| Aging         | No proactive nudge until /openltm:health is run             | Stale stays stale |
| Forget        | Requires ID; user must recall first                     | Two-step |
| Redaction     | Auto on write, but user doesn't see what was redacted  | Trust gap |
| Purge         | Not implemented — soft-deleted rows stay forever        | DB bloat |

### 4.2 Target Lifecycle UX (see §8)

- **Birth:** auto-categorization + importance suggestion (G-C).
- **Injection:** diff against last session ("3 new globals since you were here").
- **Confirmation:** thumbs-up/down on recall results feeds decay scorer (G-K).
- **Aging:** weekly digest in `/openltm:health` with one-click prune.
- **Forget:** `/openltm:memory forget --interactive` opens a tui picker.
- **Redaction:** show inline `[REDACTED:aws-key]` in the user's input echo so
  they know it happened.
- **Purge:** `/openltm:admin vacuum` to hard-delete old soft-deletes.

---

## 5. Discoverability & Onboarding

### 5.1 The Current First-Run Experience (it's bad)

What happens today when a user installs the plugin from the marketplace:

```
[install plugin]
  │
  ▼
Restart Claude Code
  │
  ▼
SessionStart fires
  │
  ▼
No DB exists yet → no context block injected
  │
  ▼
User sees… nothing.
  │
  ▼
User opens a chat. Claude doesn't mention LTM.
  │
  ▼
User has no idea anything happened.
  │
  ▼
☠ Plugin abandoned by 50% of installs within a week.
```

Activation metric A1 (PRD §8.1) targets >70% with ≥1 memory after 7 days.
Today that number is almost certainly far below target — the plugin gives
the user nothing in the first 5 minutes.

### 5.2 The Magnificent First-Run (target — see §8 for full design)

The onboarding wizard (G-O) fires automatically on the first SessionStart
after install detects an empty DB. See §8.5 for full ASCII flow.

### 5.3 Discoverability Audit

How a user discovers each feature today:

| Feature | Discovery path | Score |
|---------|----------------|-------|
| `/openltm:memory recall` | README · CLAUDE.md · Claude tells them | 🟢 |
| `/openltm:memory learn`  | README · CLAUDE.md                    | 🟢 |
| `/openltm:project init`  | README only                            | 🟡 |
| `/openltm:project analyze`| Buried in README                      | 🔴 |
| `/openltm:health`        | Mentioned but not promoted             | 🟡 |
| `/openltm:doctor`        | Only when something breaks             | 🟡 |
| `/openltm:admin scan`    | Audit-driven (Ezra persona)            | 🔴 |
| `/openltm:admin server`  | "did you know there's a graph?"        | 🔴 |
| GitLearn skill       | Trigger phrases only — invisible       | 🔴 |
| importance=5 globals | Inferred — never explained             | 🔴 |
| Decay scoring        | Only via /openltm:health                   | 🔴 |
| Edge types (relate)  | Listed in command help only            | 🔴 |

### 5.4 Where Users Get Lost

- **"I learned something but it didn't show up next session."** — They used
  `--project foo` but cwd registered as `bar`. Project filter excludes it.
- **"I ran /openltm:doctor and got a deprecation warning."** — They followed
  README that points to deprecated alias.
- **"Recall returned 0 results for an obvious query."** — FTS5 syntax
  swallowed their query (e.g., they typed `c++`).
- **"Why did Claude inject a memory about Project A while I'm in B?"** —
  importance=5 globals inject everywhere; not explained.
- **"How do I see what's in my DB?"** — There's a graph app at port 7331
  but no one tells you.

---

## 6. Error States Catalog

Comprehensive list of failure modes with ideal UX.

### 6.1 Hook Errors

| Code | Scenario | Current msg | Ideal msg |
|------|----------|-------------|-----------|
| H1 | SessionStart hook missing | nothing — silent | session opens with: `(LTM context unavailable. Run /openltm:doctor.)` |
| H2 | DB file missing on first run | nothing | `LTM database not initialized. Run /openltm:project init to seed.` |
| H3 | DB file corrupt | crash | `LTM DB unreadable. Backup at <path>; restore or /openltm:admin migrate reset.` |
| H4 | MCP server failed to start | tools unavailable | session top: `LTM MCP failed to start. /openltm:doctor.` |
| H5 | PreCompact silently failed | post-compact ctx empty | post-compact session: `(Last compact snapshot incomplete — see /openltm:doctor.)` |
| H6 | UpdateContext crash | progress lost | session-end goodbye: `Progress not saved (UpdateContext failed).` |

### 6.2 MCP Tool Errors

| Code | Scenario | Current | Ideal |
|------|----------|---------|-------|
| M1 | `recall` with no DB | "no results" | `Empty LTM. /openltm:project init to start.` |
| M2 | `learn` with empty content | review fallback | OK as-is. |
| M3 | `forget` with bad ID | error | `Memory [m_xyz] not found.` |
| M4 | `relate` with bad type | error | List 6 valid types. |
| M5 | DB locked (concurrent write) | "SQLITE_BUSY" | `Another session is writing — retrying…` (auto-retry 3x) |

### 6.3 Schema/Migration Errors

| Code | Scenario | Current | Ideal |
|------|----------|---------|-------|
| S1 | Schema version mismatch | recall returns junk | session top: `Schema vN+1 expected, found vN. /openltm:admin migrate.` |
| S2 | Migration partial failure | rollback message | OK — but link to backup file path. |
| S3 | Legacy DB at old path | missed silently | `Legacy DB found. /openltm:admin migrate --legacy.` (already done) |

### 6.4 Plugin Lifecycle Errors

| Code | Scenario | Current | Ideal |
|------|----------|---------|-------|
| P1 | Plugin updated, cache stale | new commands missing | `LTM updated to v1.X — restart Claude Code to load.` |
| P2 | settings.json missing hook | hook never fires | `/openltm:doctor` lists missing hook + command to add it. |
| P3 | CLAUDE_PLUGIN_ROOT unset | hook crashes | `CLAUDE_PLUGIN_ROOT not set. Reinstall plugin.` |

### 6.5 Silent-Failure Audit (the biggest debt)

**Silent failures the user will never know happened:**

1. EvaluateSession found 0 candidates — fine.
2. EvaluateSession crashed — **bad, not surfaced**.
3. UpdateContext skipped a progress entry — **bad**.
4. PreCompact wrote a 0-line summary — **catastrophic, not surfaced**.
5. Auto-redaction triggered — **trust-breaking, not visible**.
6. Decay scorer reduced a memory's rank — **bad, no audit**.

Every silent failure is a candidate for the §8 "memory health surface".

---

## 7. Deprecated Commands UX Debt

The plugin carries 11+ deprecated aliases per PRD §4.2:

`/openltm:analyze-context` · `/openltm:learn` · `/openltm:decay-report` · `/openltm:capture` ·
`/openltm:doctor` (legacy) · `/openltm:migrate` · `/openltm:hook-doctor` · `/openltm:migrate-db` ·
`/openltm:secrets-scan` · `/openltm:recall` · `/openltm:ltm-server`

### 7.1 Current Deprecation UX

Each deprecated command file starts with one line:

```
> ⚠ **Deprecated:** use `/openltm:memory recall` instead. This alias will be removed in v1.6.0.
```

**Strengths:**
- Clear sunset version (v1.6.0).
- Points to the replacement.

**Weaknesses:**
- Every invocation re-prints the warning (annoying for muscle-memory users).
- No "auto-rewrite my command" option.
- No tracking of *when* v1.6.0 ships.
- README still references some deprecated commands.

### 7.2 Better Deprecation UX

```
> /openltm:recall "supabase rls"

⚠ /openltm:recall is deprecated (sunset: v1.6.0, ~6 weeks).
  Auto-rewriting to: /openltm:memory recall "supabase rls"
  Suppress this warning: /openltm:admin config set quietDeprecations true

[results follow normally]
```

### 7.3 Sunset Timeline (proposed)

```
v1.4.20  ────────  v1.5.0  ────────  v1.6.0  ────────  v2.0.0
 (now)              (warn)            (final)            (removed)
                    +1 month         +3 months          +9 months

aliases:            louder warning   final session      gone
each call           on every use     ("removing in
prints once                          14 days")
```

### 7.4 Migration UX For Each Alias

| Old | New | Migration | Sunset |
|-----|-----|-----------|--------|
| `/openltm:analyze-context` | `/openltm:project analyze` | mechanical | v1.6.0 |
| `/openltm:learn`           | `/openltm:memory learn`    | mechanical | v1.6.0 |
| `/openltm:decay-report`    | `/openltm:health`          | output format slightly different — note in warn | v1.6.0 |
| `/openltm:capture`         | `/openltm:memory learn --save-context` | flag added | v1.6.0 |
| `/openltm:doctor` (legacy) | `/openltm:health`          | `health` covers diagnostic | v1.6.0 |
| `/openltm:migrate`         | `/openltm:admin migrate`   | mechanical | v1.6.0 |
| `/openltm:hook-doctor`     | `/openltm:doctor`          | folded into doctor | v1.6.0 |
| `/openltm:migrate-db`      | `/openltm:admin migrate --legacy` | flag now | v1.6.0 |
| `/openltm:secrets-scan`    | `/openltm:admin scan`      | mechanical | v1.6.0 |
| `/openltm:recall`          | `/openltm:memory recall`   | mechanical | v1.6.0 |
| `/openltm:ltm-server`      | `/openltm:admin server`    | mechanical | v1.6.0 |

### 7.5 Action Items For This Section

1. Add `quietDeprecations` config flag to suppress repeated warnings.
2. Add a one-time "you can suppress this" hint on first deprecation hit.
3. README sweep — replace every deprecated command reference.
4. CHANGELOG entry for v1.6.0 listing the removals (already partial).
5. `/openltm:doctor` should report deprecated commands the user has run in the
   last 7 days (sourced from a small usage log).

---

## 8. Magnificent UX Vision

Bold redesign. Not all of this ships in one release; this is the north star.

### 8.1 The Five Surfaces of a Magnificent LTM

```
┌──────────────────────────────────────────────────────────────────┐
│  S1 — Ambient Context Injection                                  │
│       Memory appears IN flow without being asked                 │
├──────────────────────────────────────────────────────────────────┤
│  S2 — Smart Recall Surfacing                                     │
│       Claude proactively says "we already decided X" mid-task    │
├──────────────────────────────────────────────────────────────────┤
│  S3 — Memory Review UI                                           │
│       Weekly 60-second digest: what's stale, what's new          │
├──────────────────────────────────────────────────────────────────┤
│  S4 — Team Handoff (G-A target)                                  │
│       Export a signed memory bundle; teammate imports            │
├──────────────────────────────────────────────────────────────────┤
│  S5 — Onboarding Wizard (G-O target)                             │
│       First-run flow that yields value in < 5 minutes            │
└──────────────────────────────────────────────────────────────────┘
```

### 8.2 S1 — Ambient Context Injection

**Today:** SessionStart injects a static block. Once per session.
**Magnificent:** Context injection is *continuous*. As the user types about
a topic, relevant memories surface in a sidebar-style annotation:

```
┌──────────────────────────────────────────────────────────────────┐
│ User: I'm going to add Supabase RLS to the orders table         │
│                                                                  │
│ Claude:                                                          │
│   ┌─ Recalled (3 memories matched) ──────────────────────────┐  │
│   │ ★5 [m_142] "RLS must be enabled before prod"             │  │
│   │ ★4 [m_201] "Use service role for admin migrations"       │  │
│   │ ★3 [m_087] "Test RLS with anon key — easy to forget"     │  │
│   │ ↳ Cite [m_142,201]   ↳ Forget    ↳ Hide                  │  │
│   └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│   I'll set up RLS on `orders`. From [m_142] we know this must   │
│   land before prod, and [m_201] flags using the service role…  │
└──────────────────────────────────────────────────────────────────┘
```

The recalled-block is **collapsible** (one keystroke to expand/collapse), so
power users can scan, novices can explore.

### 8.3 S2 — Smart Recall Surfacing

**Today:** Claude calls `recall` only when CLAUDE.md tells it to.
**Magnificent:** A lightweight pre-tool-use hook fires `recall` whenever:

- User mentions a known tag (e.g., #supabase, #auth) → preempt with relevant gotcha.
- User starts a TDD/spec/build flow → inject project's design memories.
- Claude proposes an action that contradicts a stored decision → block + ask.

The conflict-block UX (G-F):

```
┌──────────────────────────────────────────────────────────────────┐
│ ⚠ Memory Conflict Detected                                       │
│                                                                  │
│ Your current request would contradict:                           │
│   [m_142] ★5 "We use Bun, never npm"                            │
│                                                                  │
│ Proceed anyway? Options:                                         │
│   ↩ Override once     ⌫ Update m_142     ✗ Cancel               │
└──────────────────────────────────────────────────────────────────┘
```

### 8.4 S3 — Memory Review UI

**Weekly digest** that ships in `/openltm:health --review`:

```
┌──────────────────────────────────────────────────────────────────┐
│ 📊 LTM Weekly Review — week of 2026-04-21                        │
│                                                                  │
│ This week:                                                       │
│   +12 memories captured (8 patterns, 3 gotchas, 1 architecture)  │
│   ↑18 recall hits used in decisions                              │
│   ↓ 3 memories aged into "stale" bucket                          │
│                                                                  │
│ ▸ Stars of the week (most recalled):                            │
│   [m_142] "RLS must be enabled before prod"   ✓5 hits           │
│   [m_087] "uv replaces pip for Python"        ✓3 hits           │
│                                                                  │
│ ▸ Candidates to forget (no recalls in 90d, importance ≤ 2):     │
│   [m_023] "Old Tailwind v2 config tip"        last used: 142d   │
│   [m_041] "Webpack hot-reload workaround"     last used: 198d   │
│   ↩ Forget all   ↩ Forget [m_023]   ✗ Keep                     │
│                                                                  │
│ ▸ Pending learnings (proposed by EvaluateSession):              │
│   "Supabase storage bucket naming convention" · pattern          │
│   ↩ Accept   ⌫ Edit   ✗ Discard                                 │
└──────────────────────────────────────────────────────────────────┘
```

### 8.5 S5 — Onboarding Wizard (G-O)

The single highest-leverage UX investment. Auto-fires on first SessionStart
after install when `openltm.db` is empty.

**Full ASCII flow:**

```
═══════════════════════════════════════════════════════════════════
  Welcome to LTM — your durable memory for Claude Code.
  This 3-minute setup gets you to value before your first task.
═══════════════════════════════════════════════════════════════════

[1/5] Detecting projects…
       I scanned ~/projects and ~/work. Found 7 git repos.
       Pick the ones you actively work in (space to toggle, enter to confirm):

       [x] ~/projects/OpenLtm
       [x] ~/projects/dev-team
       [ ] ~/projects/old-side-thing
       [x] ~/work/main-app
       [ ] ~/work/legacy-thing
       …

[2/5] Registering 3 projects in registry…
       ✓ OpenLtm
       ✓ dev-team
       ✓ main-app

[3/5] Seed a goal for each? (skip with N)
       OpenLtm > "Ship magnificent LTM by Q3"
       dev-team           > "10-agent orchestration MVP"
       main-app           > [skip for now]

[4/5] Optional: backfill memory from git history (GitLearn).
       I'll scan recent commit messages and propose ~20 candidate
       memories per repo. You confirm what's worth keeping.

       Run now? [Y/n] Y

       OpenLtm: scanning 247 commits…
       Proposed 18 candidate memories:

         [1] ★5 gotcha — "MCP server reads from cache, not source"
         [2] ★4 pattern — "Use bunx not npx for plugin commands"
         [3] ★3 architecture — "Hooks live in hooks/src/, lib in hooks/lib/"
         [4] ★2 preference — "Conventional commits with feat/fix/release"
         …

       [↓ to scroll] [a to accept all] [number to toggle] [enter to confirm]

       ✓ Accepted 14 of 18.

[5/5] Set up importance-5 globals (inject into EVERY session, EVERY project).
       I noticed these patterns across your projects — promote any?

         [ ] "Use Bun, never npm" (seen in 3 projects)
         [ ] "RLS must be enabled before prod" (seen in 2 projects)
         [ ] "Conventional commits required" (seen in all)

       [a to accept all] [number to toggle]
       ✓ Promoted 3 globals.

═══════════════════════════════════════════════════════════════════
  Setup complete. Your LTM is seeded with 14 project memories +
  3 globals, ready to recall.

  Try: /openltm:memory recall "your topic"
  Or just start working — context auto-injects on every session.

  Next steps when you have a moment:
    • /openltm:health         — see project health scores
    • /openltm:admin server   — open the graph view in browser
    • /openltm:project pause  — temporarily disable injection
═══════════════════════════════════════════════════════════════════
```

### 8.6 S4 — Team Handoff (G-A)

Lower priority but designed-in for a future release.

**Export:**
```
> /openltm:team export --project main-app --include "decision,gotcha"

Exporting 47 memories to main-app-memories-2026-04-28.ltm.json
Signed with: ed25519:rohi-rikman-laptop-2026
File: ./main-app-memories-2026-04-28.ltm.json (12 KB)
```

**Import (teammate):**
```
> /openltm:team import ./main-app-memories-2026-04-28.ltm.json

Bundle from: rohi-rikman (verified ed25519 signature)
Project: main-app (registered locally as: main-app-fork)
Contains: 47 memories (32 decisions, 15 gotchas)

  ▸ 41 new — will import
  ▸  5 conflict with local memories — review each:

    LOCAL : [m_201] ★3 "Use REST endpoints for auth"
    REMOTE: ★5 "Use GraphQL endpoints for auth"
    [k] keep local   [r] replace   [c] coexist (both stored)

  ▸  1 already exists locally — skip

Apply? [Y/n]
```

### 8.7 Memory Surfaces (UI Component Inventory)

For frontend-developer to implement progressively:

| Surface          | Implements | Where it lives          | Priority |
|------------------|------------|-------------------------|----------|
| Context block    | SessionStart inject  | Top of every session   | Built |
| Recall card      | inline `recall` result | In conversation        | Built |
| Conflict modal   | G-F        | Pre-write block         | P1 |
| Weekly digest    | S3         | `/openltm:health --review`  | P1 |
| Onboarding wizard| G-O / S5   | First-run flow          | P0 |
| Graph app v2     | G-N        | Browser localhost:7331  | P2 |
| Team handoff UI  | G-A / S4   | New `/openltm:team` cmd     | P3 |
| Pending-learnings tray | EvaluateSession proposal queue | SessionStart top  | P1 |

### 8.8 Magnificent Defaults

Things that should "just work" without ever being typed:

1. New project detected → register prompt fires (one keystroke).
2. Same gotcha hit twice → auto-promote to importance 5.
3. Conflicting memory written → conflict modal, never silent overwrite.
4. Memory unused for 180d + importance ≤ 2 → propose forget in weekly review.
5. Secret detected on write → redact + show inline indicator + log.
6. Schema migration available → run on next session (with one-line notice).

---

## 9. Accessibility & Cognitive Load

### 9.1 The Cognitive Surface Today

A user must internalize this much to be fluent:

- **5 grouped commands**: `/openltm:memory`, `/openltm:project`, `/openltm:admin`,
  `/openltm:health`, `/openltm:doctor`
- **11 deprecated aliases** still functional (creates "which one?" doubt)
- **4 memory categories** (preference / architecture / gotcha / pattern /
  workflow / constraint — actually 6, mistake-prone)
- **4 context types** (goal / decision / progress / gotcha)
- **6 relationship types** (supports / contradicts / refines / depends_on /
  related_to / supersedes)
- **5 importance levels** (1-5, with 5 = global injection)
- **4 hooks** (SessionStart / PreCompact / EvaluateSession / UpdateContext —
  user shouldn't *have* to know but does when debugging)
- **4 skills** (ContinuousLearning / Learned / session-context / GitLearn)

**Total surface: ~40 distinct concepts.** Too many.

### 9.2 Cognitive Load by Persona

| Persona | What they MUST know | What's unnecessary noise |
|---------|---------------------|--------------------------|
| Sam (solo dev) | recall, learn, project init, health | admin, relate types, hooks |
| Pat (power user) | All of the above + relate, admin scan, graph app | nothing — Pat reads everything |
| Tara (team lead) | health, future team export/import | scan internals |
| Ezra (regulated) | scan (--dry-run + apply), redaction proof | learn-frequency |
| Noor (onboarder) | onboarding wizard, GitLearn | everything else day 1 |

**Insight:** the average user only needs **3 commands** to be productive:
`recall`, `learn`, `health`. Everything else is power-user surface.

### 9.3 Proposed Simplification

**Tier 1 — Always visible (3 commands, 5 verbs):**

```
/ltm recall <query>            ← drop the :memory:
/ltm learn <insight>           ← drop the :memory:
/ltm health                    ← already short
/ltm forget <id>               ← promote from sub-command
/ltm init                      ← promote from /openltm:project init
```

**Tier 2 — Power-user surface (under `/ltm` parent menu):**

```
/ltm relate                    ← edge management
/ltm analyze [topic]           ← pre-task synthesis
/ltm register                  ← project registration
/ltm scan                      ← secret scan
/ltm migrate                   ← schema migrations
/ltm server [start|stop]       ← graph app
/ltm doctor                    ← deep diagnostics (admin/health are
                                 enough for everyday)
```

**Tier 3 — Implicit (never typed):**

```
context injection  ← hooks
auto-redaction     ← on write
decay scoring      ← cron in /openltm:health
EvaluateSession    ← proposes via tray, never auto-writes
PreCompact         ← invisible
UpdateContext      ← invisible
```

### 9.4 Naming Cleanups

| Old | New | Why |
|-----|-----|-----|
| `/openltm:memory recall` | `/ltm recall` | Drop redundant `memory:` namespace — everything is memory |
| `/openltm:admin scan` | `/ltm scan` | One-word, matches mental model |
| `--save-context` flag | `--pin` | Shorter, conveys "this matters now" |
| `category=preference` vs `pattern` | merge | Today's distinction is unclear; collapse to 4 categories: gotcha · decision · pattern · note |
| `relationship_type` | `link` | "link" is what users say |
| `importance` | `weight` | "5 is most important" maps better to weight than to "5 stars" |

(Backward-compat aliases for one major version, then sunset per §7.)

### 9.5 Reduced Cognitive Surface

After §9.3 + §9.4, the user's mental model shrinks to:

- **5 commands** they type often (recall, learn, forget, init, health)
- **4 categories** (gotcha, decision, pattern, note)
- **5 link types** (supports, contradicts, supersedes, refines, related)
- **3 weights** (low/med/high — internally still 1/3/5)

**Total: ~17 concepts.** Down from ~40. That's the magnificent surface.

### 9.6 Accessibility (Output Format)

The plugin's UI is text-only, which is mostly accessible. Specific guidance:

- **Color is decorative, never load-bearing.** Status icons (🟢 🟡 🔴) must
  always be paired with the word (`healthy`, `needs_attention`, `neglected`).
- **Tables align with ASCII pipes**, not unicode box-drawing, for terminal
  reader compatibility.
- **Truncation indicators** (`+12 more — recall to explore`) are explicit
  rather than `...`.
- **Long output is paginated** (`/openltm:memory recall --limit 10` default; user
  can ask for more) rather than dumped.
- **No emoji-only signals.** Always pair with text label (e.g., `★5` not just
  star count). Screen-reader friendly.
- **Keyboard-only navigation** for any future TUI (onboarding wizard, weekly
  review): arrows + space + enter, no mouse.

---

## 10. Hand-off

This UX spec defines the surface. Implementation is split:

**For frontend-developer (when ready):**
- §8.5 onboarding wizard (G-O) — TUI flow, ASCII layout authoritative.
- §8.4 weekly digest (S3) — output format authoritative.
- Graph app v2 (G-N) — separate component-level spec needed (TBD).
- Inline conflict modal (S2 / G-F) — needs Claude Code prompt-injection hook.

**For system-architect:**
- Backing schema for "pending learnings" tray (§3.3 EvaluateSession).
- Pin-to-survive-compact mechanism (§3.2 PreCompact pain point).
- Memory bundle format + signature scheme (§8.6 G-A).

**For product-manager:**
- Resolve PRD §9 OQ4 (auto-write vs propose) — UX recommends propose.
- Prioritize §8 surfaces (P0 onboarding, P1 weekly digest, P2 graph v2,
  P3 team handoff).

**For qa-tester:**
- §6 error states — each row is a regression test.
- §7.4 deprecation table — each alias has a migration test.

§4 (memory lifecycle) and §9 (cognitive surface) are vision; treat as
direction, not contract.

---

*End of UX-SPEC v1.0.*
