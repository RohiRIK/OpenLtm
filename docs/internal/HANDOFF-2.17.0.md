# Test handoff: OpenLTM 2.17.0

**For:** QA / test agents.
**Branch:** `feat/2.17-hardening` (base `main` @ `d35e2cf`, 110 commits, 282 files).
**Status:** round 3. Round 2 (Bob, at `2b62f7a`) was a REJECT with two findings, F1 and I7; §R3 answers them. Round 1 (at `94f5fa0`) is answered in §R2. All automated gates are green in the build container, including an environment that reproduces the reviewer's machine. Not merged, not tagged, not published.

This release combines open PRs #27–#38 with six workstreams (security, hook lifecycle, new hooks, MCP and recall, skills, project identity and storage) into a single release. Your job is to break it.

---

## R3. Round 3 — answers to the round-2 report (REJECT at `2b62f7a`)

| Finding | Answer | Evidence |
|---|---|---|
| **F1** (major): a decision stored with `context_add` is missing from `context` | **Fixed.** `context` returned only memories. It now returns `{ project, goal, decisions, gotchas, progress (last 5), globals, scoped }`, with context items egress-scrubbed. | Tests failed first: `mcp-server.test.ts` (readback, scrub) and `mcp-smoke.ts` ("context {} returns the decision context_add just stored"). Live, real Claude Code with `--plugin-dir` in a fresh repo: `context_add {type: decision}` with no `project` → `context {}` returned `"decisions":["We use RRF k=60 for hybrid recall."]`. |
| **I7** (major): with an alternate `CLAUDE_CONFIG_DIR`, an MCP `learn` is missing from the next SessionStart index | **Not a defect. The acceptance criterion was wrong; that was my error in the round-2 prompt.** Hooks and MCP use one DB. The canary was learned with no `project` and the default importance 3, so it is a global memory with importance 3. The index lists globals only from importance ≥ 4 (project memories from ≥ 3). Your own data shows this: the canary is in `fresh-claude/plugins/data/openltm-inline/openltm.db`, the DB that SessionStart reads under that config. "restored: 3 ctx items" came from that DB, and recall found the canary. | Reproduced live here under a fresh `CLAUDE_CONFIG_DIR` with no `LTM_DB_PATH`: one DB holding the onboarding memory (project) and the canary (`project_scope: null`, importance 3). The next SessionStart listed the project memory and not the canary; `recall` found it. New `scripts/qa/continuity-smoke.ts` (part of `qa:smoke`) repeats this without a host: the MCP server starts from `plugin.json` with the host's measured placeholder handling and an alternate config dir. The project memory and a global importance-4 memory reach the next index; a global importance-3 memory does not, but `recall` and prompt recall find it. Exactly one DB exists and the checkout's dev-fallback DB is untouched. Against the old self-referential manifest the smoke fails 5 checks. |
| Original-config MCP connection "failed" (not attributed to the candidate) | **Unexplained; needs data from your machine.** Startup takes ~350ms here, against Claude Code's 30s budget. Claude Code only writes `mcp-needs-auth-cache.json` entries for HTTP, SSE and claude.ai connector servers, never a stdio plugin server, so that "OpenLTM entry" is probably another server in that config. | New `scripts/mcp-probe.ts` starts the server the way Claude Code does. It prints FAIL lines for: no `bun` on PATH, `mcp.enabled: false`, a slow handshake, or a startup error (stderr). It also prints the DB, the config path, and the tail of Claude Code's log for the server. Checked in a sandbox: healthy, `mcp.enabled=false`, and no `bun` on PATH are each reported correctly. |

**Also found and fixed in round 3:**
- **Graph UI lists went stale after an inspector edit or delete** (project and memory-table pages): a deleted memory stayed listed until a manual reload. New Playwright tests drive the real controls — table row → inspector → Edit/Save, and Delete with the confirm dialog — then check the table before and after a reload and the DB row. Both failed before the fix. This is round-2 item 10 "UI controls NOT RUN", now automated.
- The `/graph` URL check in `ltm-graph.pw.ts` had the default 5s budget. `next dev` compiles the route on first visit and once took longer (1 failure in 5 full runs). It now has the 15s budget the canvas check already used.
- The Ltm skill and `docs/08-mcp-tools.md` now say when a `learn` is global and which memories the SessionStart index lists. `learn` returns `project_scope`.

