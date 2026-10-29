# Codex hook fix and 2.22.2 release

- [x] Reproduce Codex rejecting Bun dependency symlinks during plugin fingerprinting.
- [x] Move Codex dependency execution into a versioned runtime under plugin data.
- [x] Cover concurrent bootstrap, dependency resolution, aliases and Claude wiring isolation.
- [x] Repair the installed cache with a rollback copy and verify hook loading and MCP startup.
- [x] Synchronize version 2.22.2 and changelog.
- [x] Remove a commented sensitive-decorator example that Varlock parsed as an invalid header directive, preventing the pre-commit scan.
- [x] Remove an optional personal email from marketplace metadata and use a home-relative path in an old changelog example so the existing pre-commit checks can pass.
- [ ] Finish review and final local checks; open the fix PR.
- [ ] Verify PR checks, merge, and verify CI on the release commit.
- [ ] Run the release workflow and verify the tag, GitHub release, npm and ClawHub publication.
- [ ] Merge the repository's generated Hermes catalog re-pin PR and record the outcome.

## Acceptance criteria

Codex loads OpenLTM hooks without unsupported plugin entry errors, the source cache stays free of installed dependency symlinks, hooks and MCP resolve their dependencies, and memory data remains at its existing location. Release 2.22.2 must reference the tested merge commit and complete all configured publishing jobs.

## Verification

- Before repair: zero OpenLTM hook entries and seven fingerprinting warnings for `node_modules/.bin/esbuild`.
- After repair: seven enabled, trusted entries; zero hook-load errors or fingerprinting warnings. No hook-trust settings changed.
- Installed-cache MCP entrypoint initialized with an isolated database and exposed 14 tools.
- A real frozen-lockfile install succeeded in an isolated plugin-data directory without wiring Claude configuration. All seven hook implementations executed through the source launcher in 84-168 ms; prompt recall injected a fixture memory.
- Initial isolated full suite: 1268 passed, 3 skipped, zero failed across 119 files. Typecheck, version synchronization and whitespace checks passed. Runtime tests passed again after the alias-path fix.
- Existing memory data was preserved; smoke checks used isolated databases.

## Release review

Pending PR and publishing verification. Codex CLI 0.165.0 clamps session-end hooks to three seconds; optional long LLM extraction remains unqualified under that host limit. Updating the upstream NousResearch Hermes catalog is a separate manual re-pin, as documented in CONTRIBUTING.md.
