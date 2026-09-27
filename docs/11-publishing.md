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

### 4a. Install as an external npm package (lowest effort)

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

**This is the blocker today:** `@rohirik/openltm-core` is a *library* with a CLI
and an MCP server. It is not an OpenClaw plugin and does not declare an
`openclaw` block, so this route needs a thin adapter package.

### 4b. Native OpenClaw memory plugin (the real integration)

Add a small package (e.g. `packages/adapter-openclaw`) that:

- ships `openclaw.plugin.json` with `id`, `name`, `description`,
  `categories: ["memory"]`, `contracts.tools`, `activation`, `configSchema`
- exports a `definePluginEntry` from `openclaw/plugin-sdk/plugin-entry`
- registers the 8 tools and the turn/session hooks
- delegates storage to `@rohirik/openltm-core`

OpenClaw already ships memory plugins of this shape (`memory-wiki`,
`memory-lancedb`), so the pattern is established. Requirements: Node 24.16+ or
26.1+, npm/pnpm, TypeScript ESM. **All plugin APIs are experimental** — we would
pin the host version we test against and declare it in `compat`.

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

### Recommended order

1. Ship 4b (`packages/adapter-openclaw`) with the same shape as
   `adapter-pi` / `adapter-opencode`, reusing `buildPrefillContext` and
   `rankRecallResults` from core.
2. Publish it to npm; route 4a then works out of the box.
3. Optionally add a `marketplace.json` (4c) once the package is proven.

### Open questions to settle before building 4b

- Which `openclaw` host version and `pluginApi` range to pin and test against.
- Whether OpenClaw's memory surface expects a dedicated capability kind, or
  whether a plain tool plugin plus hooks is sufficient.
- Whether the existing MCP server route (`openclaw plugins install` an MCP
  server) is an acceptable lower-effort alternative to a native plugin.

I did not write any OpenClaw code yet: the manifest schema and the SDK entry
contract are large and version-pinned, and guessing them would produce a
manifest that fails their validator. Point me at the specific version you want
to target and I will build against its documented schema.