**Corrected acceptance criterion (round-2 prompt item 9):** a `learn` with `project` (or `files`), or with importance ≥ 4, appears in the next SessionStart index. A global importance-3 `learn` is reachable through `recall` and prompt recall, not the index. "One database" is checked on the DB file itself, not via the index.

---

## R2. Round 2 — reviewer findings and the live acceptance run

**Reviewer findings (REJECT at `94f5fa0`) → fixed, each with a test that failed first:**

| Finding | Fix | Evidence |
|---|---|---|
| I6/G2 (major): tests escape the fake HOME through an inherited `XDG_CONFIG_HOME`; Pi tests run the real `pi` | installers honour XDG only for the process home; Pi never runs for another home, timeouts; harness redirects XDG_*; drift guard watches OpenCode/Pi config | Reproduced here: 12 failures, the outside `opencode.json` rewritten, `pi install` ran 4×. After: 827/0 with XDG outside HOME and a fake `pi` on PATH, `pi` run 0×, outside dir byte-identical; a planted write to the real OpenCode dir fails the run |
| Hooks vs MCP on different DBs when `LTM_DB_PATH` is set | manifest no longer pins `LTM_DB_PATH`; MCP resolves like the hooks | Live, `LTM_DB_PATH` set: SessionStart and prompt recall showed a canary seeded there, MCP `recall` found it, MCP `learn` wrote to it; plugin-data DB untouched |
| Legacy dev-install hooks in `settings.json` next to the plugin | SessionStart warning, `/openltm:health` check, `scripts/unwire-legacy-hooks.ts` | Live: 2.16's own `bun install` wired 4 hooks into this container's real settings; the 2.17 session warned; the script removed exactly those 4 with a backup, other settings identical |

**Found by the live acceptance run (real Claude Code 2.1.295, `--plugin-dir`, default config) and fixed:**
- The first fix for the DB split used `"CLAUDE_PLUGIN_DATA": "${CLAUDE_PLUGIN_DATA}"`, which Claude Code passes unexpanded — the MCP server wrote `<project>/${CLAUDE_PLUGIN_DATA}/openltm.db`. Now passed as `LTM_PLUGIN_DATA` and normalised before core loads (`src/pluginEnv.ts`); placeholders are never used as paths.
- `git commit --amend` re-flagged an already-stale memory → flag once until revalidated.
- Janitor with embeddings disabled: error + exit 2 every run → skips.
- A failed `git commit` ("nothing to commit") became a memory proposal → filtered.
- Graph UI edit and delete were silent no-ops (also on `main`); edits now scrubbed. `graph-app/e2e/actions-2.17.pw.ts` covers approve/edit/supersede/merge/delete/boost/clusters/janitor/config through the proxy.
- `/openltm:server stop` reported a port free while the UI kept serving → stops by PID, verifies with curl.

**Live acceptance sequence actually run (multi-turn, one session):** learn ×3 (anchored, global, private) and `context_add` ×2 without `project` → prompt recall injected exactly the anchored memory and never the private one → Claude edited and committed → anchored memory flagged with the commit → amend and an empty commit did not re-flag (after the fix) → `/compact` (PreCompact snapshot led SessionStart) → `/clear` → `recall` of the private note's words returned nothing → session end: patterns file and proposals under plugin data, janitor ran once then "not due", plugin checkout clean → `/openltm:server start|status|stop` with ports verified independently.

