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

### 1.1 The new top bar (4 items + persistent surfaces)

> **Decision (2026-06-04):** Keep the **top bar** layout, not a left rail. The Project Switcher sits to the right of the logo; the status chip sits at the far right alongside the theme toggle. This is a smaller change to the existing IA and matches user preference.

```
┌────────────────────────────────────────────────────────────────────────┐
│  [🧠 OpenLTM]  [⌥ OpenLtm ▾]   Projects  Graph  Inbox(3)  Settings  ···  [⌘K Search...]  ···  [● live · 82] [☾] │
└────────────────────────────────────────────────────────────────────────┘
       │              │                    └──── 4 nav items ────┘                  │                  └─ status ─┘
       │              └─ Project Switcher (always visible, click to swap)         └─ Omnibar (already built)
       └─ Logo
```

- **Left:** Logo + Project Switcher (the answer to "what was F?")
- **Center-left:** 4 nav pills — Projects · Graph · Inbox (`N` pending badge) · Settings
- **Center:** Omnibar (⌘K) — already implemented
- **Right:** Status chip (backend + score) · Theme toggle

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

- **Bounded** — a folder, repo, or topic ("OpenLtm", "ai-soc-assistant", "general architecture").
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
- **Project name + health chip** (e.g., "OpenLtm · 82/100 · 🟢")
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

The "F" nav item in the current product was a partial project switcher with no IA. The redesign makes this a **first-class, top-bar, always-visible control** (per the top-bar decision):

```
┌─────────────────────────────────────────────────────────────┐
│  [🧠 OpenLTM]  [⌥ OpenLtm ▾]      Projects  Graph … │
└─────────────────────────────────────────────────────────────┘
```

- Lives to the right of the logo, before the nav pills
- Click → dropdown of all registered projects + **"All projects (global)"** (first-class option, per Q4) + "Add new project"
- **Memory injection scope follows this switcher** — when you're "in" OpenLtm, that project is the default scope for recall and graph
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

- **Auto-clustered by topic** using the existing `clusters` API. Each cluster is labeled (e.g., "auth & RLS", "Bun tooling", "OpenLtm internals") with a colored hull.
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
- **Run diagnostics** button (replaces the old `/openltm:doctor`)
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

Example: Inject top N. The system default is 15. The project "OpenLtm" might want 25 (it has more memory). The user goes to that project's settings to override.

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

This is a 3-phase rollout, designed so each phase is independently shippable. Each phase ships as a version bump: **v2.5.0 → v2.6.0 → v2.7.0**.

### Phase 1 — Cut (v2.5.0) — 2-3 days
No new features, just remove redundancy. Keep the top bar (per Q1).

