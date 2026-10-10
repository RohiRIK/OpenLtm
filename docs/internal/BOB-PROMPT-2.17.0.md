# Prompt for Bob: verify OpenLTM 2.17.0 (round 3) and open the release PR

You are verifying the OpenLTM 2.17.0 release candidate. If it holds up, you open one pull request with everything. Your job is to find what is broken, not to confirm that it works. Work independently. Stop and report only on a blocker you cannot get past.

**This is round 3.** Your round-2 report (REJECT at `2b62f7a`) is answered in `docs/internal/HANDOFF-2.17.0.md` §R3:
- **F1** is fixed.
- **I7** came from a wrong acceptance criterion in the round-2 prompt. The corrected criterion is in step 4.9 below.
- The original-config MCP failure needs data from your machine (step 3b).

Re-verify every §R3 item yourself before anything else in step 4. §R2 (round 1) items stay in scope.

## What you are testing

- **Repository:** `RohiRIK/OpenLtm` (GitHub). Branch: `feat/2.17-hardening`. Base: `main`.
- **Version:** `2.17.0`. It is unreleased: not merged, not tagged, not published.
- **Scope:** the branch consolidates open PRs #27–#38 and six hardening workstreams. It also includes the fixes from three verification rounds.
- **Full test plan:** `docs/internal/HANDOFF-2.17.0.md`. It is the source of truth for expected results; this prompt is the order to work in.
- **What changed:** see `CHANGELOG.md` → `## [2.17.0]`, including "Fixed after the release verification (round 3)".

## Hard rules

1. **Never run tests against your real `~/.claude`.** Every script and `bun run test` isolate `HOME` on their own. Step 3 changes your real Claude Code setup on purpose; back up first, as described there.
2. **Never use** `git push --force`, merge, tag, `npm publish`, or the Release/Publish workflows. Publishing happens only after the owner merges.
3. **Only one GitHub write:** open a PR in step 6, and only if your verdict is APPROVE. Never push commits to `feat/2.17-hardening`. If you find a bug, report it with a proposed patch; don't fix it on the branch.
4. **Evidence for every claim.** Record the exact command, its exit code, and the relevant output. A "PASS" with no output counts as "not run".

## Step 0: State left by round 2

Check and report, change nothing:

```bash
bun ~/src/OpenLtm/scripts/unwire-legacy-hooks.ts --check   # round 2 removed the legacy hooks: expect exit 0
ls -la --time-style=full-iso "${XDG_CONFIG_HOME:-$HOME/.config}/opencode/opencode.json" ~/.pi/agent/settings.json "${XDG_CONFIG_HOME:-$HOME/.config}/mise/config.toml" 2>&1
git config --global --get core.hooksPath
```

## Step 1: Get the branch

```bash
cd ~/src/OpenLtm && git fetch origin feat/2.17-hardening && git checkout feat/2.17-hardening && git pull --ff-only
git log -1 --oneline                                  # record the commit you tested
bun install --frozen-lockfile                         # needs Bun ≥ 1.3; Node ≥ 22.5 for the adapters smoke
(cd graph-app && bun install)
```

## Step 2: Automated gates

Run each gate and record its exit code and the summary lines. Expected results are in HANDOFF §2.

| Gate | Command | Must show |
|---|---|---|
| G1 | `bun run typecheck` | exit 0 |
| G2 | `bun run test` — in your normal shell, **no** `env -u XDG_CONFIG_HOME` or PATH changes | `830 pass`, `0 fail`, `real ~/.claude untouched` (more pass is fine, any fail is not) |
| G2b | `sha256sum` of `${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.json` and `~/.pi/agent/settings.json` before and after G2, plus `pi list` before and after | identical; your `pi` and `mise` were not run |
| G3 | `bun run verify-version` | `All version references in sync.` |
| G4 | `bun run check:openclaw` | `All 17 OpenClaw package checks passed.` |
| G5 | `claude plugin validate .` | `Validation passed` (one expected warning about the root `CLAUDE.md`) |
| G6 | `bun run build:hooks && git diff --exit-code hooks/GitCommit.bundle.mjs` | no diff |
| G7 | `bun run qa:smoke` | six `All … smoke checks passed.` lines (83 checks; new: `continuity`) |
| G7b | `bun run qa:ui` | `32 passed` (Playwright/Chromium; set `PLAYWRIGHT_CHROMIUM=<path>` if the bundled browser is missing) |
| G7c | `bun run scripts/qa/prompt-recall-eval.ts` | `precision=95.2%  recall=94.5%` |
| G8 | `cd packages/adapter-pi && bun run build && grep -c bun:sqlite dist/index.js` (repeat in `packages/adapter-openclaw`) | `0` |

## Step 3: Update OpenLTM in your Claude Code to 2.17.0 from this branch

