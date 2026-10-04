# Hermes Plugin Catalog — entry

This directory holds the catalog entry for OpenLTM's Hermes memory provider.
It is **not** consumed by Hermes at runtime — it is the file you open a pull
request with, against [`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent).

**Status: listed.** Merged on 2026-10-02 as
[`plugin-catalog/openltm.yaml`](https://github.com/NousResearch/hermes-agent/blob/main/plugin-catalog/openltm.yaml),
pinned to v2.15.1. Catalog page: <https://hermes-agent.nousresearch.com/docs/plugins/openltm>.
Each later release needs a re-pin PR — see [Updating the pin later](#updating-the-pin-later).

## How the catalog works

- Each entry is one `plugin-catalog/<name>.yaml` in the hermes-agent repo.
- Entries install by **name**: `hermes plugins install <name>`.
- Admission is **human-merged**: every entry and every pin update lands via a PR
  reviewed by a maintainer. Nothing is automatic.
- Entries pin an **exact 40-hex commit**, not a branch, so a plugin author
  pushing new code does not change what the catalog installs. Bumping the pin is
  a separate reviewed PR.

Because the pin is a commit and this file lives in the repo it describes, the
pinned `sha` always trails the commit that carries the entry by one commit. That
is expected — re-run `bun run catalog:sync` after merging to re-pin.

## Submitting (done — kept for re-pin PRs)

1. Fork `NousResearch/hermes-agent` and create a branch.
2. Copy `hermes/plugin-catalog/openltm.yaml` from this repo to
   `plugin-catalog/openltm.yaml` in your fork.
3. Run `bun run catalog:check` here first — it validates the entry against the
   plugin source (tools and hooks are cross-checked, the `sha` is checked for
   reachability and 40-hex format).
4. Open the PR against `NousResearch/hermes-agent:main`.

## Requirements checklist

From the [Hermes catalog docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/plugin-catalog):

| Requirement | Status |
|---|---|
| Owner-submitted (PR author maintains the repo) | owner action |
| Public, cloneable repository | yes — `github.com/RohiRIK/OpenLtm` |
| Released (real tags, not just a default branch) | yes — `v2.14.2`+ |
| Passing validation (schema, SHA format, reachability) | `bun run catalog:check` |
| Not self-updating (pin is the only update path) | yes — `bun run catalog:sync` only rewrites the pin in a new commit |

Admission CI runs the same security scanner the installer runs; a `dangerous`
verdict fails the entry and `caution` findings are listed for the reviewer. Our
write path redacts secrets before every DB write, which is worth calling out in
the PR description.

## After it is merged

```bash
hermes plugins install openltm
hermes plugins update openltm    # picks up a future pin
hermes plugins list --json       # reports update_available
```

## Updating the pin later

```bash
bun run catalog:sync     # rewrites sha + version to the current tag/commit
bun run catalog:check
# then open a PR bumping the pin in NousResearch/hermes-agent
```