- Remove "F" / redundant Projects entry
- Remove the "Search" route
- Add /inbox alias to /pending; deprecate /pending
- Move "Config" content into Settings (rename "Settings & Config" → "Settings")
- Add ⌘K shortcut to the search bar in the top bar (so it's discoverable, not just a hidden command)
- Refactor `TopNav.tsx` to the 4-item layout: Projects · Graph · Inbox · Settings
- Slot the Project Switcher to the right of the logo (placeholder until Phase 2 wires it)
- **Inbox auto-clear: NOT YET** (added in Phase 3 per Q2 deferral)

**Effort:** 2-3 days. Mostly renaming and re-routing.

### Phase 2 — Restructure (v2.6.0) — 1-2 weeks
- Split `/project/:name` into `/projects/:name/{overview,memories,timeline,connections,health}` (5 sub-routes)
- Wire the Project Switcher to a Zustand store; defaults to current project, "All" is first-class
- `/graph` defaults to the active project; "All projects" toggle in FilterRail (per Q6)
- Implement the Chain mode in the graph
- Add Saved Searches panel
- Add old `/project/[name]` as a redirect (will be removed per Q5: 2 minor versions, i.e. after v2.7.0)

**Effort:** 1-2 weeks. Most of the components already exist (ProjectTableView, ProjectBoardView, ProjectTimeline, etc.) — they just need to live at proper routes.

### Phase 3 — Polish (v2.7.0) — 2-3 weeks
- 5-section Settings reorganization (System · Behavior · Health · Advanced · About)
- Project-level settings overrides
- Inspector right-click menu ("Open in project", "Mark permanent", "Find conflicts")
- "Why?" tooltips on decision nodes
- Cluster labels: tag-frequency heuristic (LLM in a future v2.8+)
- Inbox auto-clear: 30 days with Recover tray (per Q2)
- Global memories: gold ring + ★ icon in graph
- Search history (last 10)
- Remove decorative toolbar buttons (move to `?` cheatsheet)
- Remove `/project/[name]` redirect at the END of this phase (per Q5)

**Effort:** 2-3 weeks. Many small components, no architectural changes.

---

## 8. Resolved decisions (2026-06-04)

The following open questions have been answered for v2.5.0+:

| # | Question | Decision | Drives |
|---|---|---|---|
| 1 | Left rail or top bar? | **Top bar (keep current)** | Project Switcher slots next to the logo, not in a rail |
| 2 | Inbox auto-clear window? | **30 days with Recover** | Phase 3 task; soft-delete + recover tray in Settings → Health |
| 3 | Cluster labels? | **Tag-frequency heuristic now, LLM later** | Phase 3 ships heuristic; LLM is v2.8+ |
| 4 | Project Switcher "All" option? | **Yes, first-class** | Switcher dropdown lists "All projects (global)" alongside registered projects |
| 5 | How long keep old `/project/[name]`? | **Two minor versions (until after v2.7.0)** | Redirect active through v2.6.0, v2.7.0; removed at v2.8.0 |
| 6 | `/graph` default scope? | **Current project; "All" toggle in FilterRail** | Phase 2 implementation |
| 7 | Version bump cadence? | **One bump per phase** | v2.5.0 (Cut) → v2.6.0 (Restructure) → v2.7.0 (Polish) |

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

---

## 11. Project Layer — Deep Dive

`/project/:name` (current 263-line monolith) splits into 5 sub-routes behind a shared 3-pane shell, plus a per-project Settings sub-route. Phase 2 work.

### 11.0 The shared shell

```
┌─────────────────────────────────────────────────────────────────────────┐
│  TopNav: logo · Projects · Graph · Inbox · Settings        ⌘K Omnibar  │
├─────────────────────────────────────────────────────────────────────────┤
│  Breadcrumb:  Projects / acme-api ▾   (Switcher)  ⎘ Open in graph     │
│  Context chips: Healthy · 142 memories · 3 stale · Last active 2d ago  │
├────────────────┬─────────────────────────────────────┬──────────────────┤
│  SUB-NAV       │        MAIN PANE                    │   INSPECTOR      │
│  (vertical,    │        (changes per route)          │   (right rail,   │
│   56px)        │                                     │    always on)    │
│  ◉ Overview    │                                     │                  │
│  ○ Memories    │                                     │   <selected      │
│  ○ Timeline    │                                     │    memory>       │
│  ○ Connections │                                     │                  │
│  ○ Health      │                                     │                  │
│  ⚙ Settings    │                                     │                  │
└────────────────┴─────────────────────────────────────┴──────────────────┘
```

- **Sub-nav (left, 56px):** Overview · Memories · Timeline · Connections · Health · Settings
- **Main pane (center):** changes per sub-route
- **Inspector (right, 320px):** always on, no toggle

**Visual language:** **Linear** (Refero — midnight command deck). Inter Variable 510/590 voice, Berkeley Mono for IDs, 1px inset borders, 32px row height, instrument-panel density. **Acid-lime `#e4f222` is rationed to two uses:** (a) 2px left bar of the selected sub-nav item, (b) ring around the central project node in the mini-graph. Nowhere else.

### 11.1 Overview (`/projects/:name`)

Top-down layout, no scrolling for the first 4 sections on a 1440px screen:

1. **Hero strip** (120px tall, full width): project name + one-line description + Health gauge (Mercury Blue ring) + 3 pills (Open in graph · Add memory · Run janitor) + Animated Status Badge top-right.
2. **State panel** (3 × 360px columns): Goal card | Recent activity (stacked status pills) | Mini-graph (acid-lime ring on center).
3. **Memory composition** (220px, full width): horizontal bar chart of 6 categories + 4 context types. Hover any bar → switch to Memories with that filter pre-applied.
4. **Top 3 stale memories** (expandable, per-project scope of `StaleMemoryAlert.tsx`): confidence + content + inline Confirm/Edit/Forget actions.
5. **Recent changes feed** (240px, paginated): `ProjectActivityLog.tsx` events wrapped in status pills.

**Best-fit components:**
- **[Animated Status Badge](https://21st.dev/community/components/isaiahbjork/animated-status-badge/default)** (isaiahbjork, 21st) — for the janitor status indicator. Install: `npx shadcn@latest add https://21st.dev/r/isaiahbjork/animated-status-badge`. Deps: lucide-react + framer-motion.
- **[Status Indicators Timeline](https://www.shadcn.io/blocks/timeline-status-indicators)** (shadcn.io block) — for the activity feed. Color-coded emerald/blue/amber/muted pills on a vertical rail.

### 11.2 Memories (`/projects/:name/memories`)

3-pane shell: Filter rail (200px) | Table/Board | Inspector.

- **Filter rail:** 6-category multi-select + importance range slider (1-5) + confidence range slider (0-1) + confidence-only toggle. **Cursor** hairline borders (1px solid) on the filter group cards. Sliders are Linear-style: 2px track, 12px thumb, mercury-blue fill between thumbs.
- **Table view** (default): 32px row height, sticky header, columns: [checkbox] [category dot] [content] [★ importance] [confidence bar] [✓ confirms] [tags] [updated]. Hover: 1px inset border + 2-button row action menu (Open/Edit) slides in from right.
- **Board view:** existing Kanban with inline edit (click content → opens editor). No drag-drop yet (v2.8).
- **Inspector:** existing `MemoryPanel.tsx` — no changes; already uses `SectionLabel`, `CategoryBadge`, `ConfidenceBar`, `TagChip`, `MetaRow`, `RelativeTime`.

### 11.3 Timeline (`/projects/:name/timeline`)

- **Header:** "Activity" + range selector (7d / 30d / 90d / all) + weekly distribution stacked bar.
- **Vertical rail** (left, 1px hairline, full height).
- **Day-grouped sections** (date + "12 events" badge).
- **Each event** = status pill stacked on the rail, connector line takes the next event's color. **Colors:** Learned = emerald · Confirmed = blue · Edited = mercury blue · Relevance up = emerald up-arrow · Relevance down = crimson down-arrow · Stale = amber · Archived = muted.
- Click → opens memory in inspector. Hover → shows connection type (supports/contradicts/refines/depends_on/related_to/supersedes) as tooltip.

**Best-fit component:** **[Status Indicators Timeline](https://www.shadcn.io/blocks/timeline-status-indicators)** — exact match.

### 11.4 Connections (`/projects/:name/connections`)

- **6 relation filter chips** at top (toggleable, color-coded by relation type, defaults on). Uses the existing `REL_MEANING` map in `ProjectConnections.tsx`.
- **Full-bleed d3 force-directed graph** (lift the layout from `GraphView.tsx`, not the current ring layout from `MiniGraph.tsx`).
- **Focus mode:** click a node → physics centers it, dims everything >2 hops away.
- **Floating legend** (bottom-right card): 6 relation types with color, label, and example ("supports: A backs B's claim").
- **"Why this exists" banner** (top-left, dismissable, 56px tall) — reuses the existing `ExplainBlock` component.

### 11.5 Health (`/projects/:name/health`)

1. **Score hero** (200px, full width): 0-100 display + 4 sub-metric bars (freshness/confidence/coverage/activity). **Mercury** Mountain Top aesthetic — Deep Space panel (#171721) with Mercury Blue ring around the score.
2. **"What to fix" plan** (360px+, full width, expands to fit content): **[Agent Plan](https://21st.dev/community/components/isaiahbjork/agent-plan/default)** (isaiahbjork, 21st) — animated task plan with subtasks. Each top-level task is a memory action ("Re-confirm 12 stale", "Decide between 3 contradicting", "Add missing coverage"). Subtasks expand on click with framer-motion animation. Click "Re-confirm all" → batches confirmations via `api.confirm()`. **This is the showcase component for the whole redesign.** Install: `npx shadcn@latest add https://21st.dev/r/isaiahbjork/agent-plan`. Deps: lucide-react + framer-motion.
3. **Score history** (240px, sparkline, 30 days). Requires new endpoint `/api/health/history?project=X`.
4. **Action log** (fills remaining, status pill pattern).
5. **Settings shortcut** (bottom-right, 32px pill): "Adjust scoring weights →" → opens `/projects/:name/settings`.

### 11.6 Project Settings (`/projects/:name/settings`)

**Visual language:** **Cursor** (Refero — warm paper command center). The shift from Linear's midnight signals "this is config, not data." Hairline borders, paragraph-like entries, editorial spacing.

- **Context rules** (2x2 toggle grid): Auto-capture decisions · Auto-capture gotchas · Require confirmation · Allow cross-project relations. Cursor-style switch: 24px wide, 6px track radius, 18px thumb.
- **Memory rules:** importance default (slider 1-5, default 3) · confidence threshold (slider 0-1, default 0.7) · decay rate (dropdown: off/slow/medium/fast).
- **Connections:** "Suggest relations" toggle + current auto-relation strategy (tag-frequency heuristic now, LLM in v2.8+).
- **Danger zone** (1px crimson border): "Reset to system defaults" — Linear pattern, requires typing project name to confirm.

---

## 12. Settings Page — Deep Dive

Replaces the current 4-tab layout (Models / Behavior / System Explorer / Memory Keeper) with **5 sections, no tabs**. Single-column layout (720px max) with a left-rail section nav. Phase 3 work.

**Visual language:** **Mercury** (Refero — Mountain Top Command Center). Deep neutrals (#171721 → #1e1e2a) with a single Mercury Blue `#5266eb` for the lone primary action per section. Nowhere else.

### 12.1 System (the home of `/settings`)

1. **AI Providers** (refactor of `SettingsForm.tsx`):
   - Each provider = 56px row card: provider name + logo (16px), status pill (idle/verifying/valid/invalid from `KeyState`), model count, edit link.
   - **Verification uses Animated Status Badge** — "Verifying" pulses → "Connected" (emerald) or "Invalid key" (crimson). Same component as project Health.
   - "Edit" opens an inline slide-in drawer (400px, from right) — not a modal. Drawer has the masked apiKey (eye icon to reveal), baseUrl, embedModel, llmModel. Save = single mercury-blue button.
2. **Embedding source:** single dropdown. Defaults to the first provider that supports embedding (gemini/openai/cohere/openrouter; anthropic excluded). Mercury Blue info-icon tooltip explains the choice.
3. **Storage:** read-only card (120px tall) — DB path (Berkeley Mono, muted), size on disk, last backup timestamp, "Open in Finder" link (text-only, no fill).

### 12.2 Behavior

1. **Reasoning** (3 toggles, 2-column grid): auto-relate new memories (on) · suggest contradiction detection (on) · generate cluster labels (off until v2.8).
2. **Decay** (3 controls, single column): "Decay unused memories" toggle (the existing `decayEnabled` from `TOGGLES`) · half-life dropdown (30d/90d/180d/365d/never) · action on low-confidence (<0.3): Move to Inbox / Auto-archive / Keep.
3. **Inbox:** "Auto-clear Inbox after" (30 days, locked per §8 Q2) · "Recover" link → opens the Recover drawer (see §12.3).

### 12.3 Health

1. **Score card** (240px, full width): global score (96px display, mercury-blue ring) · 4 sub-metrics in a 4-column grid (fresh / confident / covered / active) · "Run Janitor" single primary action (the existing `Play` icon from `app/settings/page.tsx`). **When clicked, swap the button for the Animated Status Badge** — "Running" pulses → "Completed" (emerald) → "X memories cleaned" badge appears below → auto-fade after 2s.
2. **Stale memory queue** (fills remaining, per-project filter chip): reuses the `StaleMemoryAlert` logic. Each row: confidence % + content + [Confirm] [Edit] [Forget] inline.
3. **Recover** (drawer trigger, bottom-right): slide-in drawer (400px) with all soft-deleted memories from the last 30 days. Each row: deleted date, content preview, "Restore" button.

### 12.4 Advanced (collapsed by default)

**Visual language:** **Cursor** editorial. The current System Explorer tab content (SkillEntry / AgentEntry / HookEntry / RuleEntry from `ConfigExplorerData`) moves here. Each entry: type badge (Skill/Agent/Hook/Rule, 4 distinct colors, hairline border) · name (Berkeley Mono, 14px) · path (Berkeley Mono, 12px, muted) · "View" link.

**Why collapsed by default:** 95% of users never touch this. Cursor's own advanced settings work the same way.

### 12.5 About

Version (current `2.4.0` from `.claude-plugin/plugin.json`) · DB schema version · LTM health check (last successful recall) · license · "Send feedback" link · "What's new" → opens `CHANGELOG.md` in a side panel.

---

## 13. Visual identity — rationed accents

Two accent colors, two surfaces, no overlap. Plus the existing studio-warm `#dc5000` from `DESIGN.md` for global brand.

| Color | Hex | Surface | Rationed uses |
|---|---|---|---|
| **Acid Lime** | `#e4f222` | Project layer (Linear territory) | 2px left bar of selected sub-nav item; ring around central project node in the mini-graph. Nowhere else. |
| **Mercury Blue** | `#5266eb` | Settings page (Mercury territory) | Single primary action per section (Save / Run / Connect / Add). Nowhere else. |
| **Studio Warm** | `#dc5000` (existing) | Global brand | TopNav logo accent, status chip "live" dot, Inbox badge. Stays as-is. |

**Each accent earns its place by being the only place that color appears in its surface.** The moment a third use-case appears, kill the weakest one.

**What this is NOT:** no dark-mode toggle (v2.8). No drag-and-drop on the board view (v2.8). No LLM-generated cluster labels in Phase 3 (heuristic only).

---

## 14. Open questions resolved (2026-06-04, batch 2)

| # | Question | Decision | Drives |
|---|---|---|---|
| 8 | Accent color for project layer? | **Acid lime `#e4f222`** (Linear territory); Mercury Blue `#5266eb` for Settings (Mercury territory) | Two surfaces, two accents, no overlap. Rationed per §13. |
| 9 | Animated Status Badge on janitor runs? | **Yes, on both** project Health and global Settings → Health | Same component, two surfaces. Verifying flow reuses it too. |
| 10 | Project Settings: sub-route or drawer? | **Sub-route** at `/projects/:name/settings` | Linear pattern. Drawer is too small for per-project overrides. |
| 11 | AI Prompt Box in Omnibar? | **Yes, included in v2.5.0 (Phase 1.4)** | cmdk-only was the Phase 1 floor; the 21st.dev prompt box upgrades it in the same release. Install: `npx shadcn@latest add https://21st.dev/r/johuniq/ai-prompt-box`. Deps: lucide-react + framer-motion + @radix-ui/react-dialog + @radix-ui/react-tooltip + clsx + tailwind-merge. |
| 12 | Document the deep redesigns as a new doc, or amend this one? | **Amend this one** | One story, one doc. |

---

## 15. Updated file changes table

| File | Change | Phase |
|---|---|---|
| `graph-app/app/project/[name]/page.tsx` (263 lines) | Split into 5 sub-routes: `app/projects/[name]/page.tsx`, `app/projects/[name]/memories/page.tsx`, `app/projects/[name]/timeline/page.tsx`, `app/projects/[name]/connections/page.tsx`, `app/projects/[name]/health/page.tsx`, `app/projects/[name]/settings/page.tsx`. Add `app/projects/layout.tsx` with the 3-pane shell + sub-nav. | 2 |
| `graph-app/app/projects/page.tsx` (new) | The current Home (Projects + Health bento) becomes `/projects`. The Graph moves to `/graph`, Inbox to `/inbox`. | 2 |
| `graph-app/components/ProjectBoardView.tsx` | Add inline edit (click content → opens editor). No drag-drop yet. 32px row height, 1px hairline border. | 2 |
| `graph-app/components/ProjectTableView.tsx` | Switch to 32px row height + 1px hairline border + sticky header + 2-button row action menu on hover. | 2 |
| `graph-app/components/ProjectTimeline.tsx` | Replace flat list with Status Indicators Timeline pattern (color-coded pills on vertical rail, day-grouped). | 2 |
| `graph-app/components/ProjectConnections.tsx` | Add 6 relation filter chips at top. Use full force layout from GraphView, not ring layout. Floating legend card. | 2 |
| `graph-app/components/ProjectActivityLog.tsx` | Wrap each event in a status pill (emerald/blue/amber/muted). | 2 |
| `graph-app/components/ProjectRelevance.tsx` | Wrap thumbs-up/down in Cursor-style 32px buttons with the existing `nodeColor` for the category. | 2 |
| `graph-app/components/MiniGraph.tsx` | Add 2px acid-lime ring around the central project node. Add Focus mode (click a node → center, dim >2 hops). | 2 |
| `graph-app/components/StaleMemoryAlert.tsx` | Move from global to project-scoped. Add "View all" + 3-action row (Confirm / Edit / Forget). | 2 |
| `graph-app/components/HealthView.tsx` | Inline into Settings → Health. Add Animated Status Badge for janitor run. | 3 |
| `graph-app/app/settings/page.tsx` (19KB) | Split into 5 sections (no tabs). Left-rail section nav. Replace tab UI with single scrollable page. | 3 |
| `graph-app/components/SettingsForm.tsx` | Refactor provider rows to use Animated Status Badge for verification. Replace modal with inline drawer (slide from right). | 3 |
| `graph-app/components/AnimatedStatusBadge.tsx` (new) | `npx shadcn@latest add https://21st.dev/r/isaiahbjork/animated-status-badge`. Deps: lucide-react + framer-motion. | 2/3 |
| `graph-app/components/AgentPlan.tsx` (new) | `npx shadcn@latest add https://21st.dev/r/isaiahbjork/agent-plan`. Deps: lucide-react + framer-motion. Used in `/projects/:name/health`. | 2 |
| `graph-app/components/AiPromptBox.tsx` (new) | `npx shadcn@latest add https://21st.dev/r/johuniq/ai-prompt-box`. Used in Omnibar (Phase 1.4). Deps: lucide-react + framer-motion + @radix-ui/react-dialog + @radix-ui/react-tooltip + clsx + tailwind-merge. | 1 |
| `graph-app/components/ui/command.tsx` (existing) | cmdk-based, no new install. | 1 |
| `graph-app/app/globals.css` (DESIGN.md tokens) | Add acid-lime `#e4f222` (Linear), mercury-blue `#5266eb` (Mercury). All rationed per §13. | 2 |
| `graph-app/app/api/health/history/route.ts` (new) | Score history for project Health view. | 2 |
| `graph-app/app/api/inbox/recover/route.ts` (new) | Restore soft-deleted memories (Phase 3). | 3 |

**Three 21st.dev installs**, all in `@/components/ui/`, all drop-in with shadcn.

---

## 16. External references

Best-fit component picks and design system inspirations, all linked for the build team.

### styles.refero.design (Refero)
- **Linear** — midnight command deck. Project layer visual language. https://styles.refero.design/style/90ce5883-bb24-4466-93f7-801cd617b0d1
- **Mercury** — Mountain Top Command Center. Settings page visual language. https://styles.refero.design/style/3172cd4d-118a-4a16-a259-6b634d32322e
- **Cursor** — warm paper command center. Project Settings visual language. https://styles.refero.design/style/4e3b4717-84c8-4599-baaf-a343c3d619b6

### 21st.dev (21Dev)
- **Animated Status Badge** (isaiahbjork) — janitor status + provider verification. https://21st.dev/community/components/isaiahbjork/animated-status-badge/default
- **Agent Plan** (isaiahbjork) — "What to fix" in project Health. https://21st.dev/community/components/isaiahbjork/agent-plan/default
- **AI Prompt Box** (johuniq) — Omnibar upgrade. https://21st.dev/community/components/johuniq/ai-prompt-box
- **shadcn Command** (cmdk) — base for ⌘K. https://21st.dev/community/components/shadcn/command
- **Status Indicators Timeline** (shadcn.io block) — Timeline view + activity feed. https://www.shadcn.io/blocks/timeline-status-indicators
- **Command Palette category** (21st) — discovery hub. https://21st.dev/community/components/s/command-palette

---

*End of spec. Hand off to product team for review and prioritization.*
