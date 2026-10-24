# Changelog

## [2.22.0] — 2026-10-24

### Added
- **Agents can define their own structured types of information** (collections, migration 031). Facts with a fixed shape, such as hosts and ports, releases and whether each was tagged, or API endpoints, no longer have to be prose. An agent defines a *collection* (named, typed fields: `string`, `text`, `integer`, `number`, `boolean`, `date`, `enum`, `string[]`, `url`) and stores validated *records* in it, then finds them by field (`tagged = false`, `port > 8000`) or by text. A new type is a row, not a table: no agent-written SQL or DDL ever runs, and the migration checksum gate is untouched. See [Collections](docs/16-collections.md).
- **`collection` and `record` tools on every host**: MCP (and Pi through it), OpenCode (`ltm_collection` / `ltm_record`), OpenClaw and Hermes (`openltm_collection` / `openltm_record`). `define` refuses a near-duplicate type (`server` next to `servers`) unless `force`; `evolve` allows additive changes only; `put` upserts by the key field and refuses secret-shaped values instead of storing a redacted placeholder. Errors come back with a stable code so the model can correct the call.
- **Records in recall and context.** `recall` with a query appends up to 3 matching records after the memories (`type: "record"`, `includeRecords: false` turns it off), ranked by full-text search and, with an embeddings provider (local llama.cpp by default), by vector similarity too. `context`, the SessionStart index and the Hermes system prompt list the collections that exist, inside the recalled-memory frame.
- **Records carry an origin and are labelled when they look like permission.** Records use the memory origin values; tools default to `agent-observation`, the CLI writes `owner-statement`. A `historical-approval` record, or one in a type whose names read like a permission (`approved`, `authorized`, `allowed`…), comes back with an `authority_note`: history, not a current permission.
- **Managed indexes.** Past 2,000 active records (`collections.index_min_records`), the first query that filters or sorts on a scalar field indexes it for that collection (at most 3). About 15× faster lookups at 20,000 records.
- **Owner CLI:** `ltm collection list | show | define | evolve | archive | restore` and `ltm record list | get | put | archive | export`. Only the CLI can make a breaking change (`evolve --allow-breaking`), after backing up the database and revalidating every record.
- **Collections page in the graph app** (`/collections`): browse types and records, search, archive and restore.
- **Hermes:** a Python port over the same tables and DDL, so a database shared through `LTM_DB_PATH` works from both sides; core and Hermes run one shared contract fixture.
- Eval `07-collections-record` checks that an agent reuses an existing collection instead of writing prose or a near-duplicate type. The Ltm skill says when to use a record and when `learn`; MemoryReview reviews new, empty and duplicate collections.

## [2.21.0] — 2026-10-24

### Added
- **Every host can curate memory, not only Claude Code.** OpenCode had 5 tools and could not fetch a full memory, review session-end proposals, list or clear stale flags, or record a goal or decision. It now has 11: `ltm_get`, `ltm_stale`, `ltm_revalidate`, `ltm_context_add`, `ltm_proposals` and `ltm_stats` join the original five. OpenClaw gains `openltm_get`, `openltm_context_add` and `openltm_proposals`. Pi proxies the MCP server, so it gets every new tool without a change.
- **MCP `stale` and `stats` tools.** `stale` lists the memories a commit flagged stale, with the reason, so curation no longer scans a 50-row recall for the flag. `stats` counts memories by status, category and importance, plus stale, private, embedded and pending-proposal totals; `embedded: 0` means recall is on full-text search only. Core exports `listStaleMemories`, `memoryStats`, `getProjectContext` and `addContextItem`, which every host now shares.
- **`/openltm:doctor` checks embeddings.** A new *Embeddings (semantic recall)* section says whether the embedding server answers, what vector size it returns, and how many memories already have a vector, with the `llama-server` command to run when it is down. Only a fixed probe string is embedded. Before this, a missing server silently left recall on full-text search.
- **[Local embeddings guide](docs/15-local-embeddings.md):** llama.cpp and bge-m3 in five minutes, including the batch-size flags long memories need and a systemd / launchd service so the server stays up.

- **Every memory records where its claim came from** (memory-versus-authority Phase 2, migration 030). `memories.origin` is `owner-statement`, `agent-observation`, `external-source`, `historical-approval` or `proposal`, so an owner's correction no longer reads the same as an agent's guess, and a past approval is labelled as history, not permission. `learn` takes `origin` on every host (MCP, OpenCode, OpenClaw, Pi, Hermes, and `ltm memory learn --origin`), defaults to `agent-observation`, and `recall` returns it. The owner restating a memory upgrades it to `owner-statement`; nothing else changes an origin. The onboarding goal is recorded as an owner statement. Existing rows stay unknown (`NULL`), except session-end extractions, which become agent observations. Hermes adds the column to its own databases and now writes the `memory_provenance` row core writes, when that table exists.

### Fixed
- **OpenClaw `openltm_stale` could never clear a flag.** It sent `memory_id` to the core `revalidate` tool, which takes `id`, so every `clear` failed. Its `list` read a `stale` field compact recall never returns, so it always answered "No stale memories."
- **OpenClaw `openltm_brain_stats` counted a 50-memory recall sample**, not the store. It now reports the real totals.
- **OpenCode `ltm_context` returned memories only.** The goal, decisions, gotchas and progress were missing although the tool promised them. It now returns the same shape as the MCP `context` tool.
- The MemoryReview skill lists stale memories with the new `stale` tool.

## [2.20.3] — 2026-10-24

### Fixed
- **`bun run catalog:drift` can pass.** It compared the Hermes catalog entry with `HEAD`, and committing a re-pin moves `HEAD`, so it failed on every commit. It now compares with the latest `v*` release tag, the only thing that is ever pinned, and fails only when a release has not been re-pinned.
- **`catalog:sync` also repoints the banner image URL**, which pinned the old commit.
- The repo's Hermes catalog entry is pinned to v2.20.0 (it still said 2.16.2).

## [2.20.2] — 2026-10-24

### Fixed
- **The `ltm` CLI no longer keeps its database in the bunx cache.** Without `LTM_DB_PATH`, a published install (`bunx @rohirik/openltm-core memory …`, `janitor …`, `mcp-serve`) put a new database in `node_modules/data/` — for bunx a per-version cache, so the memories were gone after the next upgrade and never reached the database the installer prints as "Shared DB". A new database now goes to the shared Claude plugin data dir (`~/.claude/plugins/data/openltm-OpenLtm/openltm.db`); one that already exists under `node_modules/data/` stays in use, and a monorepo checkout keeps `data/openltm.db`.
- **An unknown option is a usage error.** `ltm --claud` or `ltm --version` used to fall through to an auto-detect install. The CLI now prints help and exits 1.
- **`ltm memory recall docker rate limit` searches for the words.** Positional words were dropped, so `recall` listed everything and `learn` asked for `--text`. `learn` and `recall` now take their text as positional words too; a stray word on `forget`, `relate` or `context` is a usage error instead of being ignored.

### Security
- **zod 4.6.6+ and body-parser 2.4.0+.** zod 4.4.3 is affected by CVE-2023-54404 (high: denial of service via unbounded array validation) and body-parser 2.3.0 by CVE-2026-111181 (high: denial of service via an unhandled decompression stream error). The Trivy scan failed on both.

### Added
- `ltm --version` / `-v`, and `ltm help`. The help now lists the `conflict` sub-command.

## [2.20.1] — 2026-10-23

### Security
- **The graph dashboard requires Next.js 15.5.28** (`graph-app`). 15.5.26 is affected by GHSA-2464-fhr4-w9xw (critical: unauthenticated remote code execution in the Image Optimization API via SVG files) and CVE-2026-94482 (high: denial of service via crafted Server Actions requests). The Trivy scan on `main` failed on both.

### Fixed
- **`/openltm:doctor` rejects a malformed `agents` field** in `plugin.json` (null, numbers, nested arrays, empty strings) instead of coercing it to paths. The doctor tests now run in CI.
- **Hermes: the memory provider prompt says how to call its tools.** They are direct provider tools, not routed through `tool_call` or imported in `execute_code`, and a fact counts as saved only after a tool receipt returns its memory ID.

## [2.20.0] — 2026-10-18

### Changed
- **The OpenCode plugin runs on OpenCode V2** (`@opencode/plugin` 2.0.32). OpenCode 2 rejects V1 plugin modules at load time, so `@rohirik/opencode-ltm` failed to load and its tools and memory injection were gone. The plugin now default-exports `{ id: "openltm", setup }`, adds its five `ltm_*` tools through `ctx.tool.transform` with JSON Schema inputs (as direct tools, not behind code mode), injects the Prior Knowledge block through the `context` session hook and keeps active memories through the `compaction` hook. The project is resolved from `ctx.location.directory`. **OpenCode 1.x users should pin `@rohirik/opencode-ltm@2.19.0`**; this version does not load there.

### Fixed
- **A database migrated by an older release no longer fails with "checksum mismatch".** Migrations 009, 015, 017, 023 and 027 were edited after they shipped, so a database that applied an earlier text was refused at startup and OpenLTM went down. Those exact earlier texts are now recognized and re-recorded with the current checksum; the edits never changed the resulting schema. Any other mismatch still fails closed, and its error now names every mismatched version and the way out.
- **`/openltm:admin migrate --accept-checksums`** recovers from a mismatch that is not on that list: it backs the database up, then re-records the checksums. No migration SQL runs and no data changes. `migrate status` lists mismatched versions.
- **`/openltm:doctor` exists again.** Onboarding and the docs pointed to it, but the command file was gone, so Claude Code answered "Unknown command". It runs the plugin health check, which now also reports migration checksum mismatches. The check itself crashed on the `agents` array in `plugin.json`, looked for an MCP server named `ltm` instead of `memory`, flagged the quoted hook commands as unrecognised, and pointed to the removed `/openltm:migrate`; all fixed.
- `/openltm:admin migrate` ran `src/migrations.ts`, which does not exist; it now runs the core migration runner.
- **OpenCode `ltm_learn` without a category no longer fails.** The category is auto-detected (heuristic only) like the MCP `learn` tool, and the result reports the stored category.

## [2.19.0] — 2026-10-15

### Changed
- **Full-text search stems words with porter** (migration 029). `memories_fts` and `context_items_fts` are rebuilt with `tokenize='porter unicode61 remove_diacritics 2'`, so a query word matches the other forms of a stored word: "migrating" finds "migrations", "decaying" finds "decay", "typechecking" finds "typecheck". On the golden memories mixed into 3,000 noise memories, FTS paraphrase MRR rose from 0.55 to 0.78 and golden-query MRR from 0.52 to 0.61; the index is slightly smaller. Recall ranking changes accordingly. The rebuild runs once, when the migration applies.
- **Memories are written in English.** The `learn` and `context_add` tool descriptions (MCP, OpenCode, OpenClaw, Hermes), the Ltm skill and the session/commit extraction prompt now tell the agent to store titles and content in English, translating when the conversation is in another language. Search and near-duplicate detection only handle English well, so mixed-language memories were hard to find again.

### Tests
- Inflected golden recall queries that fail without stemming, and a check that both FTS tables use porter.

## [2.18.2] — 2026-10-15

