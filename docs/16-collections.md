# Collections: structured types the agent defines

Memories are prose. Some knowledge has a fixed shape instead: the servers in a lab and their ports, the releases of a project and whether each was tagged, the endpoints of an API. For those, an agent can define a **collection** (a type with named, typed fields) and store **records** in it. A record can then be found by field (`tagged = false`, `port > 8000`) as well as by text.

A collection is a row of data, not a table. One migration (031) added three fixed tables, `collections`, `records` and `records_fts`, and nothing the agent does ever changes the SQL schema or runs agent-written SQL.

---

## The two tools

On Claude Code the tools are `collection` and `record` (MCP server `memory`). OpenCode has `ltm_collection` / `ltm_record`, OpenClaw and Hermes `openltm_collection` / `openltm_record`; Pi gets the MCP tools.

### `collection`

| action | arguments | does |
|--------|-----------|------|
| `list` | `include_archived?` | Types visible from the current project (its own and global ones), with fields and record counts. |
| `describe` | `name` | One type in full, including its managed indexes. |
| `define` | `name`, `description`, `fields`, `key_field?`, `scope?` (`global` default, or `project`), `origin?`, `force?` | Creates a type. Refused with `similar_exists` when a near-duplicate exists (`server` vs `servers`, mostly the same fields); pass `force: true` only for a genuinely different type. |
| `evolve` | `name`, `fields?`, `description?` | Additive changes only: a new optional field, a new enum value, making a field optional, a new description. Anything else is `breaking_change`. |
| `archive` | `name` | Hides the type. Its records are kept; the owner restores it. |

A field is `{name, type, required?, searchable?, description?, values?}`. Names are lowercase snake_case, 2 to 40 characters. Types:

| type | value |
|------|-------|
| `string` | text up to 500 characters |
| `text` | text up to 16,000 characters |
| `integer`, `number` | a JSON number (`integer` must be whole) |
| `boolean` | `true` / `false` |
| `date` | `YYYY-MM-DD` or an ISO 8601 date-time that exists |
| `enum` | one of `values` |
| `string[]` | up to 50 strings |
| `url` | an `http(s)` URL |

`key_field` names a required `string`, `integer`, `date`, `enum` or `url` field. With a key, `put` updates the record with the same key instead of adding a second one. Text-like fields are `searchable` by default.

### `record`

| action | arguments | does |
|--------|-----------|------|
| `put` | `collection`, `data`, `merge?`, `origin?`, `memory_id?` | Validates `data` against the fields and stores it. With `merge: true`, only the given fields change on the record with this key, and `null` removes a field. `memory_id` links the memory that explains the record. |
| `get` | `collection`, `key` or `id` | One record. |
| `query` | `collection`, `where?`, `text?`, `order_by?`, `order?`, `limit?` (max 100), `include_archived?` | Every filter in `where` must match: `{field, op, value}` with `eq`, `neq`, `lt`, `lte`, `gt`, `gte`, `in`, `contains` (substring, or list membership for `string[]`) or `exists`. `field` can also be `created_at`, `updated_at`, `origin` or `key`. |
| `archive` | `collection`, `key` or `id` | Soft-deletes a record; a later `put` with the same key brings it back. |

Every error comes back as `{ok: false, error, message, details?}` with a stable `error` code (`invalid_record`, `invalid_query`, `similar_exists`, `breaking_change`, `secret_refused`, `limit`, …), so the model can correct the call.

---

## Safety

- **No agent SQL.** Filters compile to parameterised SQL. A filter on a field the type does not define is refused before any SQL is built.
- **Secrets are refused, not redacted.** A redacted placeholder would silently corrupt structured data, so a `put` whose values look like a secret (keys, tokens, passwords) fails with `secret_refused` and stores nothing. Output is scrubbed again on the way out.
- **Evidence, not authority.** Records are context like memories: the tool descriptions say so, and the session index of collections sits inside the same `<recalled-memory>` frame as injected memories. A record whose origin is `historical-approval`, or whose type or field names read like a permission (`approved`, `authorized`, `allowed`, `permission`, `consent`, `grant`…), carries an `authority_note`: it is history, not a current permission.
- **Origin.** Records use the memory origin values (see [Memory versus authority](memory-versus-authority.md)); the tools default to `agent-observation`, the `ltm` CLI writes `owner-statement`. A type's origin is `owner-statement` or `agent-observation`.
- **Limits** (override with a `collections.<key>` row in `settings`): 50 active types (`max_collections`), 30 fields, 16 KB per record (`max_record_bytes`), 10,000 records per type (`max_records`), 100 results per query.

---

## Recall, context and the session index

- `recall` with a query appends up to 3 matching records after the memories (`type: "record"`), so callers reading memories by position are unaffected. `includeRecords: false` turns this off.
- Records rank by full-text search over their searchable fields and, when an embeddings provider is available (local llama.cpp by default, see [Local embeddings](15-local-embeddings.md)), by vector similarity too, fused by reciprocal rank. A record's vector embeds its scrubbed search text; a `put` clears it and a background embed refills it. `bun packages/openltm-core/src/embeddings.ts --backfill` embeds records along with memories.
- `context` and the SessionStart index list the types that exist, so a new session knows to query them before writing prose.

## Managed indexes

A query over JSON fields scans the collection. Once a type holds `collections.index_min_records` active records (default 2,000), the first query that filters or sorts on a scalar field creates a partial index for that field and that collection, at most 3 per collection. Nobody asks for it and the agent never sends DDL. A breaking change that removes or retypes the field drops its index. `collection describe` lists them.

---

## The owner's controls

```bash
ltm collection list [--archived]
ltm collection show <name>
ltm collection define <name> --description "…" --fields '<json>' [--key field] [--scope project] [--force]
ltm collection evolve <name> [--fields '<json>'] [--description "…"] [--allow-breaking]
ltm collection archive <name>   |   ltm collection restore <name>
ltm record list <collection> [--where '<json>'] [--text q] [--order-by f] [--asc] [--limit n] [--archived]
ltm record get <collection> <key>
ltm record put <collection> --data '<json>' [--merge] [--origin o]
ltm record archive <collection> <key>
ltm record export <collection>        # JSON lines
```

Only the CLI can make a breaking change (`--allow-breaking`): it backs the database up first, strips removed fields from every record, revalidates all of them, and changes nothing if any record no longer fits.

The graph app has a **Collections** page (`localhost:7332/collections`) to browse types and records, search them, and archive or restore a type.

## Hermes

The Hermes plugin is a separate Python implementation over the same tables (it creates them with the same DDL, so a database shared through `LTM_DB_PATH` works from both sides). It validates, queries, embeds and indexes the same way; a shared contract fixture (`packages/openltm-core/src/__tests__/fixtures/collections-contract.json`) is run by both test suites.

## See also

- [MCP tools](08-mcp-tools.md)
- [Memory versus authority](memory-versus-authority.md)
- [Hermes plugin](10-hermes-plugin.md)