Back up first:

```bash
cp -a ~/.claude/plugins/data ~/openltm-backup-r3-plugin-data
cp ~/.claude.json ~/openltm-backup-r3-claude.json
cp ~/.claude/settings.json ~/openltm-backup-r3-settings.json
cp -a ~/.claude/projects/registry.json ~/openltm-backup-r3-registry.json 2>/dev/null
```

Use one database for everything: either set nothing (hooks and MCP both use `$CLAUDE_PLUGIN_DATA/openltm.db`), or export `LTM_DB_PATH` (it applies to hooks **and** the MCP server). Don't set `LTM_DATA_DIR` unless you mean it.

Then pick **one** of the two options.

- **Option A: session only (preferred for a first pass).** Leaves your installed plugin untouched.

  ```bash
  claude plugin disable openltm@OpenLtm 2>/dev/null   # avoid two copies loading
  cd <a real git repo you work in>
  claude --plugin-dir ~/src/OpenLtm
  ```

  When you're done: `claude plugin enable openltm@OpenLtm`.

- **Option B: install from the checkout.** This is the real upgrade path, run against your existing 2.16 data.

  ```bash
  claude plugin marketplace remove OpenLtm        # only if the GitHub marketplace is configured under that name
  claude plugin marketplace add ~/src/OpenLtm
  claude plugin install openltm@OpenLtm
  ```

  Restart Claude Code. Afterwards, switch back with `claude plugin marketplace remove OpenLtm && claude plugin install openltm --marketplace RohiRIK/OpenLtm`.

Either way, confirm the loaded version is **2.17.0** and that 12 tools `mcp__plugin_openltm_memory__*` are listed:

- Option A: `claude -p "say ok" --plugin-dir ~/src/OpenLtm --output-format stream-json --verbose | grep -m1 '"subtype":"init"' | grep -o '"name":"openltm"[^}]*'`. The same init line lists `mcp_servers` with each server's status.
- Option B: `claude plugin list`.
- Either option: `/mcp` inside a session.

### Step 3b: Your original config — does the MCP server connect?

In round 2 the server showed as failed in your original `~/.claude` config, but connected under a fresh `CLAUDE_CONFIG_DIR`. Run this **in your original config**, from the repo you test in:

```bash
cd <the repo from step 3>
claude -p "say ok" --plugin-dir ~/src/OpenLtm --output-format stream-json --verbose | grep -m1 '"subtype":"init"' | grep -o '"mcp_servers":\[[^]]*\]'
bun ~/src/OpenLtm/scripts/mcp-probe.ts          # add --plugin-data <dir> if it can't choose one
bun -e 'const f=process.env.HOME+"/.claude/mcp-needs-auth-cache.json"; try { console.log(Object.keys(JSON.parse(require("fs").readFileSync(f,"utf8")))) } catch (e) { console.log(String(e)) }'   # key names only
```

What the probe does:
- It starts the server exactly as Claude Code does.
- It prints `OK`/`FAIL` for: `bun` on PATH, `mcp.enabled`, the handshake time (Claude Code allows 30s), and `tools/list`.
- It shows the server's stderr and the tail of Claude Code's own log for this server.
- It prints only `mcp.enabled` from the LTM config; config files can hold API keys.

Note: Claude Code only puts HTTP, SSE and claude.ai-connector servers into `mcp-needs-auth-cache.json`, never a stdio plugin server. So an "OpenLTM" key there names some other server; report which.

Rules for this step:
- If the init line shows `plugin:openltm:memory` as `connected`, step 3b passes. Run step 4 in your original config.
- If it fails, the probe's FAIL lines and the log tail are the evidence. Report them in full.
  - **Your setup** (no `bun` on the PATH Claude Code runs with; `mcp.enabled: false` set by you): note it, fix it locally, rerun, and continue.
  - **Anything else** is a finding with that evidence.
- If you cannot make it connect, you may run step 4 under a fresh `CLAUDE_CONFIG_DIR` as in round 2, and say so.

## Step 4: Real checks

Do a real piece of work in a git repo that already has 2.16 memories (Option B), or in a scratch repo (Option A).

1. **Existing data survives.**
   - Your 2.16 projects resolve to the same names (HANDOFF §3-I).
   - `context` returns your old goals and decisions.
   - Every file that existed under `~/.claude/projects/**` before the session is byte-identical after it. Compare `find ~/.claude/projects -type f -exec sha256sum {} +` before and after. New transcripts are expected.
2. **SessionStart** at startup, after `/compact`, and after `/clear` (§3-C):
   - It shows an `LTM index` of `- [id] title` lines.
   - It never shows a raw secret: plant one in a memory first.
   - It never shows a memory tagged `private`.