### Performance
- **Query recall is over 100x faster on large stores.** The FTS probe in `recall()` filtered with `rowid IN (SELECT id FROM memories …)`, which FTS5 treats as a rowid constraint and answers by re-running the MATCH once per memory in scope. It is now a JOIN with the same filters and returns the same rows in the same order. With the changes below, FTS-only recall at 10k memories goes from 1.26 s to 9 ms median (3.9 s → 16 ms p95).
- **The full-text index is only rewritten when the text changes** (migration 028). The `memories_au` / `context_items_au` triggers fired on any column update, so every recall, every graph-app edit and the nightly decay refresh deleted and re-indexed the row's tokens. They now fire on `UPDATE OF title, content`. Nightly decay at 50k memories: 1.7 s → 0.26 s, and the index no longer fragments (three decay runs had tripled its segment count and doubled recall time). The migration runs an FTS `optimize` once.
- **Recall's near-duplicate demotion tokenizes each candidate once** instead of once per pair (~40 ms → ~1 ms per recall; same results).
- `learn()`'s near-duplicate shortlist probes FTS with content words only, skipping stopwords.

### Fixed
- Graph app search quotes each word before MATCH, so input such as `foo-bar`, `c++` or a stray `"` is searched for instead of failing as FTS syntax. A trailing `*` still does a prefix search.

## [2.18.1] — 2026-10-15

### Security
- **OpenCode prefill and compaction scrub memory text before it reaches the prompt.** `prefill.ts` renders each line as `oneLine(scrubForEgress(content))`, and the OpenCode compaction hook scrubs every memory, so a legacy row stored before write-time scrubbing can no longer leak a key into `<recalled-memory>`.
- **Hermes `openltm_learn` scrubs content and title before storing and embedding them.** It fails closed like the TS `scrubOrRefuse` (new `scrub_or_refuse` in `_secrets_scrubber.py`): if scrubbing errors, nothing is stored. The embedder only ever sees the scrubbed text, so a key never goes to a cloud embedder.
- **Hermes prefetch and reviewed project context scrub every title and content line**; a line that cannot be scrubbed is dropped, never emitted raw.
- **The recalled-memory tag neutralizer catches look-alike tags** (TS and Python): text is NFKC-normalized (fullwidth `＜／＞`), HTML entities are decoded (`&lt;`, `&#60;`, `&#x3c;`, double-encoded), U+FEFF and zero-width characters are removed, and `recalled-memory`, `recalled_memory` and `recalled memory` match in any case. A match becomes `[recalled memory tag removed]`, which cannot read as a tag. Clean text is left byte-identical.
- **`hermes/upgrade-plugin.sh` prunes only its own backups** (`openltm-YYYYMMDD-HHMMSS[-N]` directories) and never deletes the backup it just made, even with `OPENLTM_KEEP_BACKUPS=0`.

- **Hermes `_db.learn` scrubs content, title and tags itself**, so every caller is covered (`openltm_learn`, `sync_turn`, `on_session_end`, `on_memory_write`). Tags are scrubbed before they are lowercased. Stale reasons are scrubbed too. Nothing is stored if the scrubber fails.
- **Hermes embeddings fail closed**: the learn, dedup and query embed paths use `scrub_or_refuse` and skip the embed on refusal; the identity fallback that embedded raw text if the scrubber could not be imported is gone.
- **Tool output is scrubbed per item**: Hermes `openltm_recall`, `openltm_graph`, `openltm_context` and `openltm_stale list`, and OpenCode `ltm_recall` and `ltm_context`. An item that cannot be scrubbed becomes `[scrub-failed]`.
- The neutralizer now rewrites only the matched span and returns the rest of the text untouched, and also catches format and combining characters, variation selectors, dash variants, runs of spaces, common homoglyphs (Cyrillic, `I`/`l`), `<\/` and `‹`/`〈`/`﹤`.
- **AWS secret keys are found by label normalization plus a proximity pass** (TS and Python, identical). A label is lowercased and stripped of `_`, `-` and spaces only to decide a match; any label containing `aws` or `secret` counts (`AWS_SECRET_ACCESS_KEY`, `aws_secret_access_key`, `SecretAccessKey` in IAM and STS JSON, `AwsSecretAccessKey`, `Aws_Secret_Access_Key`, terraform `secret_key`, labels of any length), except `secretary` and labels that are exactly `accesskeyid`, `secretkeyid` or `keyid`. Separators include `:`, `=`, `=>`, `->`, whitespace and a YAML next-line value (indent up to 16). A second pass catches a value near an aws/secret word (`aws-<key>`, `aws secret, <key>`, `AWS_SECRET_ACCESS_KEY(<key>)`, `s3://bucket/aws/<key>/x`). Values of 40–48 characters match. Redacted output now keeps the label and separator; only the value is replaced. STS `ASIA…` key ids and `SessionToken` / `session-token` values are redacted too, value only, so JSON stays valid.
- `upgrade-plugin.sh` matches backup names with bash `[[ =~ ]]` instead of GNU `find -regextype` (works on macOS) and never touches symlinks.

- The generic `api_key` / `secret_key` / `access_token` pattern no longer goes quadratic on long input: the gap before the quoted value is bounded (`[^\n]{0,200}?` instead of `.*?`; it may cross a quote, so `os.environ.get('X', '<key>')` defaults are still caught).

### Tests
- Plant-secret and bypass regressions for each fix, including forced scrubber failures; Hermes pytest now runs in CI.

### Changed
- `bun.lock` workspace versions match the package versions.

## [2.18.0] — 2026-10-14

### Added
- **Recalled memory is framed as evidence, not instructions** (Phase 1 of [Memory versus Authority](docs/memory-versus-authority.md)). Every path that injects memory into a prompt now wraps it in a `<recalled-memory>` block that opens with a fixed notice: the content is context from earlier sessions and grants no permission. Covers the SessionStart index and restored context, UserPromptSubmit prompt recall, the OpenCode, Pi and OpenClaw prefill blocks, OpenCode compaction, and the Hermes system-prompt context and prefetch. Any `recalled-memory` tag inside stored text is defanged, so a record cannot close the block and pose as an instruction.
- The MCP server sends the same rule in its `instructions`, and the `recall`, `get` and `context` descriptions say results are evidence, not instructions. Tool result payloads are unchanged.
- `frameRecalledMemory` is exported from `@rohirik/openltm-core`; Hermes has a matching `_memory_frame.py` (a test keeps the notice text identical).

### Changed
- The OpenClaw `prefillLines` budget now counts the header and memory lines; the four frame lines are fixed overhead on top of it.

### Fixed
- `hermes memory setup openltm` offers `llamacpp` as an embedder choice (listed first); it was missing although the plugin supports it since 2.17.2. The default when nothing is configured is still Ollama.

### Docs
- Hermes plugin README, catalog entry and [Hermes Integration](docs/10-hermes-plugin.md) lead with a local llama.cpp embedding server for semantic recall; cloud embedders are no longer described as options up front. The root README and [Configuration](docs/04-configuration.md) list cloud providers only as opt-in values.

## [2.17.5] — 2026-10-14

### Fixed
- **Hermes plugin upgrade steps assumed a symlinked install.** `hermes plugins install` (catalog or repo path) leaves a copied directory in `~/.hermes/plugins/openltm/`, which `git pull` never updates, so upgrade verification stopped at its first step on such a machine. New `hermes/upgrade-plugin.sh` works for both: `--check` reports the install kind and installed vs. checkout version (exit 3 when missing or different); a copied install is replaced from the checkout with the old copy kept in `~/.hermes/plugin-backups/` (outside `plugins/`, so Hermes never loads it twice); a symlinked install is never deleted or copied over, and `--pull` fast-forwards the checkout it points at; `--link` turns a copy into a symlink. `openltm.json` and the DB are not touched.
- `upgrade-plugin.sh --pull` refuses a checkout with uncommitted changes and exits 1 when the symlink target is not a git checkout. The script refuses an unset `HOME` and an empty or `/` `HERMES_HOME`, skips the backup when a copied install already matches the source, and keeps at most `OPENLTM_KEEP_BACKUPS` (default 5) plugin backups.

