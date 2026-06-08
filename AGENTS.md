# OpenLTM — agent instructions

Host-agnostic guidance for any AI coding agent working in this repo (Claude Code reads `CLAUDE.md`; OpenCode and other tools read this file). OpenLTM gives agents persistent semantic memory across sessions via a local SQLite database.

## Using memory

The memory tools are exposed over MCP as `recall`, `learn`, `context`, `forget`, `relate` (in Claude Code, prefixed `mcp__plugin_openltm_memory__*`). The goal is automatic knowledge retrieval and capture — use judgment, not a call before every sentence.

- **`recall`** before a non-trivial task, or when the work touches past decisions or an unfamiliar area. Skip for trivial one-liners.
- **`learn`** after discovering a non-obvious pattern, architectural decision, or gotcha worth keeping across sessions.
- **`context`** at session start or when switching projects, to restore goals, decisions, and gotchas.

Categories: `preference | architecture | gotcha | pattern | workflow | constraint`. Importance `5` never decays; everything else ages out as it goes unused.

## Working in this repo

- **Runtime is Bun**, not npm/node. Use `bun`, `bunx`, `bun test`.
- **Tests + typecheck must pass**: `bun test && bun run typecheck`.
- **Version bumps are mandatory** on any change — `bun run bump <version>` then `bun run verify-version` (it gates all version sources: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, every `packages/*/package.json`, and the README badge).
- **No secrets, no database files** in commits. `data/*.db*` is gitignored; keep it that way.

## Shipping to OpenCode

Installing OpenLTM into OpenCode (`bunx @rohirik/openltm-core --opencode`) does two things: registers the `@rohirik/opencode-ltm` plugin in `opencode.json`, and deploys the bundled customization (agents, skills, plugins) from the package's `assets/opencode/` into the user's OpenCode config directory.

## Releasing

Tag-driven and tokenless: bump versions, add a `CHANGELOG.md` entry, then `git tag vX.Y.Z && git push origin main vX.Y.Z`. The tag fires the Release and Publish workflows; npm packages publish via OIDC trusted publishing with provenance — no stored token. Full detail in `CONTRIBUTING.md`.

## Docs

User-facing docs are in [`docs/`](docs/README.md); internal design specs in [`docs/internal/`](docs/internal/README.md).
