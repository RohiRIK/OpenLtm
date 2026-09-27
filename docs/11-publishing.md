# Publishing OpenLTM outside this repo

Status of each external channel, and what is left to do. Verified against each
project's own documentation.

---

## 1. npm — live, automatic

`@rohirik/openltm-core`, `@rohirik/opencode-ltm`, and `@rohirik/pi-ltm` are
published by `.github/workflows/publish.yml` on every `v*` tag, using npm OIDC
trusted publishing (no stored token).

Nothing to submit. This is also the channel OpenClaw can install from directly.

> Verified 2.14.2 end to end: `npm install @rohirik/openltm-core@2.14.2`, then
> `memory learn` / `recall` / `context` against a fresh database.

---

## 2. Claude Code marketplace — live, no submission

The marketplace is a git repository. Ours is already the source:

```bash
claude plugin marketplace add https://github.com/RohiRIK/OpenLtm
claude plugin install openltm
```

`.claude-plugin/marketplace.json` and `plugin.json` are version-synced by
`bun run bump`, so a tag updates the marketplace automatically.

---

## 3. Hermes Plugin Catalog — entry prepared, needs a PR to *their* repo

Catalog: <https://hermes-agent.nousresearch.com/docs/user-guide/features/plugin-catalog>

Key facts, confirmed against the live docs and 331 real catalog entries:

- The catalog is a set of YAML files in `plugin-catalog/` inside
  [`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent).
- Admission is **human-merged**: every entry lands as a reviewed pull request.
  Nothing is automatic, and we cannot self-publish.
- Entries **pin an exact 40-hex commit**, not a branch, so pushing new code to
  our repo does not change what the catalog installs. Re-pinning is its own
  reviewed PR.
- Admission CI runs a security scanner; a `dangerous` verdict fails the entry.

Requirements and our status:

| Requirement | Status |
|---|---|
| Owner-submitted | owner action (your account) |
| Public cloneable repo | yes |
| Real releases/tags | yes |
| Validation green (schema, SHA format, reachability) | `bun run catalog:check` |
| Not self-updating | yes — `catalog:sync` only rewrites a pin for a new PR |

**Prepared:** [`hermes/plugin-catalog/openltm.yaml`](openltm.yaml),
modelled on the closest existing entry (`entropicmem`, also a native Python
memory provider). It declares all 8 `openltm_*` tools and the 7 hooks the
provider actually implements.

**Submit:** copy that file to `plugin-catalog/openltm.yaml` in a fork of
`NousResearch/hermes-agent`, run `bun run catalog:check`, and open the PR. Full
walkthrough in [`hermes/plugin-catalog/README.md`](README.md).

**Keep it fresh:** the pin trails the code by one commit by construction.

```bash
bun run catalog:check    # validate (also cross-checks tools/hooks vs source)
bun run catalog:sync     # repoint sha + version
bun run catalog:drift    # fail if stale
```

Until this lands, users can still install directly by git URL:

```bash
hermes plugins install https://github.com/RohiRIK/OpenLtm/hermes/openltm_hermes
```

That path works today but bypasses review and takes the branch tip, not a pin.

---

## 4. OpenClaw — researched, not yet built

Docs: <https://docs.openclaw.ai> · source: <https://github.com/openclaw/openclaw>

There are three viable routes, in increasing order of effort and payoff.

### 4a. Install as an external npm package

OpenClaw resolves bare package names from npm, and we are already published:

```bash
openclaw plugins install @rohirik/openltm-core
```

This only works if the package satisfies OpenClaw's plugin shape. A native
OpenClaw plugin must ship `openclaw.plugin.json` in the plugin root and declare
an entry in `package.json`:

```json
{
  "openclaw": {
    "extensions": ["./index.js"],
    "compat": { "pluginApi": ">=x.y.z", "minGatewayVersion": "x.y.z" }
  }
}
```

**This was the blocker:** `@rohirik/openltm-core` is a *library* with a CLI and
an MCP server, not an OpenClaw plugin, and it does not declare an `openclaw`
block. The adapter package in §4b is what satisfies it.

### 4b. Native OpenClaw plugin — BUILT (`packages/adapter-openclaw`)

Target pinned to **`openclaw@2026.9.6`** (latest at time of writing).

**Feasibility, verified rather than assumed:** `@openclaw/plugin-sdk` is a
workspace package and is *not* published to npm (404), so an external plugin
cannot import it directly. It does not need to: the published `openclaw` tarball
contains `dist/plugin-sdk/plugin-entry.js` and its `exports` map includes
`./plugin-sdk/plugin-entry`. Plugins import
`openclaw/plugin-sdk/plugin-entry` and declare `openclaw` as an **optional peer
dependency**, which is what the adapter does.

**Shape chosen: a tool plugin, not a memory-slot plugin.** OpenClaw's memory slot
is exclusive and its runtime contract is *file/line* oriented — `MemorySearchResult`
carries `path`, `startLine`, `endLine`, and `snippet`. OpenLTM stores rows with
integer ids. Claiming the slot would mean fabricating file paths for every
memory, which would be dishonest data modelling and would fight OpenClaw's own
memory plugin. The adapter therefore:

- declares `categories: ["memory"]` so it is discoverable on the memory shelf
- omits `kind: "memory"`, so it does **not** claim the exclusive slot
- registers the eight `openltm_*` tools
- injects Prior Knowledge each turn via `registerMemoryPromptSupplement`

This is the shape their own quickstart documents, and it composes with
OpenClaw's built-in memory rather than displacing it.

Files:

- `packages/adapter-openclaw/src/index.ts` — `definePluginEntry` + tool registration
- `packages/adapter-openclaw/openclaw.plugin.json` — manifest
- `packages/adapter-openclaw/types/openclaw-plugin-sdk.d.ts` — ambient SDK types,
  needed because the host package is not installable in CI
- `packages/adapter-openclaw/src/__tests__/plugin.test.ts` — 10 tests

Verified: `bun run check:openclaw` (17 checks against their real loader rules),
10 adapter tests, typecheck, and a clean esbuild bundle that keeps both
`openclaw` and `@rohirik/openltm-core` external (a bundled copy of core would mean
a second DB singleton).

**Not verified:** the plugin has never been loaded by a real OpenClaw host —
installing OpenClaw is an owner decision. The manifest is validated against
OpenClaw's actual loader source, and the registration logic is tested, but
end-to-end host loading is untested.

### 4c. Hosted marketplace feed (later)

The marketplace is a DSSE-signed hosted feed (`clawhub-public` profile), not a
PR-to-a-repo model:

```bash
openclaw plugins marketplace list owner/repo   # GitHub shorthand works
openclaw plugins install <plugin>@<marketplace>
```

A local `marketplace.json` or a `owner/repo` shorthand is enough for us to
publish and consume a marketplace ourselves without ClawHub onboarding.

Note: the manifest docs state that OpenClaw **auto-detects** Claude bundle
layouts (`.claude-plugin/plugin.json`). That is a compatibility affordance for
reading bundle metadata — the docs explicitly say such bundles are *not*
validated against the `openclaw.plugin.json` schema. For a memory provider we
should not rely on it; route 4b is the supported path.

### Recommended next step

The adapter is built and packaged. Once OpenClaw is installed locally, the
remaining step is host-level verification:

```bash
openclaw plugins install @rohirik/openclaw-ltm
openclaw plugins list --json
# then exercise recall/learn inside a live OpenClaw session
```

Optionally add a `marketplace.json` (§4c) once the package is proven in a real
host.
