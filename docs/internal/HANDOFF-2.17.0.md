# Test handoff: OpenLTM 2.17.0

**For:** QA / test agents.
**Branch:** `feat/2.17-hardening` (base `main` @ `d35e2cf`, 63 commits, 237 files).
**Status:** all automated gates green in the build container. Not merged, not tagged, not published.

This release combines open PRs #27–#38 with six workstreams (security, hook lifecycle, new hooks, MCP and recall, skills, project identity and storage) into a single release. Your job is to break it.

---

## 0. Ground rules

1. **Never test against a real `~/.claude`.** Set `HOME` to a temp dir for anything that runs hooks, onboarding or the server. The QA scripts and `bun run test` already do this. `bun run test` fails if the real `~/.claude` changes.
2. Report every failure with the exact command, full output, and the expected result from this doc (template in §6).
3. A "PASS" from a script is evidence, not proof. §3 lists what the scripts do **not** cover; that is where to dig.

## 1. Setup

```bash
git fetch origin feat/2.17-hardening && git checkout feat/2.17-hardening
bun install --frozen-lockfile        # Bun ≥ 1.3
```

## 2. Automated gates (run first; all must pass)

| # | Command | Expected |
|---|---|---|
| G1 | `bun run typecheck` | no output, exit 0 |
| G2 | `bun run test` | `776 pass, 0 fail` and `real ~/.claude untouched` |
| G3 | `bun run verify-version` | `All version references in sync.` (2.17.0 everywhere, CHANGELOG entry present) |
| G4 | `bun run check:openclaw` | `All 17 OpenClaw package checks passed.` |
| G5 | `claude plugin validate .` | `Validation passed with warnings`. The two warnings (root `CLAUDE.md` is not loaded as plugin context; README has no marketplace install line) predate 2.17. |
| G6 | `bun run build:hooks && git diff --exit-code hooks/GitCommit.bundle.mjs` | no diff (committed bundle is fresh; this is what CI's bundle job checks) |
| G7 | `bun run qa:smoke` | `All MCP smoke checks passed.` / `All hook smoke checks passed.` / `All server smoke checks passed.` (18 + 20 + 11 checks). The server check needs port 7331 free. |
| G8 | `cd packages/adapter-pi && bun run build && grep -c bun:sqlite dist/index.js` | build ok, count `0` (Pi runs on Node). Repeat in `packages/adapter-openclaw`. |

## 3. Areas to test by hand

Each area gives what changed, what the scripts already cover, and what still needs a human-style test.

### A. Graph server security
**Changed:**
- Binds `127.0.0.1`; `LTM_SERVER_HOST` overrides it and prints a warning.
- Host, X-Forwarded-Host and Origin allowlists.
- Mutations require `Content-Type: application/json`.
- API keys are masked in `/api/settings` and `/api/config`.
- `/api/reveal` is confined to the DB directory.
- SIGTERM exits.
- The Next UI binds loopback (`graph-app/package.json`).

**Covered:** `scripts/qa/server-smoke.ts`.

**Still to test:**
- A1. **Settings UI with masked keys.** Run `graph-app` (`bun install && bun run dev` in `graph-app/`) against a sandbox server. Save a provider key, reload the page, and edit an unrelated setting. The stored key must survive unchanged, and the UI must show `••••<last4>`. The agent could only transpile `SettingsForm.tsx`; it never rendered it.
- A2. **Every UI action that mutates still works through the Next proxy:** approve a pending memory, merge, supersede, delete, layout save, janitor run. Each should be 2xx, not 403/415.
- A3. **WebSocket live reload** from `http://localhost:7332` still connects (101) and refreshes on DB change.
- A4. `LTM_SERVER_HOST=0.0.0.0 bun run src/graph-server.ts` prints the `!!!!` warning banner and listens on all interfaces.
- A5. Try to bypass the guard: IPv6 `[::1]`, mixed-case `LOCALHOST`, `Host: localhost.evil.com`, `Origin: null`, a body-less POST with no Content-Type. Expected: loopback forms allowed; `localhost.evil.com` gets 403; body-less POST allowed (by design, so `curl -X POST` works).

### B. Hook lifecycle (Stop / SessionEnd)
**Changed:**
- `Stop`, which fires on every turn, now only upserts **one progress row per session**.
- `EvaluateSession` moved to `SessionEnd`. It writes to `${CLAUDE_PLUGIN_DATA}/learned/`, not the plugin directory.
- Proposals filter out harness noise, and the prompt-recall state is cleaned up.
- Dev installs are re-wired (`scripts/install-wiring.ts`).
- `hooks.json` has one `SessionEnd` array that runs EvaluateSession and the janitor spawner. A naive merge of #27 had produced a duplicate JSON key that silently dropped EvaluateSession.

**Covered:** `hooks-smoke.ts`, `src/__tests__/hooks/{update-context,evaluate-session}.test.ts`, `install-wiring.test.ts`.

**Still to test:**
- B1. **A real long session:** 25+ turns in a live Claude Code session (§4). `context_items` progress for the project then has exactly one row for that session, and earlier sessions' rows are intact.
- B2. **A 20MB transcript:** `UpdateContext` stays well under its 10s timeout (the agent measured ~115ms).
- B3. **SessionEnd reasons** (`clear`, `logout`, `prompt_input_exit`, `other`): EvaluateSession runs once for each, and nothing is written to stdout.
- B4. **Dev-install upgrade:** in a temp HOME whose `settings.json` has the 2.16 entries (Stop→EvaluateSession), `bun run scripts/install-wiring.ts <root>` removes the Stop entry and adds the SessionEnd, UserPromptSubmit and PostToolUse(Bash) entries with timeouts. Running it twice adds no duplicates. Another tool's `SessionEnd.ts` is left alone.

### C. SessionStart
**Changed:**
- Source-aware: `startup` / `resume` / `clear` / `compact`.
- No `git fetch` and no `known_marketplaces.json` edits.
- Onboarding uses `process.execPath`.
- A compact index (`- [id] title`), capped by `injectTopN` with globals limited to a third.
- Globals are shown for new projects too.
- Staged-conflict banner and pending-proposals line.
- Everything injected is secret-scrubbed, and private memories are excluded.

**Covered:** `hooks-smoke.ts`, `session-start*.test.ts`, `injectTopN.test.ts`, `sessionstart-compact.test.ts`, `supersede-ux.test.ts`.

**Still to test:**
- C1. **`injectTopN` values** 1, 3, 15 and 50 with 40 global and 40 project memories. Expect the total to equal `min(N, available)`, globals ≤ ⌈N/3⌉, and project memories to fill the rest.
- C2. **A memory with a planted secret** (`AKIA…`, `ghp_…`, a PEM block) in its title and its content. It must never appear in SessionStart output.
- C3. **A `private`-tagged memory** never appears in the index.
- C4. **Older Claude Code builds with no `source` field** behave like `startup`.
- C5. **Timing:** SessionStart wall time with 10k memories and embeddings disabled should be under 15s, and realistically under 1s.

### D. UserPromptSubmit (new)
**Changed:**
- Full-text recall on every prompt, up to `ltm.promptRecallLimit` (default 5).
- Never repeats a memory within a session.
- Skips slash commands, prompts under 15 characters, and runs with `autoRecall`/`promptRecall` set to false.

**Covered:** `hooks-smoke.ts` (incl. latency < 300ms), `user-prompt-submit.test.ts`.

**Still to test:**
- D1. **Relevance on natural prompts:** seed ~50 realistic memories and run 20 real-world prompts. Note any false positives (irrelevant injections), since this costs context on every prompt.
- D2. **Unicode, emoji and FTS operators in prompts** (`"`, `*`, `NEAR`, `-`, `AND`): no crash, exit 0.
- D3. **Latency at 10k memories:** should stay under 300ms.

### E. PostToolUse (new)
**Changed:** a successful `git commit` made through Claude's Bash tool flags memories anchored to the committed files as stale.

**Covered:** `hooks-smoke.ts`, `post-tool-use.test.ts`.

**Still to test:** E1. `git commit --amend`, `git commit -a`, `git -C other commit`, a failed commit (hook rejected), `git commit && git push`, and a commit with nothing to commit. Only real new commits should flag anything; a repeat run must not re-flag.

### F. MCP tools
**Changed:**
- New tools: `get`, `context_add`, `proposals`.
- `project` is optional for the context tools.
- Annotations on every tool.
- The server reports the real version.
- `workspace_id`/`agent_id` filters actually filter.
- `includePrivate` added.
- The standalone `mcp-serve` defaults to the project of its working directory.

**Covered:** `mcp-smoke.ts` (real stdio), `mcp-server.test.ts`, `mcp-get.test.ts`, `private-tags.test.ts`.

**Still to test:**
- F1. In a live session (§4), ask Claude to "record a decision that we use RRF for recall". It should call `context_add` **without** `project`, and the item should then show up in `context`.
- F2. `bunx`-style standalone: `bun packages/openltm-core/src/cli/bin.ts mcp-serve` from a repo subfolder. `context {}` should resolve to the repo-root name.
- F3. Read-only tools are auto-approved by hosts that honour `readOnlyHint`, and `forget` still prompts.

### G. Recall quality (hybrid FTS + embeddings, RRF)
**Covered:** `recall-quality.test.ts` with 8 golden queries, embeddings disabled (8/8 first; it was 1/8 before). `recall.bench.ts` p95 is about 15ms at 10k memories.

**Not covered: a real embedding provider.**
- G1. With llama.cpp (`llama-server` with `bge-m3`) or Ollama running, backfill embeddings (`/openltm:admin backfill`) and rerun the golden queries plus 10 paraphrased ones. Expect hybrid to be no worse than full-text alone.
- G2. With the provider down or slow (>2s), recall falls back to full-text silently with identical results.
- G3. `semanticFallback: false` gives full-text only.

### H. `learn` dedup
**Changed:** #36 added near-duplicate detection with Jaccard tiers. Integration found it **merged facts that differ by one token**: "plan A"/"plan B", "retry 3"/"retry 5". The older containment rule (also on `main`) merged "do **not** run X" with "do run X". Both tiers now use `differsMeaningfully()` in `packages/openltm-core/src/similarity.ts`.

**Covered:** `learn-near-dedup.test.ts` (4 regression pairs), `quality.test.ts`, `audit-provenance.test.ts`.

**Still to test:** H1. Adversarial pairs:
- unit changes ("30s" / "30ms")
- antonyms that aren't on the polarity list ("increase" / "reduce", "sync" / "async", "first" / "last")
- version bumps ("node 18" / "node 20")
- reordered sentences
- pure elaborations (which **should** still reinforce)

List every pair that merges when it shouldn't, or doesn't when it should.

### I. Project identity and storage move (highest risk: user data)
**Changed:**
- **Name resolution, shared by every host:** registry exact match → registry longest prefix → git repo root name → folder name, all normalized.
- **New locations:** registry and context files move to `<dataDir>/projects/`, where dataDir is `LTM_DATA_DIR`, then `CLAUDE_PLUGIN_DATA`, then the DB's folder.
- **Config read order:** `LTM_CONFIG_PATH` → `<dataDir>/config.json` → legacy `~/.claude/config.json`.
- **Legacy files are copied, never modified.**
- **Continuity:** a host's old name is kept while it is the only one with data.

**Covered:** `project.test.ts` (26), `storage-migration.test.ts` (21), `hooks-smoke.ts`.

**Still to test:** build a fake legacy home that copies a real 2.16.2 layout, then:
- I1. **Registry + context files:** registry with 3 projects, one project with all `context-*.md` files, and one with memories under a full-path slug (`-home-you-code-app`). Run SessionStart for each cwd and check:
  - names are unchanged
  - files are copied to `<dataDir>/projects/`
  - `~/.claude/projects/**` is byte-identical before and after (`find … -exec stat`)
- I2. **The same repo across hosts:** reach it via Claude hooks, `deriveProjectFromCwd` (Pi/OpenCode), and the OpenClaw adapter. All must give the same name, and no host's existing memories may be orphaned.
- I3. **Edge cases:**
  - a git **worktree** (uses the main repo's name)
  - a submodule
  - HOME itself as the cwd (must not count as a repo root)
  - `/`
  - names with spaces and unicode
  - a registry entry whose path no longer exists
- I4. **Corrupt registry JSON:** no crash, falls back to repo/folder name.
- I5. **OpenClaw on Node < 22.5** (no `node:sqlite`): the old name is kept.

### J. Skills, agents, commands
**Changed:**
- **Skills:** 7 skills reduced to 4: `Ltm`, `MemoryReview` (new), `GitLearn`, `Spec`.
- **Commands:** `/openltm:server` replaces the LtmServer skill.
- **Agents:** `planner` becomes `ltm-planner`, with a valid `tools:` list and read-only LTM tools.
- **Bug fix:** `git-learner` now passes `project`.
- **Cleanup:** `SkillSearch(...)` references removed.

**Covered:** `claude plugin validate .` (G5).

**Still to test:**
- J1. **Skill evals:** `claude plugin eval . --runs 1 --no-publish --trust-plugin` (6 cases in `evals/`). They were **never run**: `--trust-plugin` is the owner's call. Report scores per case, especially whether case 06 (plain coding) stays clear of memory skills.
- J2. **In a live session:**
  - "remember that bun:sqlite caches prepared statements" → `Ltm` skill → one `learn` call with a title.
  - "what's pending in memory? clean it up" → `MemoryReview` → `proposals list`, then it **asks** before any `forget`.
  - "backfill LTM from the last 5 commits" → `GitLearn` → exactly one `git-learner` agent.
- J3. **`/openltm:server start|status|stop`** works and `stop` frees both ports. `/openltm:admin server` only redirects.
- J4. `grep -rn SkillSearch --include=*.md . | grep -v packages/openltm-core/assets` returns nothing.

### K. Merged PRs — spot checks
- #27 janitor: run the "Verify with every server down" block in PR #27's description. Expect exit codes 0 / 0 (skipped) / 3 (missing DB) and lock exit 4.
- #34/#35 conflicts: stage a contradiction, then `ltm conflict list|accept|reject|coexist <id>`; SessionStart shows the staged one.
- #29/#31 scrub: plant an AWS key with `learn` (stored redacted), with `context_add` (stored redacted), and in a proposal accepted via `proposals` (stored redacted).
- #38: `HOME=/your/real/home bun test src/__tests__/onboard.test.ts`. The preload must refuse to run against a non-temp HOME.

## 4. Live end-to-end in Claude Code

Use a clean machine, container or throwaway OS user, so the real `~/.claude` doesn't matter. Alternatively, back up `~/.claude/projects/registry.json`, `~/.claude/config.json` and `~/.claude/plugins/data/` first, and disable any installed `openltm` (`claude plugin disable openltm@OpenLtm`) so two copies don't load.

```bash
claude --plugin-dir /path/to/OpenLtm      # loads this checkout for the session only
```

Work for 20+ turns on a small task in a git repo. Make a commit through Claude, then `/compact`, then `/clear`, then exit. Check:

1. SessionStart output at startup, after `/compact` and after `/clear` matches §3-C. No `git fetch` happens: `strace -f -e execve` or the hook log show no `git`.
2. Prompt recall lines appear on relevant prompts only (§3-D).
3. After the commit, memories anchored to the committed files are stale (§3-E).
4. On exit, `${CLAUDE_PLUGIN_DATA}/learned/patterns/<date>-<session>.md` exists, and `/openltm:memory propose review` lists real proposals only.
5. `skills/Learned/` inside the plugin checkout gains **no** files. In 2.16 it did, every turn.
6. `/openltm:health` reports no hook errors.

## 5. Known gaps and decisions for the owner

- **Not exercised:** a real embedding provider (G1); the rendered settings UI (A1); skill evals (J1); real Pi, OpenCode and OpenClaw hosts (I2); Node < 22.5 (I5).
- **Source-text tests:** `injectTopN.test.ts`, `sessionstart-compact.test.ts` and `supersede-ux.test.ts` (from #30/#33/#35) assert strings in `SessionStart.ts` rather than its behavior. Two assertions were loosened by one character when the merged signature gained an argument. Consider replacing them with behavior tests.
- **Dead code:** `packages/adapter-pi/src/hooks.ts` is not loaded by Pi's entry point (`index.ts`), so its handlers (including the `session_compact` change) don't run on a real Pi host.
- **Pi's real entry point:** `packages/adapter-pi/src/index.ts` now resolves project names with the shared resolver (§3-I).
- **After merging:** close PRs #27–#38 as included in 2.17.0 (#30 was already folded into #33). Re-pin the Hermes catalog per `CLAUDE.md` (`bun run catalog:sync` + PR to `NousResearch/hermes-agent`).
- **Release:** tag `v2.17.0` per `CLAUDE.md`. Publishing is tokenless via OIDC. Do this only after QA sign-off.

## 6. How to report

One block per finding:

```
ID: <area letter+number, e.g. H1>
Severity: blocker | major | minor | nit
Command / steps:
Expected (from this doc):
Actual (full output):
Notes / suspected cause:
```

Finish with a summary table: area → pass / fail / not run (and why).
