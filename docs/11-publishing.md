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

The adapter is built and packaged, and loads in a real host. Host-level
verification:

```bash
openclaw plugins install @rohirik/openclaw-ltm
openclaw plugins list --json
# then exercise recall/learn inside a live OpenClaw session
```

### 4c. Two distinct marketplaces

OpenClaw has two separate things people call "the marketplace". They are not the
same, and only one is self-serve.

**(i) ClawHub — the built-in, signed feed.** This is the official one.
`openclaw plugins install clawhub:<package>` resolves against a DSSE-signed
hosted feed, and the docs note OpenClaw will only bundle ClawHub's production
public key "after ClawHub generates and hands off that key" — so until then the
built-in profile grants no signed-feed install authority. Getting listed needs a
ClawHub account and a publish. See "Applying for ClawHub" below.

**(ii) A self-serve marketplace manifest.** Fully under our control, no
application needed. `openclaw plugins marketplace list <source>` accepts a local
path, a `marketplace.json`, a GitHub shorthand like `owner/repo`, a GitHub URL,
or a git URL.

Two things found by testing against a real host:

- OpenClaw's manifest discovery order is **`.claude-plugin/marketplace.json`
  first**, then `marketplace.json`. So it already reads our Claude marketplace
  file — and lists the `openltm` entry from it.
- That entry is **discoverable but not installable**: it resolves to the repo
  root, which is a private, non-plugin package with no `openclaw` block, no
  manifest, and no build output. A second manifest is needed pointing at the
  real package.

The runtime schema differs from the TypeScript types: the source object uses
`"type"` (not `"kind"`), and `npm` is **not** a supported source kind. Confirmed
working source forms:

```json
{
  "name": "openltm",
  "version": "2.15.0",
  "plugins": [{
    "name": "openltm",
    "version": "2.15.0",
    "description": "OpenLTM long-term memory for OpenClaw",
    "source": { "type": "github", "repo": "RohiRIK/OpenLtm", "path": "packages/adapter-openclaw" }
  }]
}
```

Users would then run:

```bash
openclaw plugins marketplace list RohiRIK/OpenLtm
openclaw plugins install openltm@openltm
```

### Applying for ClawHub

**Status: the package validates and the dry-run is clean. Only authentication
remains, and that is a human account action.**

```bash
npm install -g clawhub          # or run it locally
clawhub login                    # ← human, interactive, browser sign-in
clawhub package validate packages/adapter-openclaw
clawhub package publish packages/adapter-openclaw --dry-run
clawhub package publish packages/adapter-openclaw
```

Verified locally before any login:

```
$ clawhub package validate packages/adapter-openclaw
Plugin Inspector: PASS
Breakages: 0 · Warnings: 0 · Findings: none

$ clawhub package publish packages/adapter-openclaw --dry-run
Name:      @rohirik/openclaw-ltm
Version:   2.15.0
Commit:    7c656c2f5fc2675e3f7423d971139451251a5fc8
Compat:    pluginApi=>=2026.9.6, builtWith=2026.9.6, minGateway=>=2026.9.6
Files:     6 files (122.0 KB)
Tags:      latest
```

### Publishing to ClawHub — automated on every tag

The `clawhub` job in `.github/workflows/publish.yml` runs after the npm job and
calls `scripts/clawhub-publish-if-needed.sh`, which handles the traps below
(build, resolve `workspace:*`, explicit source coordinates, `--wait` for the
scan, skip a version that already exists). Auth is GitHub OIDC — no token is
stored. It needs a **one-time** trusted-publisher setup by the owner:

```bash
clawhub login
clawhub package trusted-publisher set @rohirik/openclaw-ltm \
  --repository RohiRIK/OpenLtm --workflow-filename publish.yml
clawhub package trusted-publisher get @rohirik/openclaw-ltm   # confirm
```

The package must already exist on ClawHub for this (it does since 2.15.0).
Then re-run the release with `gh workflow run publish.yml --ref main`, or push
the next tag. Without the trusted publisher the job fails at auth and npm is
unaffected.

### Publishing to ClawHub by hand: two traps

