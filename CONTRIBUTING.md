# Contributing to OpenLTM

Thanks for helping build open memory for AI coding agents. This guide covers the development setup, the rules that keep a release shippable, and how to get a change merged.

---

## Ground rules

- **Bun, not npm.** The runtime, test runner, and bundler are all Bun. Don't add `npm`/`node` to runtime paths.
- **Open an issue first** for anything non-trivial, so we can agree on the approach before you write code.
- **Conventional Commits.** `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`, `ci:`.
- **No secrets, ever.** No API keys, tokens, or database files in commits. The repo ignores `data/*.db*` and runs a secret scan — keep it that way.

---

## Development setup

```bash
git clone https://github.com/RohiRIK/OpenLtm
cd OpenLtm
bun install
```

`bun install` in a checkout does **not** touch your `~/.claude` — it no longer wires hooks into your global settings (it used to add one more set per clone or worktree). To run this checkout's hooks in your own Claude Code, load it for one session with `claude --plugin-dir .`, or wire it with `bash install.sh` (or `LTM_WIRE_HOOKS=1 bun install`). Re-wiring replaces any LTM hooks from other checkouts instead of adding duplicates.

The project is a Bun workspace. The storage engine lives in `packages/openltm-core`; host adapters live in `packages/adapter-opencode` and `packages/adapter-pi`.

### Useful scripts

| Command | What it does |
|---------|-------------|
| `bun run test` | Run the test suite with `HOME`/`CLAUDE_CONFIG_DIR` isolated to a temp dir (fails if the real `~/.claude` changes) |
| `bun run test:isolated <paths>` | Same isolation, for chosen test files |
| `bun run typecheck` | `tsc --noEmit` across the project |
| `bun run build:hooks` | Bundle the git hook (`hooks/GitCommit.bundle.mjs`) |
| `bun run dev:mcp` | Run the MCP server locally |
| `bun run dev:server` | Run the graph visualizer against a local DB |
| `bun run migrate` | Apply schema migrations to a local DB |
| `bun run verify-version` | Check that all version sources agree |
| `bun run check:published` | Compare npm's published versions against the repo; fails only if npm holds a version the repo does not (`--strict` to also fail on lag) |
| `bun run check:monthly` | Run the monthly maintenance sweep: tests, typecheck, version sync, bun audit, and optional local scanners (`--json` for a machine-readable summary) |
| `bun run bump` | Bump the version across every required file |

---

## The version-bump rule

A release is only picked up if **every** version source agrees. The marketplace reads `.claude-plugin/plugin.json` — bumping `package.json` alone does nothing.

Every release must bump all of:

1. `package.json`
2. `.claude-plugin/plugin.json`
3. `.claude-plugin/marketplace.json` — **both** `metadata.version` and `plugins[0].version`
4. each `packages/*/package.json`
5. the version badge in `README.md`

`bun run bump` does this for you; `bun run verify-version` fails CI if anything is out of sync. Run it before you push.

---

## Tests

New behavior needs tests. Bug fixes start with a failing test that the fix turns green.

```bash
bun run test
bun run typecheck
```

Tests never touch your real `~/.claude`: a `bunfig.toml` preload refuses to run unless `HOME` is a temp dir. For a single file use `bun run test:isolated <path>` or `HOME=$(mktemp -d) bun test <path>`.

Both must pass before a PR is reviewable. E2E tests for the graph app live under `graph-app/` and run with `bun run test:e2e`.

---

## Pull requests

`main` is protected: force-pushes and deletions are blocked, and a PR with one approving review and resolved conversations is required to merge.

1. Branch from `main`.
2. Make the change with tests; keep the diff focused.
3. `bun run test && bun run typecheck && bun run verify-version`.
4. Open a PR describing **what** changed and **why**. Link the issue.
5. CI runs typecheck, tests, and a security scan. Green CI + one approval merges.

---

## Releasing (maintainers)

1. `bun run bump <version>` and add a `CHANGELOG.md` entry under `## [<version>]`.
2. Commit and push to `main`.
3. Tag and push: `git tag v<version> && git push origin v<version>`.
4. The **Release** workflow creates the GitHub Release from the changelog; the **Publish** workflow then publishes the `@rohirik/*` packages to npm, and its `clawhub` job publishes `@rohirik/openclaw-ltm` to ClawHub. Both use OIDC — no stored tokens.
5. **Hermes Plugin Catalog** is not automatic: run `bun run catalog:sync && bun run catalog:check` and open a re-pin PR against `NousResearch/hermes-agent` (see [`docs/11-publishing.md`](docs/11-publishing.md#3-hermes-plugin-catalog--live)).

---

## Project layout

```
.claude-plugin/   plugin + marketplace manifests
agents/           subagent definitions
commands/         /openltm:* slash commands
hooks/            session + git hooks (src/ + bundled output)
packages/         openltm-core + host adapters (Bun workspace)
skills/           skill definitions
src/              MCP server, graph server, migrations
docs/             user-facing documentation (numbered)
docs/internal/    product + design specs (PRD, ROADMAP, DB-SPEC, UX-SPEC)
graph-app/        memory graph visualizer (Next.js)
```

---

Questions? [Open an issue](https://github.com/RohiRIK/OpenLtm/issues).
