# Spec: README Overhaul — Reflect New Command System

**Feature slug:** readme-overhaul
**Date:** 2026-04-16
**Status:** Draft
**Depends on:** v1.4.17–v1.4.20 command system overhaul

---

## Problem

The current README is stale in four compounding ways:

| Area | Problem |
|------|---------|
| **Version** | Badge shows `1.3.9` — plugin is at `1.4.20` |
| **Commands section** | Still shows 13 flat `/ltm:*` commands. New structure is 4 grouped commands + deprecated aliases. Users don't know where to start. |
| **Architecture diagram** | Says "13 Commands", lists old names (`/recall`, `/capture`, etc.) |
| **Verify Install** | References `/ltm:hook-doctor` — now deprecated |
| **No Quick Start** | Users must read the full README to understand what to do first |
| **Tone** | "Project Structure" section is internal-facing. README is a first impression — users want to know how to use it, not how it's built. |

---

## Codebase Ground Truth

**New command structure (v1.4.17+):**

| Grouped command | Subcommands | Old aliases (still work, deprecated) |
|----------------|-------------|--------------------------------------|
| `/ltm:memory` | `recall \| learn \| forget \| relate` | `/ltm:recall`, `/ltm:learn`, `/ltm:forget`, `/ltm:relate`, `/ltm:capture` |
| `/ltm:project` | `init \| analyze \| register` | `/ltm:init-context`, `/ltm:analyze-context`, `/ltm:register-project` |
| `/ltm:health` | *(full suite, no subcommand)* | `/ltm:doctor`, `/ltm:hook-doctor`, `/ltm:decay-report` |
| `/ltm:admin` | `migrate \| scan \| server` | `/ltm:migrate`, `/ltm:migrate-db`, `/ltm:secrets-scan`, `/ltm:ltm-server` |

**Deprecated aliases:** All old flat commands still execute but prepend a deprecation notice. Removed in v1.6.0.

**MCP tools (unchanged):** `ltm_recall`, `ltm_learn`, `ltm_forget`, `ltm_relate`, `ltm_graph`, `ltm_context`, `ltm_context_items`

**Hooks (unchanged):** SessionStart, UpdateContext, EvaluateSession, PreCompact, GitCommit, NotifyLtmServer

**DB path:** `~/.claude/plugins/data/ltm-ltm/ltm.db` (marketplace install)

**Current version:** 1.4.20

---

## Target State

A README that a brand-new user can read in 2 minutes and immediately know:
1. What the plugin does (one sentence)
2. How to install it (one command)
3. The 4 commands they'll use daily
4. What happens automatically (hooks)

Power users get the full reference in collapsible sections.

---

## Acceptance Criteria

### AC-1: Version badge correct
- `[![Version](https://img.shields.io/badge/version-1.4.20-blue...)]`

### AC-2: Quick Start section (NEW — appears right after install)
After the install block, add a "First 5 minutes" quick start:
```
## Quick Start

After install, start a new Claude Code session. You'll see context injected automatically.

Then try:
  /ltm:memory recall <topic>    — search what Claude remembers about a topic
  /ltm:memory learn <insight>   — store something worth keeping
  /ltm:health                   — check plugin health + memory decay status
  /ltm:project init             — set a goal for the current project
```

### AC-3: Commands section restructured
Replace the current flat table with:

1. **Primary header: "4 Commands You Need"** — a table with the 4 grouped commands, one-line description, and example usage for each
2. **Subcommand reference** — one block per grouped command showing its subcommands and args
3. **Collapsible "Legacy aliases"** — `<details>` block listing all deprecated flat commands and their replacement, so existing users can find them without confusing new users

### AC-4: Architecture diagram updated
- Change "13 Commands" → "4 Commands (+ deprecated aliases)"
- Update listed command names to the 4 new ones: `/ltm:memory`, `/ltm:project`, `/ltm:health`, `/ltm:admin`
- Remove `/ltm:capture`, `/ltm:recall` etc. from diagram

### AC-5: Install diagram updated
- Line `13 commands loaded` → `4 commands loaded (+ 11 deprecated aliases)`
- Keep the rest of the diagram unchanged

### AC-6: Verify Install section updated
Replace:
```bash
/ltm:hook-doctor     # all hooks green
```
With:
```bash
/ltm:health          # plugin health + hooks + decay status
/ltm:memory recall test   # returns results (or "no results" on fresh install)
```

### AC-7: Project Structure section — defer to collapsed block
Move "Project Structure" into a `<details>` block. The top-level README should not lead with internal directory structure — that's for contributors, not users.

### AC-8: Session lifecycle table — update command names
In "How It Works → Session Lifecycle" table, replace old command references:
- `/ltm:recall` → `/ltm:memory recall`
- `/ltm:learn` → `/ltm:memory learn`

### AC-9: Memory decay table stays unchanged
Decay table is user-facing and accurate — keep it.

### AC-10: No references to deprecated commands in non-collapsed sections
Scan all non-`<details>` sections. Any occurrence of deprecated command names (`/ltm:recall`, `/ltm:learn`, `/ltm:forget`, `/ltm:relate`, `/ltm:capture`, `/ltm:init-context`, `/ltm:analyze-context`, `/ltm:register-project`, `/ltm:hook-doctor`, `/ltm:decay-report`, `/ltm:doctor`, `/ltm:migrate-db`, `/ltm:ltm-server`, `/ltm:secrets-scan`, `/ltm:migrate`) must be replaced with the grouped equivalent or moved into the `<details>` legacy alias block.

---

### AC-11: Table of contents
README is long — add a TOC after the short description linking to all major sections.

### AC-12: Contributing section (NEW)
Add a `## Contributing` section before License:
```
## Contributing
Open an issue first to discuss the change. PRs welcome.
See [CHANGELOG.md](CHANGELOG.md) for versioning conventions.
```

### AC-13: Usage section with real examples (NEW)
Add a `## Usage` section after Quick Start with concrete before/after examples:
- Show `/ltm:memory recall "auth patterns"` and sample output format
- Show `/ltm:memory learn` auto-extract mode (no args)
- Show what session start looks like (context injected)

### AC-14: Section order follows best-practices outline
Final section order:
1. Title + badges
2. Short description (1–2 sentences)
3. Features (bullets)
4. TOC
5. Install
6. Quick Start
7. Usage (with examples)
8. How It Works (collapsed or summarized)
9. Commands (4 grouped + legacy aliases collapsed)
10. MCP Tools
11. Hooks
12. Configuration
13. Graph Visualizer
14. Documentation links
15. Contributing
16. License

---

## Out of Scope

- Updating `docs/commands.md`, `docs/architecture.md` (separate task)
- Adding screenshots or GIFs
- Changing the install commands (they're correct)

---

## Files to Modify

| File | Action |
|------|--------|
| `README.md` | Full update per AC-1 through AC-10 |

**No version bump needed** — README changes don't affect plugin runtime. If bundled with other changes, bump then.

---

## Verification

1. `grep "1.3.9" README.md` → no results
2. `grep "/ltm:hook-doctor\|/ltm:recall\b\|/ltm:learn\b\|/ltm:capture" README.md` → results only inside `<details>` block
3. "Quick Start" section exists and appears before "How It Works"
4. Commands section has exactly 4 primary entries
5. Legacy aliases are in a `<details>` block
6. "Project Structure" is in a `<details>` block