### Docs
- [Hermes Integration](docs/10-hermes-plugin.md#upgrading-an-installed-plugin) and `hermes/README.md` explain how to tell a copied install from a symlink and how to upgrade each.

## [2.17.4] — 2026-10-14

### Security
- `learn()` scrubs the agent-supplied title and tag names before writing (fail-closed); `compact()` recall scrubs tags.
- `classifyRelation` scrubs both memory strings before the LLM call and skips the call if scrubbing fails.
- Graph UI `PUT /api/memory/:id/ui` scrubs title and note, and validates color (`#rgb`/`#rrggbb`) and icon (name or emoji, max 32 chars).
- MCP payload scrubbing is now deep, including neighbour memories in `relations[]`; past depth 32 a stub is returned, never the raw subtree.
- PreCompact snapshot lines are scrubbed; a line that fails to scrub is omitted, and the previous summary is kept if every line drops.

### Fixed
- SessionStart conflict banner now addresses the user (run `ltm conflict list`) and gives the agent no accept/reject instruction.
- `acceptStagedConflict` claims the row, checks both memories are active and supersedes in one transaction; rows whose memories are gone become `stale` (migration 027).
- `ltm conflict list` scrubs staging terms; `listStagedConflicts(project)` only returns conflicts within that project or global.
- Migrations run statement by statement so a failure rolls back; 027 aborts unless row counts match.
- `backupDb` backs up the migrated DB with VACUUM INTO under its own file mode, never overwrites (numeric suffix), aborts the migration on failure, and retention only touches its own `.bak-*` files.
- Tag replacement is atomic.
## [2.17.3] — 2026-10-14

### Docs
- Added [Memory versus Authority](docs/memory-versus-authority.md): ordinary learning and recall provide context and evidence, not authorization for consequential actions. Distinguishes implemented adapter behavior from a proposed authority boundary, with practical examples and future acceptance criteria. No memory-policy or runtime-enforcement changes.
- Linked the article from the documentation index.

## [2.17.2] — 2026-10-11

### Added
- **Hermes llama.cpp embeddings.** Explicit `embedder: "llamacpp"` uses llama-server's local `/health` and `/v1/embeddings` endpoints, matching core's existing llama.cpp provider. JSON `llamacpp_url` / `embedding_model` options override `LTM_LLAMA_CPP_URL` / `LTM_EMBED_MODEL`; defaults are loopback port 8080 and BGE-M3. Stored vectors retain the actual dimension and selected model identity in either embedding layout. No cloud fallback; HTTP failures and malformed, empty, nonfinite or non-float32-storable vectors preserve FTS recall and are never cached.
- Real HTTP-contract regression tests cover configuration wiring, failure recovery, caching and model identity after core's embedding-table migration. Existing provider defaults are unchanged.

## [2.17.1] — 2026-10-11

Fixes from the 2.17.0 install on a real machine: the marketplace plugin now installs its own packages, and Claude Code can share one memory with the Hermes plugin.

### Fixed
- **Fresh marketplace installs failed to start.** Claude Code installs a plugin's packages only when its `bun.lock` lists the plugin as the only workspace; OpenLTM's monorepo lockfile doesn't, so `claude plugin list` noted "The packages it lists were not installed" and every hook and the MCP server crashed with `Cannot find module '@rohirik/openltm-core'`. The first hook or MCP start now runs `bun install --frozen-lockfile` in the plugin directory (`scripts/ensure-deps.ts`). It runs detached under a lock, so a hook timeout can't kill it mid-way and concurrent launchers don't install twice, and it logs to `<plugin data>/deps-install.log`. SessionStart and the MCP server wait for it; other hooks skip their run until it finishes. Measured on an empty bun cache: 3.3 s, MCP handshake at 3.5 s.
- **Core could not open a database the Hermes plugin created.** The Hermes schema already has columns core's migrations add, but not every index and table they add, so migration 007 stopped with `duplicate column name: workspace_id … index "idx_memories_workspace" does not exist` (011 likewise on a DB built from `hermes/schema.sql`). A failed migration is now reconciled statement by statement in one transaction: DDL whose column, table, index or trigger provably exists is skipped, everything else runs, and a destructive statement (`DROP`, `DELETE`, `ALTER … DROP/RENAME`) or any error rolls it back and records nothing. This replaces the gate that refused any migration mixing a present column with missing objects or a backfill. Statements are now split trigger-aware (a `CREATE TRIGGER … END;` body stays one statement).
- **The Hermes plugin's vector search broke once core had migrated its DB.** Core's migration 010 moves vectors from `memories.embedding` to `memory_embeddings`; the plugin now reads and writes whichever layout the DB has, stamps the model and dimension it writes, and compares only vectors of the query's dimension and model (vectors moved by 010, stamped `unknown`, still match).
- **The Hermes janitor failed on a fresh Hermes DB** (`no such column: decay_score`): `init_schema()` now adds the column.
- **Vectors written by the Hermes plugin were invisible to core's vector index.** At startup core now indexes `memory_embeddings` rows the sqlite-vec index is missing, not only an empty index.
- **`LTM_DB_PATH="~/…"` in `~/.claude/settings.json` created a directory named `~`.** Values there don't pass through a shell; the hooks, the MCP server and core now expand a leading `~/`.

### Docs
- [Hermes Integration](docs/10-hermes-plugin.md) no longer claims the core runner migrates the Hermes DB; it documents sharing one memory with Claude Code through `LTM_DB_PATH`, the backup to take first, matching the embedding model (`LTM_EMBED_PROVIDER=ollama`), and that the Hermes plugin must be updated first.
- Troubleshooting covers the "packages were not installed" note; Installation and Configuration mention the first-start install and `~/` expansion.

## [2.17.0] — 2026-10-11

Hardening and "recall everywhere". Consolidates open PRs #27–#38 with six parallel workstreams into one release.

### Security
- **Graph server no longer exposed to the network.** It bound `0.0.0.0` and `GET /api/settings` returned provider API keys in plain text. It now binds `127.0.0.1` (override: `LTM_SERVER_HOST`, with a warning), rejects non-loopback `Host`/`X-Forwarded-Host`/`Origin` (DNS-rebinding and cross-site requests), requires `Content-Type: application/json` on mutations, masks secrets in settings/config responses (masked values sent back never overwrite the real key), and confines `/api/reveal` to the database directory. The Next UI on :7332 now binds loopback too.
- **Fail-closed secret scrubbing on every durable write** (#29) **and on egress** — SessionStart injection, MCP recall/context/context_items/resources, categorise, dedup prompts, embeddings (#31).
- **Private tags** — memories tagged `private` are left out of recall, SessionStart, exports, `get` and janitor candidates unless `includePrivate` is passed. Private is not encryption (#37).
- **Proposals**: `accept`/`reject` refuse path-like session ids (previously `../x` could rewrite or delete JSON outside the proposals dir).
- Staging terms are scrubbed before `memory_conflict_staging` writes (#34 follow-up that was missing from the PR stack tip).
- **Private memories never leave the machine.** Before this, a `private` memory was still sent to the embedding provider by `learn()` (its vector and auto-relations), to the categorise LLM, injected by prompt recall, listed by the `memory://` MCP resources, and reachable through graph traversal. All of those paths now skip it.
- Prompt recall and the SessionStart context summary are egress-scrubbed too (rows and legacy context files written before the scrubber existed reached the model verbatim).

### Added
- **Prompt-time recall** — new `UserPromptSubmit` hook adds up to 5 memories relevant to each prompt (full-text only, ~50ms, never repeats a memory in a session). Config: `ltm.promptRecall`, `ltm.promptRecallLimit`.
- **Commit-driven stale flagging inside Claude Code** — new `PostToolUse` (Bash) hook flags memories anchored to files Claude commits, without the global git hook.
- **MCP tools** — `get` (fetch one memory by id, #32), `context_add` (goal/decision/gotcha/progress), `proposals` (list/accept/reject). `context`/`context_items`/`context_add` default `project` to the current one. Every tool carries MCP annotations (`readOnlyHint`, `destructiveHint`, …) and the server reports the real package version.
- **Hybrid recall** — full-text (stopwords dropped, prefix + plural matching) and semantic results fused with Reciprocal Rank Fusion; query relevance now leads ranking. Golden-query eval: right memory first 8/8 (was 1/8). `RecallInput.semantic: false` forces full-text.
- **SessionStart compact index** — `- [id] title`, capped by `injectTopN` (now actually wired, #30/#33), full body via `get`.
- **Supersede review** — contradictions are staged, never auto-applied; SessionStart lists pending ones; `ltm conflict list|accept|reject|coexist` (#34, #35).
- **Learn near-dedup** — FTS shortlist + Jaccard tiers with `matched_by`/`score`/`matched_id` on the result (#36).
- **Standalone janitor** — `ltm janitor run|status|schedule|daemon`, single-instance lock, `SessionEnd` trigger, systemd/launchd/cron units (#27).
- **`scripts/unwire-legacy-hooks.ts`** — lists (`--check`) or removes OpenLTM hook entries from `~/.claude/settings.json`, with a backup.
- **QA harness** — `bun run qa:smoke` (MCP over stdio, every hook as a subprocess, the semantic path against a stub embeddings server, the built Pi/OpenClaw bundles under Node and OpenCode under Bun, graph-server network guards) and `bun run qa:ui` (the graph UI in Chromium via Playwright). `scripts/qa/prompt-recall-eval.ts` measures prompt-recall precision/recall on a labelled corpus.
- **Skills** — one `Ltm` memory skill (merges ContinuousLearning, session-context, Learned) with reference files; new `MemoryReview` curation skill; `/openltm:server` command replaces the LtmServer skill; trigger evals under `evals/`.

### Changed
- **Hook lifecycle.** `Stop` fires after every turn, so it now only upserts one progress row per session; session evaluation moved to `SessionEnd`. SessionStart is source-aware (startup/resume/clear/compact), no longer runs `git fetch` or edits `known_marketplaces.json`, onboards with an absolute bun path, keeps summary headers when trimming, injects globals for new projects, and announces pending proposals. All hooks have explicit timeouts. Dev installs are wired the same way.
- **One project identity across hosts.** Claude Code, Pi, OpenCode and OpenClaw resolve names the same way (registry → git repo root → folder name). A host's previous name is kept while it is the only one holding data, so nothing is orphaned.
- **OpenLTM state moved out of `~/.claude/projects`** (Claude Code's transcript directory) to `<dataDir>/projects/`; config read order `LTM_CONFIG_PATH` → `<dataDir>/config.json` → legacy `~/.claude/config.json`. Legacy files are copied on first use and never modified.
- Session pattern logs moved from the plugin install dir to `${CLAUDE_PLUGIN_DATA}/learned/`.
- Agent `planner` → `ltm-planner`: valid Claude Code `tools:` list, reads LTM itself (read-only), narrower trigger.
- Tests run with an isolated `HOME`/`CLAUDE_CONFIG_DIR` and fail if the real `~/.claude` changes (#38).

### Fixed
- **Progress history wiped by one long session** — 20 turns replaced every earlier session's progress row.
- **Memories differing by a marker, number, or negation were merged** — "plan A"/"plan B", "retry 3"/"5" (#36's Jaccard tier) and "do not run X"/"do run X" (older containment rule) now stay separate.
- `git-learner` passed fields `learn` doesn't accept, so mined memories were stored as global.
- New projects were registered under the subfolder name the session started in.
- The bundled git hook ran core CLI entry points on every commit (printed `Usage: bun embeddings.ts …`).
- Graph server ignored SIGTERM.
- Janitor dedup queried a column removed in migration 010 and never produced suggestions; embedding counts and llama.cpp vector alignment (#27).

### Fixed after end-to-end verification
Found by running the plugin in a real Claude Code session, the smoke scripts above, and a review of the whole release.
- **SessionStart injected no memories when an embeddings provider was up** (it read vectors from a column dropped in migration 010) and its index showed no titles.
- **Prompt recall** skipped memories SessionStart had only indexed, and its matching was retuned: light stemming, IDF weighting, generic words ("add", "test", "fix") count half, one distinctive word suffices, weak partial matches are dropped. On a labelled corpus of 71 prompts (17 held out), precision went from 85.5% to 95.2% and recall from 67.3% to 94.5%.
- **recall()** took its full-text and semantic top-N before applying the project/status/privacy filters, so a busy project could crowd out the current one's memories.
- MCP `learn` with `files` and no `project` stored an anchored memory as global; it now uses the current project. Log notifications were rejected (missing `logging` capability).
- Commits run as `git -c k=v commit` or `git -C dir commit` were not detected by the PostToolUse hook.
- Accepted proposals lost their session's project.
- Near-dedup merged antonym pairs (sync/async, read/write, enable/disable, …).
- `bunx @rohirik/openltm-core --claude` wrote MCP and hook config that Claude Code ignores (0 hooks, no server); it now writes `~/.claude.json` and the current hook format. The portable SessionStart crashed on a brand-new DB.
- `bun install` in any checkout wired global hooks and could set `core.hooksPath`; dev wiring is now opt-in (`LTM_WIRE_HOOKS=1`), and the git hook only with `ltm.gitLearnEnabled`.
- Pi looked for the plugin cache under an old path, sorted versions as strings, and kept its own DB; it now shares Claude Code's DB, saves progress on compaction through the bridge, and its dead `hooks.ts`/`tools.ts` are gone. OpenCode resolves the project from its path while keeping memories stored under the old name.
- Janitor: graph-server, its interval and the scheduler now take the cross-process lock. Generated systemd units failed to load when the DB path contained a space. Scheduled units ignored `ltm.janitor.intervalMinutes`.
- Folder names in non-Latin scripts normalized to an empty name, splitting one repository into a different project per host.
- SessionStart listed every project's staged conflicts; identical permanent decisions/gotchas were stored repeatedly.
- `hooks/GitCommit.bundle.mjs` rebuilt. Eight graph-app e2e tests still targeted the pre-2.8 UI and failed on `main` too; they now test the current shell.

### Fixed after the release verification (round 2)
The first independent verification rejected the candidate; these are its findings plus what the follow-up live acceptance run found.
- **Tests could write the real user's config.** An inherited `XDG_CONFIG_HOME` let installer tests read and rewrite the real OpenCode `opencode.json`, and the Pi tests ran the real `pi install` from PATH. Installers now only honour `XDG_CONFIG_HOME` for the process's own home, never run the Pi on PATH for another home, and bound Pi calls with timeouts. The test harness points every XDG dir into the temp home, and its drift guard also watches the real OpenCode config and `~/.pi`.
- **Hooks and the MCP server could use two databases.** The manifest pinned the MCP server's `LTM_DB_PATH`, so an exported `LTM_DB_PATH` only reached the hooks. It also used a self-referential `CLAUDE_PLUGIN_DATA` entry that Claude Code passes unexpanded, which created `<project>/${CLAUDE_PLUGIN_DATA}/openltm.db`. Both now resolve `LTM_DB_PATH` → `$CLAUDE_PLUGIN_DATA/openltm.db`, and an unexpanded placeholder is never used as a path.
- **OpenLTM hooks left in `~/.claude/settings.json`** by a git-clone or bunx install fire next to the plugin's. SessionStart now warns about them, `/openltm:health` lists them, and `scripts/unwire-legacy-hooks.ts` removes only those entries after backing up the file.
- **Graph UI edit and delete did nothing.** The GET route for a memory answered PUT and DELETE too (also on `main`). UI edits now go through the secret scrubber.
- **Stale flags:** `git commit --amend` re-flagged an already-stale memory; a memory is now flagged once until revalidated.
- **Janitor** with embeddings `disabled` logged an error and exited 2 on every run; it now skips the embed step.
- **Session proposals** no longer include routine git output ("nothing to commit").
- **`/openltm:server stop`** left the UI running while reporting its port free; it now stops the UI by PID and reports only what it verified.

### Fixed after the release verification (round 3)
- **`context` didn't return what `context_add` stored.** It returned only memories, so a decision recorded with `context_add` was saved but missing from `context`. `context` now returns the project's `goal`, `decisions`, `gotchas` and the last 5 `progress` entries (secret-scrubbed), next to `globals` and `scoped`. `learn` now returns the `project_scope` it stored the memory under.
- **Graph UI lists went stale after an inspector edit or delete.** On the project and memory-table pages, a deleted memory stayed listed, and an edit kept its old text, until a manual reload. Both pages now refetch.
- **Diagnostics:** `scripts/mcp-probe.ts` starts the MCP server the way Claude Code does and says why it would show as failed. The new `qa/continuity-smoke.ts` checks the default database end to end: an MCP `learn` reaches the next SessionStart under an alternate `CLAUDE_CONFIG_DIR`, with exactly one database. The Ltm skill now says when a `learn` is global and which memories the SessionStart index lists.

### Fixed after the release verification (round 4)
- **Security CI:** patched the three dependency findings.
  - `@modelcontextprotocol/sdk` now requires ≥ 1.31.0 (1.32.1 locked) in the root and in `openltm-core`.
  - `proxy-addr` 2.0.8 via override.
  - `source-map-js` 1.2.2 in the graph app.
- **The plugin's data dir is `openltm-OpenLtm`.** Claude Code names an installed plugin's data dir `<plugin>-<marketplace>`; OpenLTM assumed `OpenLtm-openltm`. So the Pi adapter opened a separate database instead of Claude Code's, and fallbacks wrote logs and proposals where nothing read them. All of them now use the dir Claude Code uses; a database under the old name is still found. The bunx installer shares the plugin's database.
- **`/openltm:health`** read an empty in-memory database ("no such table: settings") and the wrong log dir, because the model's shell has no `CLAUDE_PLUGIN_DATA`. Commands now use the path Claude Code substitutes into them.
- **`/openltm:admin scan --dry-run` wrote changes.** The flag was never read. The scan also imported a file that had moved, and opened no real database. All three are fixed.
- **Session proposals** no longer include failures of read-only probes (`ls`, `lsof`, `curl`…) or one-off scripts (`bun --eval`, `sqlite3`…), and drop the `Exit code N` prefix.

### Fixed before release
After the round-4 approval.
- **`/openltm:health` never counted learns or recalls.** Nothing emitted the events behind its "Memories learned" and "Recall hits" rows. MCP `learn` and `recall`, prompt recall and commit stale flags now log to `ltm.jsonl`, and health shows all four.
- **OpenCode, OpenClaw, the `ltm` CLI and a standalone `mcp-serve` now share Claude Code's database by default.** Without `LTM_DB_PATH`, they used a database inside the core package. Now they use the Claude Code plugin's database when it exists. A database they already created stays in use, so nobody's memories move.

### Removed
- Skills `ContinuousLearning`, `session-context`, `Learned`, `LtmServer`; committed session logs; `r2-split-harness/`, `scripts/tmp_*`, `verify_split*.ts`.

## [2.16.2] — 2026-10-04

### Fixed
- Fixed Pi package-gallery discovery by adding required pi-package npm keyword; Hermes native plugin manifest synchronized 2.16.2 for catalog re-pin.

## [2.16.1] — 2026-10-04

### Fixed
- **ClawHub secretless publishing trigger** — the ClawHub job now runs only on `workflow_dispatch`, which ClawHub accepts for GitHub OIDC trusted publishing. Version-tag pushes still publish npm packages; dispatch `publish.yml` at the release tag afterward to publish ClawHub without a stored token or manual authentication override.
- **ClawHub artifact recovery** — supersedes the malformed ClawHub-only 2.16.0 upload, which omitted `dist/index.js` and retained `workspace:*`. The publishing script builds the adapter and resolves its dependency before upload. npm's valid 2.16.0 packages are unaffected.

## [2.16.0] — 2026-10-04

### Changed
- **Local embeddings by default** — unset `LTM_EMBED_PROVIDER` now resolves to llama.cpp (`llama-server` OpenAI `/v1/embeddings`, model `bge-m3`) instead of Gemini. A down server stays on FTS5; Gemini, OpenAI, and Ollama remain opt-in. Recall ignores vectors stamped for another model or dim, and backfill re-embeds them.

### Added
- `LlamaCppProvider` and janitor `llamacpp` adapter. `LTM_LLAMA_CPP_URL`, `LTM_EMBED_MODEL`.
- `.github/CODEOWNERS` — `* @RohiRIK`, so with "Require review from Code Owners" on `main` every outside PR needs the owner's approval.

### Fixed
- **Pi plugin registered nothing for users without Claude Code** — the Pi adapter had the same `@rohirik/openltm-core/package.json` lookup. Pi first tries the Claude Code plugin cache, so Claude Code users were unaffected; a Pi-only user fell through to the broken lookup and got zero tools and no Prior Knowledge, silently. Both adapters now share the same lookup in `src/find-core.ts`.
- **Core now exports `./package.json`** — so adapters already published (2.15.1, which depend on `^2.15.1`) start working as soon as this core is installed, without an adapter update. Verified with the published Pi 2.15.1 bundle against the new core.
- **Adapters are now tested under Node** — `src/__tests__/adapters-under-node.test.ts` bundles each adapter's core lookup and runs it with `node` against a core whose `exports` hide `package.json`, as 2.15.1's did. With the old lookup put back, it fails.
- **Hooks broke when the plugin path contained a space** — `hooks.json` ran `${CLAUDE_PLUGIN_ROOT}/hooks/bin/run-hook.sh ${CLAUDE_PLUGIN_ROOT}/…` unquoted, so a path such as `/Users/Jane Doe/…` split into several words and every hook failed with "not found" (exit 127). Both placeholders are now quoted.
- **Hooks died on common shell profiles** — when bun is not in a well-known location, `run-hook.sh` sources the user's `.zprofile`/`.bash_profile`/`.profile`, but did so under `set -u`, so any profile that reads an unset variable aborted the hook ("parameter not set"), and anything a profile printed leaked into the hook's stdout (for SessionStart, into the session). Profiles are now sourced with `set +u` and their output discarded.


## [2.15.2] — 2026-10-03

### Added
- **ClawHub publishing script** — `scripts/clawhub-publish-if-needed.sh`, meant to run as a `clawhub` job after npm (the job itself must be added to `publish.yml` by hand and was not in the 2.15.2 release; see `docs/11-publishing.md`). It publishes `@rohirik/openclaw-ltm` to ClawHub through GitHub OIDC trusted publishing (no stored token). `scripts/clawhub-publish-if-needed.sh` does what `prepack`/`postpack` do for npm, since ClawHub does not run lifecycle scripts: it builds `dist/`, resolves `workspace:*`, publishes with explicit source coordinates, waits for the security scan, and restores `package.json`. A version already on ClawHub (or registered by an earlier attempt that errored) is skipped, so the job can be re-run safely.

### Fixed
- **OpenClaw plugin could not reach its memory engine on a real host** — the adapter resolved `@rohirik/openltm-core/package.json`, which core's `exports` map does not list. Bun (the test runner) allows that; Node, which OpenClaw runs on, throws `ERR_PACKAGE_PATH_NOT_EXPORTED`, so on every OpenClaw install all eight tools answered "memory engine unavailable". The adapter now resolves core's main entry and walks up to the package root. Found by installing 2.15.1 into OpenClaw 2026.9.8.
- **First calls on a brand-new database failed** — `mcp-serve` started answering before schema migrations finished, so a first-time user (OpenClaw or Pi with no Claude Code install) got `no such column: decay_score`. `startMcpServer` now awaits `waitForInit()` before connecting. The OpenClaw tests no longer pre-migrate their database, so this is covered.
- **OpenClaw recall hid failures** — with the engine unavailable, `openltm_recall` returned "No memories found."; every tool now reports the actual error.
- **OpenClaw Prior Knowledge block was never injected** — the prompt supplement returned an empty list unconditionally. It now uses the host's async `registerMemoryPromptPreparation` (awaited before each prompt) and falls back to a cached synchronous supplement on older hosts, honouring `autoRecall` and `prefillLines`.
- **`openltm_context` (OpenClaw) returned a bare string** instead of a tool result.

### Docs
- **OpenClaw install flags** — OpenClaw 2026.9.8 requires `--accept-capabilities` for this plugin, and `--force` for any npm (non-ClawHub) install; every install snippet now includes them.
- **Distribution status brought up to date** — the README has a "Where to get it" table listing every channel with links (Claude Code marketplace, the four npm packages, ClawHub, the Hermes Plugin Catalog) plus install snippets for Hermes and OpenClaw; `docs/11-publishing.md` opens with an at-a-glance status table and records the Hermes catalog listing (merged 2026-10-02, pinned to 2.15.1) instead of "needs a PR"; installation, quickstart, CONTRIBUTING, CLAUDE.md and AGENTS.md describe the ClawHub job and the Hermes re-pin step.
- **Hermes docs use the plugin's current name** — install dir and `memory.provider` are `openltm` (renamed in #15), not `openltm_hermes`; the plugin README that the catalog page renders now has the install step and all eight tools.

## [2.15.1] — 2026-09-27

### Fixed
- **ClawHub publish procedure** — ClawHub copies the `files` allowlist without running npm lifecycle scripts, so a released artifact kept `workspace:*` and omitted the README; the docs now record the resolve → publish → restore sequence, the explicit source coordinates ClawHub mis-infers otherwise, the two-phase scan behaviour, and how a first-publish server OOM can still register a version.
- **ClawHub publish artifact** — the first ClawHub release was built from a git source whose `package.json` still carried `workspace:*`, and its `files` allowlist predated the OpenClaw README, so `openclaw plugins install clawhub:@rohirik/openclaw-ltm` would have failed to resolve `@rohirik/openltm-core`. ClawHub publishes from a folder, so the release now resolves the workspace dependency before upload, links the correct `main` commit, and ships the README.

## [2.15.0] — 2026-09-27

### Added
- **OpenClaw plugin package** — `packages/adapter-openclaw` registers OpenLTM's eight memory tools with an OpenClaw host and injects a Prior Knowledge block each turn via `registerMemoryPromptSupplement`. It shares the same SQLite database as the Claude Code, OpenCode, and Pi plugins, and ships `openclaw.plugin.json` (categories `["memory"]`, `contracts.tools`, `toolMetadata`, `configSchema`). Published as `@rohirik/openclaw-ltm` on tag, pinned to `openclaw >= 2026.9.6` through an optional peer dependency.
- **OpenClaw manifest checker** — `bun run check:openclaw` validates the manifest against OpenClaw's real loader rules: `configSchema` is required, 1–3 categories from the published taxonomy, the `kind` enum, `uiHints`/`configGroups` cross-referenced against the schema, every `contracts.tools` entry actually registered (and nothing registered undeclared), write tools flagged `sideEffecting`, and `compat`/`minHostVersion`/peer ranges agreeing. Wired into `check:monthly`.
- **OpenClaw adapter tests** — 10 tests drive the plugin's `register()` against a fake host API, covering tool registration, manifest/registration agreement, learn↔recall round-trip, unknown-category rejection, error surfacing, stale listing, and the auto-recall toggle.

### Fixed
- **Adapter tarballs were only publishable from CI.** `workspace:*` was rewritten by a `sed` step inside the release workflow, so `npm pack` anywhere else produced a tarball that failed to install with `EUNSUPPORTEDPROTOCOL`. All three adapters now resolve workspace deps in `prepack` and restore in `postpack`, so a tarball is always correct and the working tree stays clean.
- **Adapter tarballs could ship a stale bundle.** `npm pack` does not run `prepublishOnly`, so a local pack shipped whatever `dist/` happened to be on disk. `prepack` now builds before packing, which also let the duplicated CI build steps be removed.

### Added
- **Published-version drift check** — `bun run check:published` compares every workspace package's npm version against the repo, and fails when npm holds a version the repo does not contain. Motivation: `v2.15.0` shipped `@rohirik/openclaw-ltm` without `publishConfig.access`, which only surfaced when publishing by hand well after the tag. It runs in `check:monthly` as an advisory step; `--strict` also fails on ordinary pre-release lag.

### Docs
- **New: `docs/12-comparison.md`** — a comparison of OpenLTM against Mem0, Letta, Graphiti/Zep, LangMem, Cognee, and the reference MCP memory server, answering issue #10. Compares them on memory shape, write path, retrieval, forgetting, staleness detection, and auditability, and breaks "self-improvement" into four distinct mechanisms (LLM-as-writer, agent self-edit, structure-first enrichment, signal-driven) with an explicit trade-off table. Includes an honest section on what OpenLTM deliberately does not do. Comparators verified against their own repositories on 2026-09-27.
- `docs/11-publishing.md` updated with the OpenClaw integration: the target version, the verified SDK resolution route, the plugin shape chosen, the exclusivity tradeoff, and the host-verification result.

### Added
- **Brand artwork for plugin and plugin-catalog listings** — `assets/icon.png` (512×512) and `assets/catalog-banner.png` (1200×600, 2:1) generated by `scripts/generate-brand-assets.py`. Both follow the README hero's visual language: a deep-indigo ground, a glowing memory constellation, and nodes running amber → violet → magenta left to right. The icon ships through the OpenClaw package `files` allowlist so ClawHub shows real artwork instead of the generic memory glyph; the banner backs the Hermes catalog entry's `image` field.

### Verified
- **The OpenClaw plugin passes the ClawHub plugin inspector with zero findings** — `clawhub package validate` reports `PASS`, 0 breakages, 0 warnings; `clawhub package publish --dry-run` resolves the package as `@rohirik/openclaw-ltm` 2.15.0, auto-detects the source commit, reads the compat ranges, and lists 6 files (122 KB) including the icon. Only `clawhub login` remains, which is a human account action.
- **The OpenClaw plugin loads in a real host.** Installed into `openclaw@2026.9.6` (Node 26.8.1) via `openclaw plugins install`; `openclaw plugins list --json` reports `openltm | status: loaded | version: 2.15.0`. Loading forced a design correction: OpenClaw runs on Node and `@rohirik/openltm-core` imports `bun:sqlite`, so a static import failed with `ERR_UNSUPPORTED_ESM_URL_SCHEME`. The adapter now never imports core and instead spawns the core MCP server as a Bun child over stdio JSON-RPC, mirroring the Pi adapter.

## [2.14.3] — 2026-09-27

### Added
- **Hermes Plugin Catalog submission package** — `hermes/plugin-catalog/openltm.yaml`, modelled on the closest existing catalog entry (a native Python memory provider), declaring all 8 `openltm_*` tools and the 7 hooks the provider actually implements. `hermes/plugin-catalog/README.md` documents the submission steps and the requirements checklist.
- **Catalog tooling** — `bun run catalog:check` validates the entry (schema fields, 40-hex SHA, SHA reachability and ancestry, `subdir` contents, version match) and cross-checks every declared tool and hook against the plugin source, so a renamed tool fails locally instead of in a maintainer's review queue. `bun run catalog:sync` repoints the SHA and version; `bun run catalog:drift` fails when the pin is stale. Wired into `check:monthly`.
- **Packaging regression tests** — `packages/openltm-core/src/__tests__/packaging.test.ts` asserts the package-local migration copy is complete and byte-identical to the repo root, that the packaged path is preferred, and that the manifest does not exclude migrations. This is the class of bug that only appears after publish.
- **External distribution guide** — `docs/11-publishing.md` records the state of every external channel (npm, Claude marketplace, Hermes catalog, OpenClaw) and the remaining work for each.

### Docs
- `docs/11-publishing.md` added to the documentation index.

### Fixed
- **Published npm package shipped without its migrations** — `migrations/` lived only at the repo root, so a published `@rohirik/openltm-core` tarball resolved `node_modules/migrations`, found zero migration files, and produced a column-incomplete database. A fresh `bunx @rohirik/openltm-core memory learn` failed with `no such column: decay_score` (and `workspace_id` on the context path). `migrations/` is now vendored into the package and `getMigrationsDir()` prefers the package-local copy, falling back to the monorepo root only in development. Verified by installing the packed tarball and running learn/recall/context end to end, and re-verified against the live registry at 2.14.2.
- **Hermes plugin version drift** — `hermes/openltm_hermes/plugin.yaml` was pinned at `1.0.0` and was not covered by any version check. It is now a tracked version reference, so the release tooling bumps and verifies it.

## [2.14.0] — 2026-09-27

### Added
- **Hermes auto-capture rule engine** — new `hermes/openltm_hermes/auto_capture.py` owns every automatic-capture decision: one ordered declarative rule table, named guards (`is_transient_operational`, `is_read_only_memory_request`), and one shared distiller. Two entry points, `evaluate_turn()` and `evaluate_session()`, return decisions and never touch the database.
- **Testable extraction policy** — `hermes/openltm_hermes/test_auto_capture.py` (33 tests) runs on stdlib `unittest` with no third-party package and no Hermes runtime, so capture rules are verifiable anywhere. Wired into `bun run check:monthly` as `hermes-unittest`.
- **Shared version registry** — `scripts/version-targets.ts` is now the single source of truth for version-bearing files, imported by both `bump-version.ts` and `verify-version-sync.ts` so the two cannot cover different sets again.

### Changed
- **One-step version bumps** — `bun run bump` now accepts `patch` / `minor` / `major` in addition to an explicit version, and rewrites all 9 version references across 8 files. Previously it touched 3 files and pointed at a path (`docs/ARCHITECTURE.md`) that no longer existed.
- **Maintenance summary** — `check:monthly` reports a PASS/FAIL/SKIP summary; optional tools are always reported as skipped, never as passed.

### Fixed
- **Constraint misclassification (Hermes)** — "Always use Bun, never npm" contains "use ", so it was being filed as a soft preference (importance 3) rather than a constraint (importance 4). Constraints are now evaluated before preferences.
- **Corrupted read-only guard regex** — a quantifier inside an f-string (`{0,2}`) was evaluated as a format expression, silently producing a broken pattern so one class of read-only request stopped being recognised. Braces are now escaped, and the previously hard-coded "the OpenLTM tool that reports memory statistics" sentence is a general pattern.
- **Hermes session-end quality** — `on_session_end` stored raw truncated message text while `sync_turn` stored distilled facts. Both now use the same distiller, and session end picks up the full user rule set instead of a reduced copy.

## [2.13.0] — 2026-09-27

### Added
- **Recall v2 ranking** — `recall()` now scores candidates on decay, importance, exact project scope, and recall frequency, with a documented stale penalty and progressive near-duplicate demotion. Ties break deterministically on ascending id. Explicit `sort_by` requests are still honoured verbatim.
- **Prefill v2** — session prefill applies per-category quotas, prioritises project-scoped memories over globals, and suppresses near-duplicate entries. Selection is deterministic and hard-capped by the shared host budget.
- **`PREFILL_DEFAULTS`** — one exported budget (`maxMemories: 10`, `maxLines: 18`) now used by the Claude bunx hook, the OpenCode plugin, and the Pi extension, so the injected block cannot drift between hosts.
- **Hygiene checks** — new `isOperationalNoise()` and `isNearDuplicate()` helpers, plus a `check:monthly --json` mode for machine-readable maintenance summaries.

### Changed
- **Installer target registry** — `openltm-core` now drives host installation from a shared `INSTALL_TARGETS` registry, reducing the work to add future agent hosts.
- **Shared session prefill** — OpenCode, Pi hooks, and the portable Claude bunx hook path now use one core prefill builder, making the "already pre-filled" experience more consistent and honoring a tighter context budget.
- **Portable Claude bunx hook** — `bunx @rohirik/openltm-core hook --name SessionStart` now emits a real Prior Knowledge block instead of only printing a stub warning; non-session-start hooks remain safe no-ops.
- **Monthly maintenance command** — `bun run check:monthly` runs tests, typecheck, version sync, dependency audit, and optional local security scanners, then prints a pass/fail/skip summary; optional tools are reported as skipped, never as passed.
- **Test scope hardening** — root `bun test` targets the explicit test directories so temporary scripts and Playwright e2e specs are never executed as accidental Bun tests.

### Fixed
- **Dependency audit floor** — bumped MCP SDK ranges and tightened root overrides for `hono`, `@hono/node-server`, `body-parser`, and `qs`; `bun audit` reports no vulnerabilities.
- **Hook bundle freshness** — regenerated `hooks/GitCommit.bundle.mjs` so the bundle-drift workflow passes on tagged releases.
- **Learn hygiene** — operational noise is stored at reduced importance, and an elaboration of an existing memory reinforces it instead of creating a near-duplicate row. The match rule is deliberately conservative (full token containment) so deliberate parallel memories are never silently merged.

## [2.12.3] — 2026-09-27

### Fixed
- **Hook bundle freshness** — regenerated `hooks/GitCommit.bundle.mjs` so the `Verify hook bundle freshness` workflow passes on tagged releases.

## [2.12.2] — 2026-09-27

### Changed
- **Installer target registry** — `openltm-core` now drives host installation from a shared `INSTALL_TARGETS` registry, reducing the work to add future agent hosts.
- **Shared session prefill** — OpenCode, Pi hooks, and the portable Claude bunx hook path now use one core prefill builder, making the "already pre-filled" experience more consistent and honoring a tighter context budget.
- **Portable Claude bunx hook** — `bunx @rohirik/openltm-core hook --name SessionStart` now emits a real Prior Knowledge block instead of only printing a stub warning; non-session-start hooks remain safe no-ops.
- **Monthly maintenance command** — added `bun run check:monthly` to run tests, typecheck, version sync, dependency audit, and optional local security scanners in one pass.
- **Test scope hardening** — root `bun test` now targets the explicit test directories so temporary scripts and Playwright e2e specs do not get executed as accidental Bun tests.

### Fixed
- **Dependency audit floor** — bumped MCP SDK ranges and tightened root overrides for `hono`, `@hono/node-server`, `body-parser`, and `qs` to clear the current moderate/low audit findings from the monthly maintenance path.

## [2.12.1] — 2026-09-23

### Fixed
- **Hermes auto-capture provenance** — one-turn requests to invoke read-only OpenLTM tools are no longer persisted by `sync_turn` or `on_session_end`; durable user constraints remain eligible for automatic learning.
- **Hermes provider setup docs** — corrected the provider identifier to `openltm_hermes`.

## [2.12.0] — 2026-08-08

### Added
- **Hermes memory provider plugin consolidated into this repo** (`hermes/openltm_hermes/`) — the one-repo strategy: plugin, canonical `schema.sql`, and extraction logic now live under OpenLtm; `hermes-brain` repo retired. Install contract for any Hermes install: `hermes plugins install RohiRIK/OpenLtm/hermes/openltm_hermes` (or symlink for a live repo-sourced wiring).
- **R2 migration runner v2** — fail-closed DDL gate; Option-B split of 015/017 into idempotent parts + new migrations 024 (`title_backfill`) and 025 (`idx_memories_hidden`).

### Fixed
- **Migration runner edge cases** — `decay_score`, `created_by`, `workspace_id`, `agent_id` columns (migrations 007/011/013) now guaranteed present on fresh installs so `learn()` and the janitor never crash on a column-terminal schema.
- **CI: Trivy Security Scan HIGH CVEs** — bumped `fast-uri`, `nanoid`, `next` deps (5 HIGH → 0); Trivy 0/0 on both lockfiles.
- **CI: Build hook bundle protected-main auto-push** — replaced with a drift-gate workflow (`contents:read` only) that verifies `hooks/GitCommit.bundle.mjs` freshness instead of pushing to `main`.

## [2.11.0] — 2026-06-10

### Added
- **`ltm memory` CLI subcommands** — `bunx @rohirik/openltm-core memory learn|recall|forget|relate|context` gives headless/CLI agents (OpenCode CLI, scripts, cron, CI) a direct shell path to LTM without the agent TUI, slash commands, or a running MCP server. `--json` for machine-readable output; DB resolves via `LTM_DB_PATH`; writes route through the same `scrubSecrets` path as the MCP server. Exit codes: 0 ok, 1 usage, 2 runtime.
- **Runnable `mcp-serve`** — the full MCP server (tools, resources, prompts) moved into `@rohirik/openltm-core/mcp` (`buildMcpServer`/`startMcpServer` factory with injectable host-config hooks), so `bunx @rohirik/openltm-core mcp-serve` now starts the real stdio server on any machine instead of printing a "not yet implemented" stub. The Claude Code plugin's `src/mcp-server.ts` is now a thin wrapper — manifest path unchanged.

### Fixed
- **Unknown CLI sub-commands no longer launch the install wizard** — `ltm <typo> ...` previously fell through to the installer; it now prints help and exits 1.

### Docs
- README "CLI access for headless agents" section; troubleshooting guide for writing memories from a plain shell (slash commands are TUI-only) with an OpenCode plugin-load checklist.

## [2.10.0] — 2026-06-10

### Added
- **Code-anchored memory invalidation** — memories can be anchored to the files they reference (`learn`'s optional `files` param → new `memory_files` table, migration 023). The git post-commit hook flags anchored memories **stale** when a commit touches those files (config `gitInvalidateEnabled`, default `true`; `importance: 5` exempt). This catches the high-traffic-but-stale memory that recency-decay and `forget` can't see — invalidation driven by *code change*, not recall behaviour.
- **Stale-aware recall + decay** — `recall` returns a `stale` flag and downranks stale memories (still returned); `decayMemories` deprecates flagged memories regardless of recall frequency. Nothing is deleted on invalidation — the flag is auditable.
- **`revalidate` MCP tool** — clear a stale flag after review when the code changed but the memory is still correct. Re-confirming a memory via `learn` also clears it; `forget` remains for truly-wrong memories.

### Fixed
- **`bunx @rohirik/openltm-core` "Script not found"** — the package's only `bin` was named `ltm`, but bunx resolves a bin by the package basename. Added `openltm-core` and `openltm` bin aliases (keeping `ltm`), fixing the documented OpenCode install path.

## [2.9.1] — 2026-06-09

### Fixed
- **Honker handle now actually opens** — v2.9.0 reported `caps.honker = true` but `getHonker()` silently returned `null`, leaving the queue/cron/pub-sub features dormant. Root cause: both the plugin and `honker-bun`'s `open()` called the once-per-process `Database.setCustomSQLite()`, so honker-bun threw "SQLite already loaded". The plugin now neutralises further calls after loading the custom SQLite, so honker-bun reuses the already-active extension-enabled SQLite. Verified end-to-end (enqueue → claim → ack, pub-sub notify, scheduler register).

## [2.9.0] — 2026-06-08

### Added
- **Honker durable queue / scheduler / pub-sub** — async embedding queue (claim/embed/ack, retry, dead-letter), leader-elected janitor cron (@every 6h), and pub-sub push liveness for the graph app via vendored \`libhonker_ext.dylib\` (darwin-arm64). Other platforms degrade to inline embed, file-watch poll, and in-process janitor.
- **SQLite extension capability layer** — \`Database.setCustomSQLite()\` switches Bun's bundled SQLite to a system extension-enabled libsqlite3 before the first DB opens; then \`loadExtension()\` loads sqlite-vec and honker per-connection. Degrades gracefully — missing binary/lib leaves the capability \`false\` and falls back to pure-JS / FTS paths. Never throws.
- **sqlite-vec (vec0 / KNN) semantic recall** — powers the semantic fallback in recall with real vector KNN search when available; falls back to JS-cosine when not.
- **Env vars for extension control** — \`LTM_DISABLE_VEC\`, \`LTM_DISABLE_HONKER\` (force-disable), \`LTM_HONKER_EXT\` (override honker binary path), \`LTM_SQLITE_LIB\` (override system libsqlite3 path).
- **\`ltm.crossProcessSync\` setting** — opt-in setting (default \`false\`) to enable cross-agent memory notify via honker pub-sub.

## [2.8.1] — 2026-06-08

### Fixed
- **OpenCode installer now ships its customization** — the agents/skills/plugins are bundled in `packages/openltm-core/assets/opencode/` so they actually deploy on published/`bunx` installs (previously read from the gitignored repo `.opencode/`, a silent no-op). Components co-locate with the resolved config dir.
- **`openltm-core` npm `bin`** — dropped the leading `./` so npm 11 stops stripping it; `bunx @rohirik/openltm-core` is executable again.

### Changed
- **npm publishing moved to OIDC trusted publishing** — the Publish workflow authenticates to npm via GitHub OIDC instead of a long-lived `NPM_TOKEN`, and restores build provenance. No publish secret is stored.

## [2.8.0] — 2026-06-08

### Changed
- **Open source under MIT.** OpenLTM is now a public, MIT-licensed project. No cloud, no account, no telemetry — the memory database stays local and owned by the user.
- **Renamed to OpenLTM.** The brand and identifiers moved from the private `claude-ltm-plugin` to the open `openltm`:
  - Plugin name `claude-ltm-plugin` → `openltm`; marketplace → `OpenLtm` (`RohiRIK/OpenLtm`).
  - MCP tool prefix `mcp__plugin_ltm_memory__*` → `mcp__plugin_openltm_memory__*`.
  - Core npm package `@rohirik/ltm-core` → `@rohirik/openltm-core`.
  - Plugin data directory `ltm-ltm/` → `OpenLtm-openltm/`; database file → `openltm.db`.
  - Slash commands `/ltm:*` → `/openltm:*`.
  - The concept word "LTM" is unchanged. Existing memory databases migrate automatically.

### Added
- **README open-source announcement + banner** — landing page rewritten for the public launch with a new OpenLTM hero banner.
- **`Spec` skill and `planner` agent** — spec-driven definition and planning skills, wired to the LTM contract.
- **Documentation overhaul** — `docs/` reorganized into a numbered, user-facing set (`00-quickstart` … `09-troubleshooting`); product and design specs moved to `docs/internal/`. New guides: Quickstart, Installation, Troubleshooting, and a root `CONTRIBUTING.md`.

### Removed
- Obsolete migration docs (`docs/migration.md` and the root `MIGRATION.md`) covering the deprecated git-clone setup; the marketplace install path migrates existing databases automatically.

## [2.7.0] — 2026-06-05

### Added
- **Project layer 3-pane shell** — new routes under `/projects/...`: overview, memories, timeline, connections, health, settings. Each project gets a 56px icon sub-nav (acid-lime active bar), main pane, and an optional 320px inspector. "All projects (global)" is a first-class switcher entry.
- **5-section Settings split** — `/settings` now has a left-rail nav with System (providers + storage), Behavior (reasoning + decay + inbox 30d), Health (Memory Keeper + Recover), Advanced (System Explorer, collapsed by default), and About (version + license + feedback).
- **Recover drawer** — slide-in tray from the right at `Settings → Health`, surface for soft-deleted memories (UI shell; the real soft-delete pipeline lands in v2.8.0).
- **`/api/health/history?project=X`** — synthetic 30-point series (deterministic per-day drift seeded by project name). Lets the Health page render a 30-day sparkline; a real `health_history` table is scheduled for v2.8.0.
- **Inspector right-click menu** — right-click anywhere in the inspector reveals: Open in project (navigates to `/projects/:name/memories`), Mark permanent (v2.8), Find conflicts (v2.8). v2.8 items are labelled.
- **Decision "Why?" tooltip** — decision context nodes get a small "Why?" button in the category banner. Click reveals the decision's content + source session id + a hint to use Recall.
- **⌘K search history** — SpotlightModal now shows the last 10 queries from `localStorage` (`ltm.searchHistory`, deduped) when the query is empty. Submitting a search pushes to history.
- **`--accent-blue` and `--accent-lime-foreground` tokens** — added to all 6 themes. Mercury blue is rationed to one primary CTA per Settings section; acid lime stays rationed to the 2 use-sites from v2.5.0.
- **Animated Status Badge** (isaiahbjork, 21st.dev) — used in `Settings → Health` for the Janitor running state.
- **Auto-allow the LTM MCP server on install** — `scripts/install-wiring.ts` adds `mcp__plugin_openltm_memory` to `permissions.allow` in `~/.claude/settings.json` idempotently (dev and marketplace installs). The plugin's MCP tools (`recall`, `learn`, `forget`, `relate`, `context`, `context_items`, `graph`) no longer prompt on every call; the action is logged, not silent.

### Changed
- **Component refactors** — `ProjectTableView`, `ProjectBoardView`, `ProjectTimeline`, `ProjectConnections`, `ProjectRelevance`, `StaleMemoryAlert` rewritten to the redesign spec:
  - Table: 32px rows, hairline borders, sticky header, 2-button row action menu on hover.
  - Board: inline edit (double-click content → textarea, ⌘+Enter saves, Esc cancels).
  - Timeline: Status Indicators Timeline pattern (color-coded pills on vertical rail, day-grouped, 4 ranges).
  - Connections: map-first with 6 relation filter chips, floating legend, "Why this exists" banner.
  - Relevance: 32px Cursor-style thumbs colored with `nodeColor(category)`.
  - StaleMemoryAlert: project-scoped, 3-action row (Confirm/Edit/Forget) revealed on hover.
- **`/project/[name]` → `/projects/[name]`** — `/project/[name]` is now a 5-line server redirect. Kept for backward compatibility through v2.7.x; removed at v2.8.0 per redesign spec §8 Q5.
- **`/` → `/projects`** — the home page is now `/projects`; the old `/` 307-redirects there.
- **`AppShell` wraps in `ProjectProvider`** — the TopNav `ProjectSwitcher` is now project-aware on every route.
- **GitLearn runs key-free via a Haiku subagent** — `skills/GitLearn/SKILL.md` (→ v1.2.0) spawns a Haiku subagent (Agent tool) that reads commit diffs and stores memories through the `learn` MCP tool. Removes the LLM-API-key dependency on the interactive path and keeps raw diffs out of the main thread's context. The background post-commit hook still calls an LLM API directly (a detached process cannot spawn a subagent).
- **`Learned` skill points at live sources only** — `skills/Learned/SKILL.md` now references `summary.md` (auto-updated by the EvaluateSession hook) and LTM recall, instead of the removed per-session archive files.

### Removed
- **Per-session `Learned/patterns/*.md` archives** — relic snapshots no longer written by any code path; their content was already imported into the LTM database. Removed from the repo and the plugin cache.

### Fixed
- **Version sync across sub-packages** — `packages/openltm-core`, `packages/adapter-pi`, and `packages/adapter-opencode` were stranded at `2.2.0` while the plugin advanced. All workspace packages, the plugin manifest, the README badge, and `docs/ARCHITECTURE.md` are now aligned to the source-of-truth version.
- **Stale MCP tool name in learned-pattern records** — references to the renamed `mcp__plugin_ltm_ltm__ltm_learn` eliminated (canonical is `mcp__plugin_openltm_memory__learn`).

### Notes
- Phases 2 + 3 of the frontend redesign — Restructure + Refine. See `docs/FRONTEND-REDESIGN-2026-06.md` for the full plan.
- Cluster labels already use a tag-frequency heuristic in `src/cluster.ts:64` (`generateClusterLabel`); LLM-generated labels are deferred to v2.8+.
- The synthetic `/api/health/history` series is stable per `(project_name, date)` — refreshing the page does not jitter the chart.

## [2.5.0] — 2026-06-05

### Changed
- **Frontend route rename** — `/pending` → `/inbox` across the web graph-app. The old `/pending` route now 302-redirects to `/inbox` for backward compatibility through v2.7.0; the redirect is removed at v2.8.0 per the redesign spec §8 Q5.
- **New "Ask" affordance** — A small sparkle-icon button in the top nav opens a dialog powered by the johuniq/ai-prompt-box component (21st.dev). On send, it pipes the query to the existing semantic search endpoint and routes to `/graph?q=…`. The full LLM-mediated ask flow is deferred to v2.6+.

### Added
- **AI Prompt Box** (johuniq, 21st.dev) — installed via `bunx shadcn@latest add https://21st.dev/r/johuniq/ai-prompt-box`. Self-contained input with expanding textarea, model selector, and file attachments. Drop-in at `graph-app/components/ui/ai-prompt-box.tsx`.
- **`--accent-lime` CSS token** — Reserved single-accent color for the project layer (Linear territory), added to all 6 themes. Per the redesign spec §13, the token is rationed to two specific uses in v2.6: (a) 2px left bar of selected sub-nav item, (b) ring around the central project node in the mini-graph.

### Notes
- Phase 1 of the frontend redesign — Cut. See `docs/FRONTEND-REDESIGN-2026-06.md` for the full plan (Phases 1–3, v2.5.0 → v2.7.0).
- The Anthropic plugin marketplace detects new versions via the `version` field in `.claude-plugin/plugin.json`. Bump in both `package.json` and `.claude-plugin/plugin.json` to keep them in sync.

## [2.4.0] — 2026-06-04

### Added
- **Complete UX Redesign**: Transitioned the app from a basic aesthetic to a premium, cinematic, dark-tactile design.
- **Theme System**: Added 6 cinematic themes (Studio Black, Midnight Indigo, Forest Void, Monochrome Concrete, Cyberpunk Wine, Abyssal Ocean) powered by global CSS variables and Next Themes.
- **Theme Switcher**: Added a dropdown toggle to the Top Nav to switch between the 6 themes.
- **Dashboard Overhaul**: Restructured the dashboard to prioritize global metrics. Moved `ActivityHeatmap` to the top as a full-width hero card, showing 52-weeks of contribution data. Separated project partitions and added a toggle to hide/show projects.
- **Hover Preview Card**: Replaced the raw DOM tooltip in the graph with a styled, floating card showing category, memory preview, and confidence score.
- **Search-to-Focus**: Added a floating search input in the Graph View to highlight matching nodes instantly.
- **Animated Node Entrance**: Added a fade-in effect when graph nodes are first loaded on the canvas.
- **URL-driven Graph State**: The graph's state (`activeProject`, `importanceMin`, `electricEffectsEnabled`) is now synchronized with URL search params to allow sharing exact views.
- **Project Activity Log**: Added a vertical timeline showing recent memory events on project pages.
- **Decay Visualization**: Board and table views now show visual indicators (subtle red dashed borders or down arrows) for memories whose confidence is < 0.4.
- **Empty States**: Replaced plain text fallbacks with beautifully designed typographic empty states using Lucide icons.
- **Keyboard Navigation**: The table view now supports `j`/`k` (or arrow keys) to navigate through memories, highlighting the selected row.
- **Related Memories Sidebar**: The node inspector sidebar now uses `api.semanticSearch` to display a list of semantically related memories.
- **Responsive Mobile Nav**: Added a hamburger menu to `TopNav` for mobile screens, replacing hidden elements.

### Removed
- **System Health Card**: Removed the global system health card from the dashboard since the metrics are now represented in the hero and activity views.

## [1.9.1] — 2026-05-09

### Removed
- **15 deprecated command aliases** — `recall`, `learn`, `forget`, `relate`, `capture`, `init-context`, `analyze-context`, `register-project`, `doctor`, `hook-doctor`, `decay-report`, `migrate`, `migrate-db`, `secrets-scan`, `ltm-server`. Use the 4 grouped commands: `/openltm:memory`, `/openltm:project`, `/openltm:health`, `/openltm:admin`.

### Fixed
- **README version badge** — Updated from stale `1.4.20` to current version.
- **SessionStart error message** — Referenced deprecated `/openltm:doctor`; now points to `/openltm:health`.
- **docs version headers** — `ARCHITECTURE.md`, `UX-SPEC.md`, `PRD.md` updated from `v1.4.20`.
- **Install diagram** — Removed "(+ 11 aliases)" from command count.

### Added
- **`scripts/verify-version-sync.ts`** — Checks that `package.json`, `.claude-plugin/plugin.json`, `README.md` badge, and `docs/ARCHITECTURE.md` all reference the same version.

---

## [1.9.0] — 2026-05-04

### Added
- **`memory_archive` table** — Evicted deprecated memories are preserved as JSON snapshots rather than deleted. Recoverable in Phase 7 (time-travel).
- **`memory_archive` migration (011)** — Adds `decay_score REAL NOT NULL DEFAULT 1.0` column + `idx_memories_decay_score` index to `memories`; creates `memory_archive` table with project + reason indexes.
- **Janitor settings seed (012)** — Seeds `ltm.janitor.lastRunAt`, `lastDecayRefreshed`, `lastDeprecated`, `lastArchived` rows via `INSERT OR IGNORE`.
- **`src/janitor/archive.ts`** — New `runArchive()`: evicts `deprecated + importance≤2 + recall_count≤1 + decay_score<0.10` memories into `memory_archive`. Batch of 100 per run; single-transaction DELETE cascades `memory_embeddings`, `memory_tags`, and `memory_relations`.
- **Janitor run tracking** — `runJanitor()` writes stats to settings after each pass (`lastRunAt`, `lastDecayRefreshed`, `lastDeprecated`, `lastArchived`).
- **WAL hygiene** — `runJanitor()` runs `PRAGMA wal_checkpoint(TRUNCATE)` + `PRAGMA analysis_limit=400; ANALYZE` after every pass.
- **`/openltm:health` Janitor Status section** — Shows last run timestamp, refreshed/deprecated/archived counts, next run estimate, at-risk memory count (`decay_score < 0.25`). Replaces the old inline JS decay formula with a SQL-backed summary.

### Changed
- **`runDecay()` rewritten** — Replaced O(N) JS loop + N individual UPDATEs with two batch SQL statements in one transaction: (1) `UPDATE SET decay_score = CASE …` using `power()` for all active memories, (2) `UPDATE SET status='deprecated' WHERE decay_score < 0.25`. Orders-of-magnitude faster at scale.
- **`recall()` default sort** — Replaced O(N) JS `.map(computeDecayScore).sort()` with `ORDER BY decay_score DESC` in SQL. Default sort is now O(log N) via the new index.
- **`recall()` UPDATE merged** — Two consecutive `UPDATE memories SET …` calls on the same row set (one for `last_used_at`, one for `last_recalled_at`/`recall_count`) merged into a single statement.
- **`DecayResult`** — Removed redundant `scanned` field (was always equal to `refreshed`).
- **`ArchiveResult`** — Removed unused `skipped` field (was computed but never surfaced).
- **`SETTING_KEYS`** — Added 4 new janitor tracking keys; `SETTING_DEFAULTS` updated with empty/zero defaults.

### Performance
| Path | Before | After |
|------|--------|-------|
| `recall()` default sort (10k memories) | O(N) JS ~40ms | O(log N) SQL ~3ms |
| `runDecay()` janitor pass (10k memories) | N×UPDATE ~2s | 2×SQL batch ~30ms |
| `recall()` row UPDATE | 2 sequential UPDATEs | 1 merged UPDATE |

---

## [1.8.0] — 2026-05-04

### Added
- **`EmbeddingProvider` interface** — Pluggable `generate(text): Promise<Float32Array | null>` + `available(): Promise<boolean>` abstraction. Four adapters: `disabled` (default), `Ollama`, `OpenAI`, `Gemini`.
- **`memory_embeddings` side-table (migration 010)** — Splits embedding BLOB from `memories` table into a separate `memory_embeddings` table with `ON DELETE CASCADE`. Eliminates ~260 KB/row from the recall hot path.
- **Embeddings DAO** (`src/dao/embeddings.ts`) — `getEmbedding`, `setEmbedding`, `deleteEmbedding`, `listMemoryIdsMissingEmbedding`. All embedding reads/writes go through this layer.
- **Recall explainer** — `recall()` attaches `explainer` to every result: `{ ftsRank, semanticScore, importanceBoost, recencyBoost, totalScore, temperature }`.
- **Memory temperature labels** — `hot` (recall≥10 or within 7d), `warm` (≥3 or 30d), `cool` (≥1 or 90d), `cold` (never recalled).
- **Auto-categoriser** (`src/recall/categorise.ts`) — `ltm_learn` detects category when omitted. Heuristic keyword scoring first; falls back to Anthropic API (claude-haiku) if confidence < threshold. Configurable via `embeddings.confidenceThreshold` (default 0.6).
- **SessionStart backfill hint** — One-per-day suggestion to run `/openltm:admin backfill` when a provider is configured but memories lack embeddings.
- **`ltm_recall` MCP response** — `compact()` formatter now surfaces `temperature` + `score` on every result.

### Changed
- **Ollama adapter** — Corrected endpoint (`/api/embed`), request body field (`input` not `prompt`), and response parse (`embeddings[0]` not `embedding`).
- **`available()` guard** — Called once before batch operations, not N times in a loop.
- **`workspace_id` / `agent_id`** — Now correctly forwarded through `ltm_learn` MCP handler to `learn()`.
- **`categorise.test.ts`** — Replaced 6 near-duplicate `it()` blocks with `it.each` table over `Array<[MemoryCategory, string]>`.

---

## [1.4.17] — 2026-04-15

### Added
- **`/openltm:memory` command** — Grouped routing for `recall | learn | forget | relate`. Replaces the 4 flat commands with a single entry point; flat commands kept as unchanged aliases.
- **`/openltm:project` command** — Grouped routing for `init | analyze | register`. Embeds full logic from `init-context`, `analyze-context`, `register-project`.
- **`/openltm:admin` command** — Grouped routing for `migrate | scan | server`. Includes all migrate flags, secrets scan, and server management.
- **`--save-context` flag on `/openltm:learn`** — Stores memory AND writes to `context_items` table in one shot. Replaces the need for separate `/openltm:capture` calls.
- **Legacy DB detection in `/openltm:migrate`** — Automatically checks for `~/.claude/memory/openltm.db` on `status` runs; `--legacy` flag triggers migration.

### Changed
- **`/openltm:health`** — Now shows graph server project scores (if running) AND inline memory decay summary from local DB. Graph server is optional — decay section always renders.
- **`/openltm:doctor`** — Now runs both `pluginDoctor.ts` (plugin health) and `hookDoctor.ts` (hook health) in a single command. Replaces the need for `/openltm:hook-doctor`.

### Fixed
- **`/openltm:secrets-scan`** — Fixed `secretsScrubber.js` import → `secretsScrubber.ts`. Previous `.js` extension caused a runtime error since Bun runs `.ts` directly.
- **Added auto-scrub note** to `secrets-scan` and `admin scan` — clarifies that new memories are already scrubbed on write via `db.ts:263`; this command patches existing memories only.

### Deprecated (removing in v1.6.0)
- `/openltm:hook-doctor` → use `/openltm:doctor`
- `/openltm:migrate-db` → use `/openltm:migrate --legacy` or `/openltm:admin migrate --legacy`
- `/openltm:capture` → use `/openltm:learn --save-context` or `/openltm:memory learn --save-context`
- `/openltm:decay-report` → use `/openltm:health`

---

## [1.4.15] — 2026-04-14

### Added
- **`/openltm:doctor` command** — Unified plugin health check covering 9 areas: version consistency, bun runtime, database integrity + migrations, MCP registration, hooks.json source files + log error counts, settings.json hooks, stale executables (exit 127 source), marketplace source, and plugin.json forbidden fields. Output: ✅/❌/🟡/🔴 per check with `→` remediation and final N passed/M failed summary.
- **`hooks/bin/run-hook.sh`** — POSIX shell wrapper that locates bun across all install methods (Homebrew, Volta, asdf, curl installer) before falling back to shell profile sourcing. Eliminates the hardcoded `/opt/homebrew/bin/bun` dependency that broke non-Homebrew installs.

### Fixed
- **Exit 127 on session start** — Stale `.ts` and `.bundle.mjs` executables in `~/.claude/hooks/` were auto-discovered by Claude Code and run via `#!/usr/bin/env bun` shebang; bun is not in the harness subprocess PATH → exit 127. `install-wiring.ts` now removes these stale files on every update.
- **hooks.json commands** — Replaced hardcoded `/opt/homebrew/bin/bun run ...` with `run-hook.sh` wrapper. Works on any machine regardless of bun install method and survives marketplace updates without requiring postinstall re-patching.

### Changed
- **`install-wiring.ts`** — Stale hook file cleanup now derived from `LTM_HOOK_PATTERNS` instead of hardcoded list; removes both `.ts` and `.bundle.mjs` variants. Adds defensive `chmod +x` on `run-hook.sh` after each update.

---

## [1.4.5] — 2026-04-11

### Added
- **LTM Evolution Plan (18 tasks)** — Full implementation of automatic LLM memory tool utilization, conflict detection, temporal reasoning, and multi-agent support
- **SessionStart hook** — Inject memories + context at session start with imperative recall instructions
- **MCP tool descriptions** — Added "MUST-CALL" triggers to all tools for automatic LLM usage
- **CLAUDE.md rewrite** — Imperative rules requiring LTM tool usage before non-trivial tasks
- **Skill YAML frontmatter** — Enhanced descriptions with auto-invocation triggers
- **autoRecall config** — Option to auto-call ltm_recall at session start
- **Few-shot examples** — Added to ContinuousLearning skill
- **/analyze-context command** — Wrapper for context analysis
- **Unified decay model** — Half-life based (90 days default) eliminating dual-model contradiction
- **Temporal metadata** — first_recalled_at, last_recalled_at, recall_count on memories table
- **Contradiction detection** — janitor detects conflicting memories via embeddings
- **Conflict surfacing** — SessionStart shows conflicting memories to user
- **Timeline view** — graph-app shows memory recall history
- **Temporal queries** — ltm_recall supports since/until/sort_by params

### Fixed
- **plugin.json** — Added hooks and agents paths for proper Claude Code plugin discovery

### Changed
- **Skills** — Now 5 skills: ContinuousLearning, GitLearn, Learned, LtmServer, session-context

---

# Changelog

## [1.3.9] — 2026-04-01

### Added
- **LLM migration guide** (`docs/llm-migration-guide.md`) — prompt-engineered guide that LLMs can follow to migrate users from legacy `~/.claude/memory/` setup to the plugin system. Imperative steps, shell-ready commands, decision table, verification checklist.
- **Curl one-liner in README** — users paste a single curl command into any LLM coding session to trigger the full migration autonomously.

### Fixed
- **install-wiring.ts** — handle missing `~/.claude/settings.json` on fresh installs and CI runners.
- **install-wiring.ts** — auto-detect marketplace installs and skip `settings.json` hook wiring (plugin system uses `hooks/hooks.json` instead). Cleans up stale LTM hooks left from previous dev installs.
- **install-wiring.ts** — scan `~/.claude/plugins/data/ltm-*` as fallback when `CLAUDE_PLUGIN_DATA` is not set, so DB auto-copy works on first install without a session restart.
- **CI** — use `bun run test` instead of bare `bun test` to exclude Playwright e2e tests via `--path-ignore-patterns`.
- **bunfig.toml** — remove `preload = []` (rejected by Bun as invalid).
- **LLM migration guide** — use `~/.claude/plugins/data/ltm-*/openltm.db` instead of `$CLAUDE_PLUGIN_DATA` (env var is only set inside plugin runtime, not in user shells).

---

## [1.3.8] — 2026-03-27

### Fixed
- **Compact MCP responses** — `ltm_recall` now returns a compact format by default, reducing response size by ~70-80%. Strips verbose metadata fields, truncates content to 300 chars, and slims relations to `{id, type, dir}`. Pass `verbose: true` to get the full output.
- **Removed JSON pretty-printing** across all MCP tools and resources (`ltm_recall`, `ltm_context`, `ltm_context_items`, globals/recent/tags resources). Compact JSON halves whitespace overhead.

---

## [1.3.7] — 2026-03-26

### Added
- **Graph UI improvements** — nav active state, config polish, force-directed graph tuning, health auto-refresh.
- **Config Explorer page** in graph-app — browse LTM configuration visually.
- **`src/janitor/`** module for memory maintenance tasks.

### Changed
- **Graph visualization** migrated from custom D3 to `react-force-graph-2d`.
- **Config Explorer API** added to graph-server (`/api/config-explorer`).
- Removed old HTML route from graph-server.
- LtmServer skill updated to use `CLAUDE_PLUGIN_ROOT` instead of hardcoded `~/.claude/memory/`.

---

## [1.3.0–1.3.6] — 2026-03-25

### Added
- **`/migrate-db` command** — check and migrate `openltm.db` from legacy `~/.claude/memory/` to marketplace plugin data directory.
- **Auto git-fetch** on SessionStart — marketplace clone stays current without manual pulls.
- **Self-healing GitHub source** — `install-wiring.ts` patches `known_marketplaces.json` to `"source":"github"` on every postinstall, preventing the plugin system from reverting to `"git"` source.

### Fixed
- DB path migration fix — ensures `openltm.db` is always found at the correct marketplace data path.
- Duplicate MCP registration removed from `install-wiring.ts`.
- `patchMarketplaceSource` refactored — no mutation, no TOCTOU race, uses named constant.
- Version sync — both `package.json` and `.claude-plugin/plugin.json` are kept in lockstep.

---

## [1.2.0] — 2026-03-24

### Added
- **Git Commit Hooks** (`hooks/src/GitCommit.ts`) — global post-commit hook that auto-extracts learnings from diffs using LLM extraction. Fires on every commit across all projects, exits immediately (non-blocking). Controlled by `ltm.gitLearnEnabled` config flag (default: `false`).
- **Shared LLM extraction** (`hooks/lib/llmExtract.ts`) — `extractAndLearn()` shared by both `EvaluateSession` and `GitCommit` hooks.
- **`/git-learn` skill** (`skills/GitLearn/SKILL.md`) — retroactive extraction for past commits (`--commits N` / `--since <date>`).
- **`scripts/update-wiring.ts`** — re-wires MCP, hooks, and git hook after marketplace updates. Runs automatically via `postinstall` in `package.json`.
- **4 new config fields** in `ltm.*`:
  - `gitLearnEnabled` (boolean, default: `false`)
  - `gitLearnMinDiffChars` (number, default: `200`)
  - `gitLearnFileFilter` (string[], default: `[]`)
  - `gitLearnIgnorePatterns` (string[], default: `["package-lock.json","*.lock","dist/",".min.js"]`)
- **`.ltmignore` opt-out** — place a `.ltmignore` file in any repo root to skip git-learn extraction for that repo.

### Changed
- `EvaluateSession.ts` refactored to use shared `extractAndLearn()` from `hooks/lib/llmExtract.ts`.
- `scripts/install-wiring.ts` now wires global git hook dir (`~/.claude/hooks/git/post-commit`) and sets `git config --global core.hooksPath`.
- `bunfig.toml` — removed invalid `exclude` key; test exclusion handled via `--path-ignore-patterns` in `bun run test`.

---

## [1.1.0] — 2026-03-21

### Added
- ASCII architecture diagrams in README.
- 12 LTM slash commands added to plugin (`skills/`).
- `CLAUDE_PLUGIN_DATA` support for db path isolation per marketplace install.
- `scripts/install-wiring.ts` — replaces Python subprocess in `install.sh`.
- Migration: copies existing `openltm.db` from legacy path on marketplace install.

---

## [1.0.0] — 2026-03-15

### Added
- Initial release.
- SQLite LTM with FTS5 + semantic search via embeddings.
- MCP server (`src/mcp-server.ts`) with 7 tools: `ltm_recall`, `ltm_learn`, `ltm_forget`, `ltm_relate`, `ltm_context`, `ltm_context_items`, `ltm_graph`.
- Claude Code hooks: `SessionStart`, `Stop` (UpdateContext + EvaluateSession), `PreCompact`.
- Memory graph visualization server (`src/graph-server.ts`).
- `install.sh` — safe idempotent installer (never overwrites `openltm.db`).
