# Frontend Redesign — OpenLTM Graph App

**Date:** 2026-06-04
**Status:** Vision document, intended for product team hand-off
**Scope:** The web/graph-app surface only (CLI/commands out of scope)
**Inspiration:** 21Dev (calm, reading-first hierarchy) · Referral (modular sections, status-as-ambient, no noise)

---

## 0. TL;DR

The current product has 7 conceptual top-level items in its left rail: **Projects, Graph, Search, Health, Inbox, Config, Settings**. The redesign collapses these into **4 primary destinations + 1 global command surface**:

```
┌────────────────────────────────────────────────────────────────────┐
│  PRIMARY NAV (4)              GLOBAL SURFACES (always present)     │
│  ──────────────               ─────────────────────────────         │
│  • Projects                   • ⌘K — search, nav, actions          │
│  • Graph                      • Status bar (backend, sync, score)  │
│  • Inbox                      • Project switcher (top-left)        │
│  • Settings                   • Pending learnings tray (transient)│
│                                                                    │
│  WHAT DISAPPEARS:                                                  │
│  • "Search" page   → ⌘K (already exists, becomes the ONLY search) │
│  • "Health" nav    → ambient status chip everywhere + Settings tab│
│  • "Config" nav    → merged into Settings (new "System" section)  │
│  • "F" / Files     → Project IS the file/unit; no separate concept│
└────────────────────────────────────────────────────────────────────┘
```

The 21Dev/Referral principles that drove these cuts:
- **One job per nav item.** If two items overlap, merge them. (Projects and F overlap → Projects wins.)
- **Search is a verb, not a place.** (21Dev treats search as a top utility, not a route.)
- **Status is ambient, not a destination.** (Referral shows health as a chip in the corner, not a tab.)
- **The graph is a lens, not a place.** It belongs next to the data, not above it.

---

## 1. Top-level navigation: what stays, what merges, what disappears

### 1.1 The new left rail (4 items)

```
┌──────────────────────────────────┐
│  [⌘K Search]                     │  ← ghost input, top of rail
│                                  │
│  ┌── Projects          ← home  │  default route
│  ├── Graph                       │  global graph view
│  ├── Inbox           [3 pending] │  attention-requiring work
│  └── Settings                    │  system + behavior + health
│                                  │
│  ─── status ───                  │
│  ● live · vec · 82/100           │  ambient backend/score chip
│  claude-ltm-plugin               │  current project
└──────────────────────────────────┘
```

### 1.2 What happens to each of the 7 current items

| Item | Verdict | Where it goes | Why |
|------|---------|---------------|-----|
| **Projects** | **STAYS** (primary) | `/` — same route | The fundamental unit of work. Home. |
| **Graph** | **STAYS** (primary) | `/graph` — same route | Differentiating feature; the only place you SEE relationships. |
| **Search** | **DISAPPEARS as a route** | ⌘K command bar (already built) | A search *page* is a code smell. Search is a verb, not a destination. |
| **Health** | **DISAPPEARS as a route** | (a) Ambient chip everywhere · (b) Settings → Health tab | Health is information, not a workspace. Put it where the user is looking. |
| **Inbox** | **STAYS** (primary) | `/inbox` — rename from `/pending` | Real, attention-requiring work. The name "Inbox" is human; "pending" is engineering jargon. |
| **Config** | **MERGES into Settings** | Settings → System section | Config was a duplicate of Settings with worse IA. |
| **Settings** | **STAYS** (primary) | `/settings` | Now contains: System · Behavior · Health · Advanced · About |
| **"F"** | **REMOVED** | n/a | A redundant "files" concept that duplicates the Project view. There is no F in the new IA. |

### 1.3 Naming corrections

- `/pending` → **`/inbox`** (user-facing, less engineering-jargon)
- `Settings & Config` → **`Settings`** (drop "& Config"; the contents are now properly organized inside)
- "Project" sub-views called "Table/Board/Connections" → **`Memories / Timeline / Connections`** (clearer verbs)
- "Context items" → **`Project State`** (goal · decisions · progress · gotchas — all together as "the state of this work")

### 1.4 Why 4 items and not 5, 6, or 7

