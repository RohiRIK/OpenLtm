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

The project is a Bun workspace. The storage engine lives in `packages/openltm-core`; host adapters live in `packages/adapter-opencode` and `packages/adapter-pi`.

### Useful scripts

| Command | What it does |
|---------|-------------|
| `bun test` | Run the test suite |
| `bun run typecheck` | `tsc --noEmit` across the project |
| `bun run build:hooks` | Bundle the git hook (`hooks/GitCommit.bundle.mjs`) |
| `bun run dev:mcp` | Run the MCP server locally |
| `bun run dev:server` | Run the graph visualizer against a local DB |
| `bun run migrate` | Apply schema migrations to a local DB |
| `bun run verify-version` | Check that all version sources agree |
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
bun test
bun run typecheck
```

Both must pass before a PR is reviewable. E2E tests for the graph app live under `graph-app/` and run with `bun run test:e2e`.

---

## Pull requests

`main` is protected: force-pushes and deletions are blocked, and a PR with one approving review and resolved conversations is required to merge.

1. Branch from `main`.
2. Make the change with tests; keep the diff focused.
3. `bun test && bun run typecheck && bun run verify-version`.
4. Open a PR describing **what** changed and **why**. Link the issue.
5. CI runs typecheck, tests, and a security scan. Green CI + one approval merges.

---

## Releasing (maintainers)

1. `bun run bump <version>` and add a `CHANGELOG.md` entry under `## [<version>]`.
2. Commit and push to `main`.
3. Tag and push: `git tag v<version> && git push origin v<version>`.
4. The **Release** workflow creates the GitHub Release from the changelog; the **Publish** workflow then publishes the `@rohirik/*` packages to npm.

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