3. **Prompt recall** (§3-D): over about 15 real prompts, count the injected `LTM (relevant to this prompt)` lines that are irrelevant. Report the count; this is the main noise risk.
4. **Learning flow:**
   - Ask Claude to remember something non-obvious. It should call `learn` once, with a title. The reply shows the `project_scope` it stored.
   - Ask it to record a decision. It should call `context_add` with no `project`. The decision then appears in `context` under `decisions` (round-2 F1).
   - Tag one memory `private`. It must not appear in `recall`, in prompt recall, or in the `memory://recent` resource.
5. **Commits** (§3-E): commit through Claude. Memories anchored to the committed files become stale. `git commit --amend` and an empty commit don't double-flag.
6. **End of session:** exit the session.
   - `learned/patterns/` in the plugin data dir (next to that `openltm.db`) gains one file.
   - `/openltm:memory propose review` lists only real proposals.
   - `janitor.log` next to the DB shows a run, or a "skipped: not due".
   - The plugin checkout gains no files (`git status` stays clean).
7. **Graph UI:** run `/openltm:server start`.
   - In the UI, run approve, merge, delete and janitor; every action should return 2xx.
   - Save Settings with a key set; the key must survive.
   - Run `/openltm:server stop`. Both ports 7331 and 7332 must stop answering (`curl` them).
8. **If you have llama.cpp or Ollama:** do HANDOFF §3-G1 with a real embedding model.
9. **One database, with the corrected criterion (round-2 I7):**
   - Through MCP, `learn` two memories: one with `project` (or `files`), and one global with `importance: 4`.
   - Start a new session. Its SessionStart index must list both.
   - A global `learn` with the default importance 3 is **not** in the index by design. Check that `recall` finds it.
   - Then prove there is one DB on the file itself. `CLAUDE_PLUGIN_DATA` is not set in your shell; use the `database:` path that `mcp-probe.ts` printed in step 3b (Option A: `<config dir>/plugins/data/openltm-inline/openltm.db`). `sqlite3 <that path> "select id, project_scope, importance, title from memories order by id desc limit 5"` must list all three.
   - No directory named `${CLAUDE_PLUGIN_DATA}` (or any `${…}`) appears in your repo.
   - Repeat once with `LTM_DB_PATH` exported to a scratch path: hooks and MCP must both use it.
10. **Graph UI edit and delete through the controls:**
    - Open `/projects/<name>/memories`.
    - Click a row, then in the inspector Edit → change the text → Save.
    - Click another row → Delete → confirm.
    - The table must update at once (the delete was stale until round 3), and both changes must survive a reload.
    - G7b now automates this; do it by hand once anyway.

From HANDOFF §3, also cover whatever else you have time for. In priority order: I (identity and storage, user data), A2, H1, E1, F2, J2.

## Step 5: Report and verdict

Report every finding in the format from HANDOFF §6 (ID / Severity / Command / Expected / Actual / Notes). End with a table of area → pass / fail / not run (with the reason), then one verdict.

- **APPROVE** requires all of these:
  - all gates pass, with G2 run in your normal shell;
  - every §R3 item re-verified;
  - step 3b passes, or its failure is shown to come from your setup;
  - no blocker or major findings;
  - step 4 items 1–6, 9 and 10 pass.
- **REJECT:** anything else. List the blockers, each with a proposed fix, and stop. No PR.

## Step 6: Only if APPROVE, open the PR

Open one PR from `feat/2.17-hardening` into `main`. Don't merge it.

- **Title:** `release: 2.17.0 — hardening, prompt-time recall, unified project identity (consolidates #27–#38)`
- **Body:** follow `.github/PULL_REQUEST_TEMPLATE.md`.
  - **Summary:** 3 bullets taken from the CHANGELOG 2.17.0 intro and its Security / Added sections.
  - **Changes:** list the main areas and link to `CHANGELOG.md` for the full list:
    - graph-server security;
    - privacy and scrubbing;
    - hook lifecycle, and the new UserPromptSubmit/PostToolUse hooks;
    - MCP tools;
    - hybrid recall;
    - unified project identity and the storage move;
    - the standalone janitor;
    - skills consolidation.
  - **Test plan:** tick only the boxes you actually verified. Paste your gate table (commands + results) and the step 3b and step 4 results. State the commit SHA you tested.
  - **Related:** "Supersedes #27, #28, #29, #30, #31, #32, #33, #34, #35, #36, #37, #38. Close them after this merges."
- Comment once on the PR with your full report from step 5.

Then hand back to the owner with:
- the PR link;
- your verdict;
- the list of anything "not run";
- the post-merge steps from `CLAUDE.md`:
  - tag `v2.17.0` and push it (the Release and Publish workflows run via OIDC);
  - `bun run catalog:sync`, plus a re-pin PR to `NousResearch/hermes-agent`;
  - close #27–#38.