**1. ClawHub builds the artifact itself — your `prepack` is not run.** The
ClawHub Inspector reported `PASS`, but the uploaded tarball still contained
`"@rohirik/openltm-core": "workspace:*"`, which fails at install time with
`EUNSUPPORTEDPROTOCOL`. The file list matched the `files` allowlist exactly
(icon included, README absent) — so ClawHub copies the listed files and does
**not** execute npm lifecycle scripts. The same `files` list also predated the
README, which is how a stale artifact surfaced at all.

Fix, and the shape every ClawHub release should use:

```bash
bun run scripts/resolve-workspace-deps.ts rewrite packages/adapter-openclaw/package.json
clawhub package publish packages/adapter-openclaw \
  --source-repo RohiRIK/OpenLtm --source-commit "$(git rev-parse HEAD)" \
  --source-ref main --source-path packages/adapter-openclaw
bun run scripts/resolve-workspace-deps.ts restore packages/adapter-openclaw/package.json
```

Pass the source coordinates explicitly. ClawHub inferred a stale
`Source Ref: feat/…` and an old commit, which linked the release to code that
was not what shipped.

**2. Publishing is two-phase.** The response is
`Update submitted … pending security scans before it becomes public.` A version
is not `latest` — and `clawhub package inspect` keeps showing the previous
version — until the scan completes. That is not a failure; do not re-publish.

Always verify the artifact rather than trusting the inspector:

```bash
clawhub package download @rohirik/openclaw-ltm
tar tzf ~/.openclaw/workspace/rohirik-openclaw-ltm-*.tgz          # expected files
tar xzf ~/.openclaw/workspace/rohirik-openclaw-ltm-*.tgz package/package.json -O \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['dependencies'])"
```

**3. First publishes can fail server-side and still register a version.** One
attempt died with a Convex backend OOM (`512 MB`) and printed nothing useful; the
retry answered `Version 2.15.0 already exists`. The version had been created
before the error. Re-publish as a new version rather than assuming nothing
happened, and inspect before concluding either way.

### Bootstrapping a brand-new npm package

OIDC trusted publishing is configured **per package**, so a package that does not
exist yet cannot be published by CI — the workflow fails with `ENEEDAUTH`
because npm has nothing to attach a trusted publisher to. The first release of a
new package therefore has to be created by an authenticated human:

```bash
npm login
npm publish /tmp/openclaw-ltm-bootstrap.tgz    # the verified 2.15.0 tarball
```

Then add a Trusted Publisher on the package page (repo `RohiRIK/OpenLtm`,
workflow `publish.yml`) and CI owns every release from then on.

Publishing is **resumable**: `scripts/npm-publish-if-needed.sh` skips any package
whose exact version is already on the registry, so a release that half-fails can
be finished with a single re-run instead of dying on "cannot publish over the
previously published versions".

Re-run a failed release with:

```bash
gh workflow run publish.yml --ref main      # NOT --ref <tag>: a tag predates the fix
```

Requirements ClawHub enforces, and our status:

| Requirement | Status |
|---|---|
| `openclaw.plugin.json` in the package | yes |
| `package.json` with `openclaw.compat.pluginApi` | yes — `>=2026.9.6` |
| `package.json` with `openclaw.build.openclawVersion` | yes — `2026.9.6` |
| Manifest `id` unique within the publisher's packages | yes — `openltm` |
| Scoped package name matching the publish owner | `@rohirik/…` — the ClawHub owner handle must be `rohirik` |
| Source repository + exact commit metadata | detected automatically from the GitHub-backed checkout |
| `assets/icon.png` at package root, valid PNG ≤ 512 KiB | yes — 512×512, 9.1 KB, shipped via the `files` allowlist |
| `clawhub package validate` clean | **PASS, 0 findings** |
| `clawhub package publish --dry-run` clean | **clean** |

Note that the package scope must match the publish owner. If the owner handle is
claimed by someone else, ClawHub requires an Org / Namespace Claim issue with
public proof — so confirm the handle before logging in.

New releases stay out of public install surfaces until ClawHub's automated
security checks and verification finish, so listing is not instant.