The cognitive science of navigation (Jakob Nielsen, Edward Tufte, the *Information Architecture* literature) is consistent: **4 ± 1 primary items** is the sweet spot. Beyond that, users start hesitating. Linear, Notion, Vercel, Stripe Dashboard, and 21Dev itself all use 4-5 items. The current 7-item IA violates this — and is the proximate cause of the "cluttered, hard to reason about" feeling.

---

## 2. The "Project" concept — full rethink

### 2.1 What a Project is (definition)

A **Project** is the unit of work that memory is anchored to. It is:

- **Bounded** — a folder, repo, or topic ("claude-ltm-plugin", "ai-soc-assistant", "general architecture").
- **Has a goal** — 1-3 sentences captured at registration. This is the first thing injected at SessionStart.
- **Has captured state** — goal · decisions · progress · gotchas. These are the *context* that Claude sees.
- **Has memories** — discrete insights (preference, pattern, gotcha, decision) that can be recalled, related, decayed, redacted.
- **Has a health score** — 0-100, weighted by memory count, freshness, decay.
- **Can be global or scoped** — A `*`/global project owns memories that inject into every session; regular projects scope.

A Project is **not**:
- A file explorer. (You don't browse files here.)
- A code viewer. (The plugin tracks memory about code, not code itself.)
- A documentation hub. (Decisions are captured as memory, not written as docs.)

### 2.2 The 5 screens inside a Project

The current product has all of these but crammed into one 263-line page (see `app/project/[name]/page.tsx`). The redesign introduces **sub-routes with clear purposes**:

```
/projects                                 (project list — home)
/projects/:name                           (project overview — default)
/projects/:name/memories                  (all memories, table/board)
/projects/:name/timeline                  (chronological history)
/projects/:name/connections               (graph scoped to this project)
/projects/:name/health                    (deep diagnostics for this project)
```

#### Screen A — Project Overview (`/projects/:name`)

The default landing for a project. What the user sees when they "open" a project.

**Above the fold (one screen, no scroll):**
- **Project name + health chip** (e.g., "claude-ltm-plugin · 82/100 · 🟢")
- **Goal** — 1-3 sentences, editable inline. The first thing any new agent sees.
- **State panel** — 4 columns: Goals · Decisions · Progress · Gotchas (collapsible)
- **Mini-graph** — small, low-detail, shows last 30 days of activity. Click to open Connections view.

**Below the fold:**
- **Recent memories** (5 most recent)
- **Activity timeline** (last 7 days)
- **Quick actions** — "Add memory", "Capture decision", "Run analyze"

#### Screen B — Memories (`/projects/:name/memories`)

The "all memories" view. This is the table/board that currently lives in the bottom of the project page.

**Information hierarchy:**
- **Filter bar (top, sticky):** category (chip multi-select), importance (slider), tag, "stale only" toggle, "permanent only" toggle
- **Default view: Table** (rows are memories; columns: content, category, importance, tags, last-used, actions)
- **Toggle: Board** (Kanban grouped by category, drag to reorganize)
- **Bulk actions:** Forget · Relate · Mark permanent · Export
- **Empty state:** "No memories yet. Run `/ltm recall` or capture a decision."

**Why this is a separate screen, not a section:** The current layout makes the table feel like a footnote. Memories are the *primary* artifact of LTM — they deserve their own first-class screen.

#### Screen C — Timeline (`/projects/:name/timeline`)

Chronological history. When was this decided? When did we capture that gotcha?

- Vertical timeline grouped by week
- Each event: timestamp, category dot, snippet, "open" link
- Filterable by category
- "Jump to graph" button on each event → opens Connections centered on that node

#### Screen D — Connections (`/projects/:name/connections`)

The graph, scoped to this project. (See section 3.)

#### Screen E — Health (`/projects/:name/health`)

Deep diagnostics for *this* project only.

- Score breakdown (memory count, freshness, decay, coverage)
- Stale memories list (with one-click forget)
- Conflict detector (decisions that contradict each other)
- Coverage gaps (topics that *should* have memory but don't)
- "Memory diet" — auto-suggested cleanup plan

### 2.3 How Projects, Graph, and Search connect (the cross-flows)

The key UX problem right now: **once you're in a project, the graph and search feel disconnected from the work.** Three flows fix this:

**Flow 1: Project → Graph**
- The project header has a "View connections" button (mini-graph → full Connections view, scoped).
- Memories selected in the project table → "Open in graph" button → graph opens centered on those nodes.

**Flow 2: Graph → Project**
- The graph defaults to the *current* project (read from project switcher).
- Cluster labels in the graph show project names — clicking jumps to that project.
- Inspector sidebar (right) for any node shows "Open in project →" link.

**Flow 3: Search → Project / Graph**
- ⌘K search results from a project are grouped under that project's name.
- Clicking a result opens the inspector in the **graph** (not a generic detail page) — because the graph is the canonical view of a single memory.
- Pressing `⌘ + Enter` on a result opens the project's Connections view centered on that memory.

### 2.4 The Project Switcher (replaces the "F" concept)

The "F" nav item in the current product was a partial project switcher with no IA. The redesign makes this a **first-class, top-left, always-visible control**:

```
┌─────────────────────────────────────────────────────────────┐
│  OpenLTM                                          ⌘K  [👤] │
│  ┌─────────────────┐                                         │
│  │ ⌥ claude-ltm-…  │  ← current project, click to switch  │
│  └─────────────────┘                                         │
│  ────                                                        │
│  Projects                                                    │
│  Graph                                                       │
│  Inbox                                                       │
│  Settings                                                    │
└─────────────────────────────────────────────────────────────┘
```

- Click → dropdown of all registered projects + "All projects (global)" + "Add new project"
- **Memory injection scope follows this switcher** — when you're "in" claude-ltm-plugin, that project is the default scope for recall and graph
- The switcher persists across page navigation (it's a global context, not a per-page state)

This is what the "F" was trying to be, but with proper IA and visual weight.

---

## 3. The Graph experience — from first principles

### 3.1 The current problem

The current graph is a **free-form force-directed cluster of all memories across all projects**. With >40 memories it becomes an undifferentiated point cloud. With >200 it's unusable. Three structural issues:

1. **No orientation.** "What is this blob?" — there's no labeled structure, no legend of "this cluster = auth concerns, that cluster = build setup."
2. **Hard to find anything.** The search bar dims non-matches, but the user still has to spot the dot.
3. **No productive verbs.** You can click, but you can't *do* anything except look.

### 3.2 The redesign: the graph is a lens, not a destination

**Three principles:**

1. **The graph is scoped by default.** It shows the *current project's* memories, not a global blob. The user can opt into "all projects" via a toggle.
2. **The graph has two modes, not one.** Spatial (default) and Chain (for tracing decisions).
3. **The graph has productive verbs.** "Trace this decision", "Find conflicts", "Why did we do X?" — these are first-class actions on selected nodes.

### 3.3 Mode 1: Map (default)

A spatial overview, but **opinionated structure** — not a free-for-all.

- **Auto-clustered by topic** using the existing `clusters` API. Each cluster is labeled (e.g., "auth & RLS", "Bun tooling", "claude-ltm-plugin internals") with a colored hull.
- **Project boundary visible** when in "all projects" mode — nodes from each project get a subtle background tint.
- **Category colors preserved** — the existing `nodeColors.ts` system stays.
- **Selection model:**
  - Click a node → inspector opens (right rail) showing memory detail
  - Shift-click → multi-select; counts and actions appear in a floating toolbar
  - Click a cluster → zooms to that cluster, shows cluster summary in inspector
- **Filter is navigation, not just dimming:**
  - Type a search → graph filters live (already implemented) but ALSO recenters on matches
  - Click a tag → graph filters to that tag's nodes AND their 1-hop neighborhood
  - The Filter Rail (left) is **closed by default** — power-user only, doesn't clutter the canvas

### 3.4 Mode 2: Chain (new)

A **linear reasoning view** for a single decision/gotcha. Use case: "Why did we choose X?"

- Pick a memory (any node) → "Trace origin" button
- The graph **animates a path** back through relations to the source decision(s)
- Displayed as a horizontal flow: [original gotcha] → [decision] → [consequence memory] → [current question]
- Each step is clickable to open its detail
- Use this mode for retrospectives, onboarding new agents, or post-mortems

### 3.5 What the graph gets rid of

- The **decorative electric effects toggle** (already in code as `Zap`/`ZapOff`) — this is a "look at me" feature, not productive. Remove by default. (If users ask, it's behind an experimental flag.)
- The **"Show clusters" toggle** — clusters should be ON by default. Toggling them off is a power-user move and doesn't belong in the floating toolbar.
- The **"Fit to screen" and "Reset simulation" toolbar buttons** — accessible via keyboard shortcuts (`F` and `R`) but not in the main UI; they add visual noise to first-time users.

### 3.6 What the graph gets

- **A semantic zoom that respects node importance** — important memories (stars 4-5) are always larger; low-importance nodes shrink to dots at high zoom-out levels
- **A "What's in this neighborhood?" hover** — hover a cluster hull for 1s, see a tooltip with the top 3 memories in that cluster and the cluster's tag list
- **Quick "Why?" tooltip** on any decision node — shows the source gotcha inline (no need to open inspector)
- **Right-click menu** with: "Open in project", "Mark permanent", "Forget", "Find conflicts" — productive verbs

---

## 4. The Search experience — verb, not place

### 4.1 The current problem

The "Search page" today is a full route with a small visualization in the corner and a basic input. It's the worst of both worlds: it doesn't have the focus of ⌘K, and it doesn't have the depth of a real search UI. It also duplicates the ⌘K command bar.

### 4.2 The redesign: delete the page, double down on ⌘K

**There is no /search page in the new IA.** Instead, the ⌘K command bar (already implemented as `Omnibar.tsx`) becomes the only search surface, with these upgrades:

#### 4.3 ⌘K — the global command bar

**Trigger:** `⌘K` or `Ctrl+K` from anywhere. Visible in the top of the left rail as a ghost input — already implemented.

**Inputs covered:**
- Memories (FTS5 keyword + vector semantic)
- Projects (fuzzy name match)
- Tags (fuzzy match)
- Context items (goals, decisions, gotchas, progress)
- Commands (e.g., "go to settings", "open inbox", "run decay")
- Navigation jumps (jump to any route)

**Result grouping (top to bottom):**
1. **Actions** — commands and navigation (highest, only shown if relevant)
2. **Memories** — grouped by project, with category dot, snippet, similarity score
3. **Projects** — name + memory count
4. **Tags** — name + count

**Each result row shows:**
- Category dot (color from existing `nodeColors.ts`)
- Snippet (truncated content, ~80 chars)
- Project name (if scoped)
- Similarity score (for semantic results) or match count (for keyword)
- Keyboard hint: `↩` open · `⌘↩` open in graph · `⌥↩` open in project

**Search modes (toggle in the command bar):**
- **Semantic** (default) — vector similarity, finds by meaning
- **Keyword** — FTS5 exact match
- **Tag** — `#tag` syntax, jumps to filter

#### 4.4 Search history and saved searches

- **History:** last 10 searches, shown as a separate group when ⌘K opens with empty input. Click to re-run.
- **Saved searches:** user can save a current search as a named bookmark (e.g., "Auth gotchas in dev-team"). Saved searches live under Settings → Saved Searches and as a panel triggered by a `⌘⇧K` shortcut.

#### 4.5 How Search connects to Projects and Graphs

This is the cross-flow that was missing:

| From | Action | Lands on |
|------|--------|----------|
| ⌘K result (memory) | `↩` | Inspector in current context (graph or project) |
| ⌘K result (memory) | `⌘↩` | Graph, centered on that memory |
| ⌘K result (memory) | `⌥↩` | Project, with the memory highlighted in the Memories table |
| ⌘K result (project) | `↩` | That project's Overview |
| ⌘K action (e.g., "go to inbox") | `↩` | Routes to /inbox |
| Mini-graph hover in project | Click | Full Graph, scoped to project |
| Graph inspector "Open in project" | Click | Project's Memories table, row scrolled into view |

The "small cube and little real search utility" is replaced by a **verb-rich, context-aware command bar** that knows where you are and where you're going.

---

## 5. Config / Settings — clear separation, deep hierarchy

### 5.1 The current problem

The current `/settings` page is 19KB of mixed content. From the screenshot, I see:
- Provider Settings (API keys, model selection)
- Behavior Toggles (graph reasoning, auto-relate, decay, inject top N)
- System Explorer (skills, etc.)

It's a **junk drawer**. The user can't find anything without scrolling, and there's no mental model of "where does this setting belong?"

### 5.2 The redesign: 5 sections, each with a job

The new Settings has 5 clearly separated sections, in this order:

#### Section 1: System (one screen, ~60% of all settings)
**Job: "Connect OpenLTM to the world"**

- **AI providers**
  - Embedding provider + model
  - LLM provider + model
  - API key entry (masked, with show/hide and rotate)
  - Connection status chip
- **Backend connection**
  - Port (default 7331)
  - Bind address
  - WebSocket URL
- **Storage**
  - Database path
  - Schema version + last migration
  - Backup / restore

#### Section 2: Behavior (the toggles — what to do with memory)
**Job: "How does memory behave?"**

- **Memory decay** — on/off, threshold, scan frequency
- **Auto-relate** — on/off, similarity threshold for auto-linking
- **Graph reasoning** — on/off, max depth
- **Inject top N** — slider for SessionStart injection count
- **Importance threshold** — for permanent memories
- **Conflict detection** — on/off, action on conflict (block / warn / silent)

#### Section 3: Health (the page that used to be a nav item)
**Job: "How is the system doing?"**

- **System score** (0-100) with trend arrow
- **Per-project scores** (linked to each project's Health tab)
- **At-risk memories** count
- **Pending learnings** count
- **Hook status** (SessionStart, PreCompact, EvaluateSession, UpdateContext)
- **Run diagnostics** button (replaces the old `/ltm:doctor`)
- **Last decay scan** timestamp

#### Section 4: Advanced (collapsed by default)
**Job: "Power-user escape hatch"**

- Database reset (with confirmation)
- Migration tools
- Reindex vectors
- Debug logging
- Export / import (team handoff, future)

#### Section 5: About
**Job: "What's this thing?"**

- Version, license
- Documentation link
- GitHub link
- "Send feedback" mailto

### 5.3 The Config → Settings merge

The old "Config" nav item is gone. Every setting lives in one of these 5 sections. The mental model: **Settings is the place. The sections are how you find what you want.** No more "is it Config or Settings?" confusion.

### 5.4 System-level vs project-level settings (the boundary)

Some settings are global (one value for the whole system), some are per-project (override per project). Today this distinction is unclear. The redesign:

- **System-level settings** (default, in Settings)
- **Project-level overrides** (in `/projects/:name/settings` — a new sub-route)

Example: Inject top N. The system default is 15. The project "claude-ltm-plugin" might want 25 (it has more memory). The user goes to that project's settings to override.

UI pattern: Each Behavior setting has two controls — "Default (system)" and "Override for this project." Override is opt-in.

---

## 6. Reasoning: the principles behind each decision

### 6.1 The Seven Principles

These are the load-bearing design rules. Every decision above traces back to one of them.

1. **One job per nav item.** If two items overlap, merge them. (Projects and F → Projects. Config and Settings → Settings.)
2. **Search is a verb, not a place.** ⌘K is universal. A "Search" route creates two paths to the same thing.
3. **Status is ambient, not a destination.** Health is a chip everywhere; the deep version lives under Settings.
4. **The graph is a lens, not a place.** It belongs next to the data, scoped to the current project, not a global blob.
5. **The project is the unit of work.** Everything in the system anchors to a project. Project is the home, the context, the file, the history.
6. **Transient things get a fixed home but clear themselves.** Inbox exists for attention-requiring work, but the design should make inbox-zero the normal state, not the achievement.
7. **Config is deep, not flat.** API keys and dark-mode toggles do not belong at the same level. Hierarchy is kindness.

### 6.2 Inspired by 21Dev

21Dev treats the *content* (news, articles, posts) as the hero. Navigation is minimal (4-5 items). The command surface is fast and forgiving. The visual hierarchy is calm — generous whitespace, restrained type, no decorative effects. Applied to LTM: **memory is the content; the chrome is invisible**.

### 6.3 Inspired by Referral

Referral groups settings into clearly-named sections (Connections, Notifications, Privacy, etc.). Each section is a *job*, not a list of related toggles. The status surface is ambient — connection health, sync state, last activity — all visible without being intrusive. Applied to LTM: **Settings is typed (System / Behavior / Health / Advanced / About), and status chips live in the bottom rail, not the nav**.

### 6.4 What we explicitly do NOT copy

- 21Dev's editorial layout (we're a tool, not a publication — no article hero, no author cards).
- Referral's network/contacts metaphor (we have no equivalent concept).
- Any specific visual treatment (color, type, density). The current studio-black aesthetic is preserved; the redesign is purely IA and structure.

---

## 7. Implementation roadmap (rough sequence)

This is a 3-phase rollout, designed so each phase is independently shippable:

### Phase 1 — Cut (no new features, just remove redundancy)
- Remove "F" / redundant Projects entry
- Remove the "Search" route
- Add /inbox alias to /pending; deprecate /pending
- Move "Config" content into Settings (rename "Settings & Config" → "Settings")
- Add ⌘K shortcut to the search bar in the left rail (so it's discoverable, not just a hidden command)

**Effort:** 2-3 days. Mostly renaming and re-routing.

### Phase 2 — Restructure (5 sub-routes per project)
- Split `/projects/:name` into Overview / Memories / Timeline / Connections / Health
- Add the Project Switcher (top-left, current-project indicator)
- Implement the Chain mode in the graph
- Add Saved Searches panel

**Effort:** 1-2 weeks. Most of the components already exist (ProjectTableView, ProjectBoardView, ProjectTimeline, etc.) — they just need to live at proper routes.

### Phase 3 — Polish (the delightful details)
- Ambient health chip in left rail (status + current project + score)
- 5-section Settings reorganization
- Project-level settings overrides
- Inspector right-click menu ("Open in project", "Mark permanent", "Find conflicts")
- "Why?" tooltips on decision nodes

**Effort:** 2-3 weeks. Many small components, no architectural changes.

---

## 8. Open questions for the product team

1. **Should the left rail stay left, or move to top?** 21Dev/Referral both use left rails. The current product is top-nav. Left rail gives more vertical real estate for the canvas; top nav is more familiar.
   *My recommendation: switch to left rail — it's better for a graph-heavy product, and matches the user's described mental model.*

2. **Should the Inbox be auto-cleared on dismiss?** Currently pending memories accumulate until manually approved.
   *My recommendation: yes, "dismiss" should soft-delete after 7 days, with a "Recover" option. Inbox-zero becomes the default state.*

3. **Should global memories (importance 5) be visually distinguished in the graph?**
   *My recommendation: yes — a thin gold ring around the node, with a small ★ icon. Currently they're indistinguishable.*

4. **How prominent should the project switcher be?**
   *My recommendation: top-left, always visible, with the current project name. This is the answer to "what's the F?" — F was always meant to be the project context switcher, just badly named.*

5. **Should "Health" be a verb, a noun, or a status?**
   *My recommendation: a status. "System score 82" is a number, not a place. The current `/health` (CLI) and `/ltm:health` are diagnostic tools, not destinations.*

---

## 9. What this document is NOT

- Not a visual mockup. Wireframes and visual treatments are a follow-up.
- Not a CLI/command redesign. The 1138-line `docs/UX-SPEC.md` covers the command surface; this document is the *web frontend* complement.
- Not a backend redesign. All proposed screens map cleanly to existing APIs (`api.graph()`, `api.project()`, `api.health()`, etc.).

---

## 10. Success metrics (how we'll know it worked)

- **Time to first useful action** on a fresh install (target: <90s, down from ~5min)
- **Inbox dwell time** (target: <2s per item, "approve all" used in <20% of sessions)
- **Search-via-⌘K vs search-via-page** (target: 95% of searches go through ⌘K, "search page" route is removed)
- **Graph session time** (target: average session on /graph is <60s, indicating purposeful use, not aimless browsing)
- **Bounce rate on /projects/:name** (target: 50% reduction — users find what they need, don't bounce back to home)
- **Settings → save action** (target: 80% of setting changes happen on the first visit to the right section, not after wandering)

---

*End of spec. Hand off to product team for review and prioritization.*