**2.16 → 2.17 upgrade rehearsal (real 2.16 code):** 2.16.2 (`origin/main`) ran SessionStart and wrote memories, goals, decisions and context files for three repos (`alpha-repo`, `Beta_Service`, a monorepo subfolder `web`). 2.17 SessionStart on the same home kept all three names, restored goals/decisions/memories, copied the context files to the data dir, and left all legacy files byte-identical. The MCP server (`context` without `project`, with the manifest's env) and the Pi/OpenCode resolver gave the same names.

**Prompt recall on 15 fresh prompts (not used for tuning; real hook process; 50-memory DB about this repo):** 3 chit-chat/generic prompts silent; 15 injected hits, of which 2–3 are noise (e.g. a single generic word "full" matched a memory) and 2 borderline; 4 relevant memories missed. The pre-2.17 algorithm on the same prompts: ~7 noisy hits of 16. Better, but well short of the 95% the labelled corpus suggests — that corpus overestimates.

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
| G2 | `bun run test` — run it **as is**, in your normal shell (inherited `XDG_CONFIG_HOME`, wrapper CLIs on PATH): no environment workaround | `830 pass, 0 fail` and `real ~/.claude untouched`. Must not touch `$XDG_CONFIG_HOME/opencode`, `~/.config/opencode` or `~/.pi` (the drift guard now watches them) and must never run your `pi` |
| G3 | `bun run verify-version` | `All version references in sync.` (2.17.0 everywhere, CHANGELOG entry present) |
| G4 | `bun run check:openclaw` | `All 17 OpenClaw package checks passed.` |
| G5 | `claude plugin validate .` | `Validation passed with warnings`. The one warning (root `CLAUDE.md` is not loaded as plugin context) is expected: that file is for contributors. |
| G6 | `bun run build:hooks && git diff --exit-code hooks/GitCommit.bundle.mjs` | no diff (committed bundle is fresh; this is what CI's bundle job checks) |
| G7 | `bun run qa:smoke` | Six `All … smoke checks passed.` lines — MCP, hooks, continuity, semantic, adapters, server (83 checks). Needs port 7331 free; the adapters smoke needs `node` ≥ 22.5. |
| G7b | `cd graph-app && bun install && cd .. && bun run qa:ui` | `32 passed` / `All UI smoke checks passed.` (Playwright in Chromium; set `PLAYWRIGHT_CHROMIUM` if the bundled browser is missing). Ports 7331/7332 free. |
| G7c | `bun run scripts/qa/prompt-recall-eval.ts` | `precision=95.2%  recall=94.5%` (labelled corpus in `src/__tests__/hooks/fixtures/promptRecallCorpus.ts`) |
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

**Covered:** `scripts/qa/server-smoke.ts`; `qa:ui` (`graph-app/e2e/security-2.17.pw.ts`) renders the settings page in Chromium, checks the key arrives as `••••4321` only, saves the form after editing another field and reads the DB to confirm the real key survived, and checks the WebSocket connects from the UI origin and is refused from a `null` origin.

**Still to test:**
- A2. **Every UI action that mutates still works through the Next proxy:** approve a pending memory, merge, supersede, delete, layout save, janitor run. Each should be 2xx, not 403/415. (`qa:ui` covers `/api/reload` and settings save only.)
- A3. **WebSocket live reload** refreshes the graph on a DB change (the connection itself is covered).
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

**Covered:** `hooks-smoke.ts` (incl. latency < 300ms), `user-prompt-submit.test.ts` (private and stale memories never injected, injected text secret-scrubbed), `prompt-recall-relevance.test.ts` (precision and recall ≥ 90% on 65 memories × 71 labelled prompts; silent on chit-chat and generic task prompts). Worst prompt on a 5,000-memory DB: 18ms.

**Still to test:**
- D1. **Relevance on *your* prompts:** the corpus is synthetic. Seed memories from a real project and note false positives — this costs context on every prompt. `scripts/qa/prompt-recall-eval.ts --verbose` shows per-prompt hits if you add cases to the fixture.
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
- F1. In a live session (§4), ask Claude to "record a decision that we use RRF for recall". It should call `context_add` **without** `project`, and the item should then show up in `context` under `decisions` (fixed in round 3; see §R3).
- F2. `bunx`-style standalone: `bun packages/openltm-core/src/cli/bin.ts mcp-serve` from a repo subfolder. `context {}` should resolve to the repo-root name.
- F3. Read-only tools are auto-approved by hosts that honour `readOnlyHint`, and `forget` still prompts.

### G. Recall quality (hybrid FTS + embeddings, RRF)
**Covered:** `recall-quality.test.ts` with 8 golden queries, embeddings disabled (8/8 first; it was 1/8 before). `recall.bench.ts` p95 is about 15ms at 10k memories.

**Covered against a stub provider:** `semantic-smoke.ts` runs a local OpenAI-compatible `/v1/embeddings` server: learn embeds, hybrid recall uses semantic scores, SessionStart's semantic branch, provider down → full-text, provider slow → gives up at 2s, and a `private` memory's text never reaches the provider. `recall-quality.test.ts` checks that other projects cannot crowd out the current one.

**Not covered: a real model.**
- G1. With llama.cpp (`llama-server` with `bge-m3`) or Ollama running, backfill embeddings (`/openltm:admin backfill`) and rerun the golden queries plus 10 paraphrased ones. Expect hybrid to be no worse than full-text alone.

### H. `learn` dedup
**Changed:** #36 added near-duplicate detection with Jaccard tiers. Integration found it **merged facts that differ by one token**: "plan A"/"plan B", "retry 3"/"retry 5". The older containment rule (also on `main`) merged "do **not** run X" with "do run X". Both tiers now use `differsMeaningfully()` in `packages/openltm-core/src/similarity.ts`.

**Covered:** `learn-near-dedup.test.ts` (regression pairs incl. sync/async, increase/reduce, read/write, prod/dev), `quality.test.ts`, `audit-provenance.test.ts`.

**Still to test:** H1. Adversarial pairs:
- unit changes ("30s" / "30ms")
- antonyms not on the polarity list in `similarity.ts`
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

**Covered:** `project.test.ts` (27, incl. Hebrew/Japanese/accented folder names), `storage-migration.test.ts` (21), `hooks-smoke.ts`, `adapters-smoke.ts` (the built Pi and OpenClaw bundles under real Node and OpenCode under Bun all name a mixed-case repo `demo-repo`).

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

## 4a. Already verified live (build container, Claude Code 2.1.295)

`claude -p … --plugin-dir <checkout> --setting-sources project,local --output-format stream-json` in a scratch git repo, no permission bypass:
- plugin 2.17.0 loads; all 12 tools appear as `mcp__plugin_openltm_memory__*`;
- SessionStart (`startup`, `resume`, `compact`), UserPromptSubmit, PostToolUse, Stop and SessionEnd all fire with exit 0;
- `recall` → `learn` (with title) → `learn` tagged private → `context_add` with no `project` (resolved from the cwd) → `recall` of the private text returns nothing;
- a commit through Claude's Bash tool flags the anchored memory stale, and prompt recall then stops injecting it;
- SessionEnd spawns the janitor (`janitor.log` updated).

## 4. Live end-to-end in Claude Code (interactive)

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

- **Not exercised:** a real embedding model (G1); skill evals (J1, `--trust-plugin` is the owner's call); real Pi, OpenCode and OpenClaw *hosts* (their built bundles are exercised under Node/Bun by `adapters-smoke.ts`); Node < 22.5 (I5); a person typing an interactive session (the multi-turn run in §R2 used `claude -p --resume`); an upgrade on a real long-lived 2.16 install (§R2 used data produced by 2.16 code in a fake home).
- **Resolved since the first handoff:** the source-text tests were replaced with behavior tests on real hook output; Pi's dead `hooks.ts`/`tools.ts` were removed and `session_compact` now runs through the bridge; the README one-step install line was added.
- **Found and fixed during final verification** (each with a test that failed first; full list in CHANGELOG "Fixed after end-to-end verification"): private memories leaking to the embedding/LLM providers, prompt recall, MCP resources and graph traversal; recall's top-N taken before the project filter; systemd units failing on paths with spaces; non-Latin folder names collapsing to ""; prompt-recall precision/recall.
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
