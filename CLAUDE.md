# OpenLTM Plugin — Long-Term Memory for AI coding agents

This plugin provides persistent semantic memory across sessions via a local SQLite database.

## Rules

The goal is automatic knowledge retrieval and capture — not a call before every sentence. Use judgment.

1. Call `recall` before a non-trivial task, or when the work touches past decisions or an unfamiliar area. Skip it for trivial one-liners.
2. Call `learn` after discovering a non-obvious pattern, architectural decision, or gotcha worth keeping across sessions.
3. Call `context` at session start or when switching projects, to restore goals, decisions, and gotchas.

## Development Workflow

Every task follows this workflow:

1. **Plan** — Define requirements, check existing patterns with `recall`
2. **Implement** — Write the code
3. **Learn** — After any non-obvious decision, call `learn` to preserve it
4. **Simplify** — Run `/simplify` to clean up the code
5. **Verify** — Run `/verify` (tsc + lint + test + build)

## Version Bump — MANDATORY

**After EVERY fix, feature, or change that touches any file in this repo**, bump the version in **all** of these — they must match exactly:

- `package.json`
- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json` → `metadata.version` **and** `plugins[0].version`
- each `packages/*/package.json` (`openltm-core`, `adapter-opencode`, `adapter-pi`)
- the version badge in `README.md`

`bun run bump <version>` updates most of these; `bun run verify-version` is the gate and fails if any are out of sync. Run it before committing. Also confirm `claude plugin validate .` passes.

**Why:** The Claude Code plugin marketplace detects new versions via `.claude-plugin/plugin.json`. If it is not bumped, "Update now" does nothing. Mismatched `packages/*` versions break the npm publish (the `workspace:*` → `^<version>` rewrite). Do not skip this even for one-line fixes.

## Release & Publish

Publishing the `@rohirik/*` npm packages is automated and **tokenless** (npm OIDC trusted publishing):

1. Bump versions (above) and add a `## [X.Y.Z]` entry to `CHANGELOG.md`.
2. Commit, then `git tag vX.Y.Z && git push origin main vX.Y.Z`.
3. The tag push fires the **Release** workflow (creates the GitHub Release from the changelog) and the **Publish** workflow (publishes all three packages to npm via OIDC, with provenance).

No `NPM_TOKEN` is stored — auth is via GitHub OIDC, configured per package as a Trusted Publisher on npmjs.com. See `CONTRIBUTING.md` for the full flow.

## Cache Sync

During local development, the plugin system reads from the cache at
`~/.claude/plugins/cache/OpenLtm/openltm/<version>/`, not the source repo. Changes take effect when the cache is patched directly, or when the user clicks "Update now" after a version bump.

## Memory Contract

Tool names, the recall-before / learn-after ritual, memory categories, and the Spec/Plan phase map all live in the **Ltm** skill (`skills/Ltm/SKILL.md`) — the single source of truth. It auto-loads on memory work; load it explicitly with `SkillSearch('ltm memory contract')` if you need the names mid-task.
