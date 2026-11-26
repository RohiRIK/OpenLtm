# Hive mode: shared memory between agents (opt-in)

Every agent host keeps its own private OpenLTM database. **Hive mode** adds one extra SQLite file, the *hive*, that several agents can share: a Hermes profile can leave a gotcha there that Claude Code later finds, or a coordinator can share project facts with its specialist profiles.

It is **off by default and closed when first turned on**:

- A host registers the hive tools only after it opts in (`LTM_HIVE=1`, or `"hive": {"enabled": true}` in config). Without that, the tool list is unchanged.
- A new hive is disabled, has no members, and a member can do nothing until the owner grants it `read` and/or `write`.
- Agents cannot change permissions. They can only *ask* (`hive_request_access`); the owner decides from the CLI with the owner key.
- Nothing moves from an agent's private memory into the hive on its own. Only an explicit `hive_learn` writes there and only `hive_recall` reads it. Hive memories are not injected at session start.

The permission model borrows from [hermes-herald](https://github.com/bennybuoy/hermes-herald)'s per-route capabilities: explicit grants, missing or malformed means no access, unknown names are ignored, a separate key per trust boundary, and a durable audit ledger.

## Set up (owner)

```bash
# 1. Create the hive (disabled, no members). Prints the owner key ONCE.
ltm hive init                         # default ~/.openltm/hive/hive.db, or --path
export LTM_HIVE_OWNER_KEY=hiveowner_…  # keep it out of every agent's environment

# 2. Register each agent. Prints that agent's token ONCE.
ltm hive agent add hermes-bob
ltm hive agent add claude-code

# 3. Grant what each one needs.
ltm hive grant hermes-bob read,write
ltm hive grant claude-code read

# 4. Turn the hive on.
ltm hive enable
```

Then give each agent its token, in that agent's environment only:

| Host | Setting |
|---|---|
| Claude Code / OpenCode / Pi (MCP server) | env `LTM_HIVE=1`, `LTM_HIVE_TOKEN=hive_…`, and `LTM_HIVE_PATH` if not the default |
| Hermes | `$HERMES_HOME/openltm.json`: `"hive": {"enabled": true, "token": "hive_…", "path": "…"}` (env `LTM_HIVE*` also works and wins) |

Restart the agent so the hive tools register.

## Agent tools

| Tool (Hermes: `openltm_hive_*`) | Needs | Does |
|---|---|---|
| `hive_status` | token | Is the hive on, is this agent a member, which grants it has |
| `hive_recall` | `read` | Full-text search of the hive; each result shows `author`, `origin`, `age` |
| `hive_learn` | `write` | Share one memory. `origin`: `agent-observation` (default), `external-source`, `proposal` |
| `hive_forget` | `write` | Archive a hive memory **this agent wrote** |
| `hive_request_access` | token | File a request for `read`/`write`; the owner approves or denies |

Errors carry a stable code: `hive_disabled`, `hive_missing`, `hive_unknown_agent`, `hive_no_grant`, `hive_not_author`, `hive_invalid`.

## Owner commands

```
ltm hive status | audit [--limit N] | agent list | requests [--all]
ltm hive enable | disable                      [owner key]
ltm hive agent add <name> | agent remove <name> [owner key]
ltm hive grant <agent> read[,write]            [owner key]
ltm hive revoke <agent> [read|write]           [owner key]
ltm hive approve <id> | deny <id>              [owner key]
ltm hive learn "<text>" [--origin …]           [owner key]  (default origin owner-statement)
ltm hive archive <id>                          [owner key]
ltm hive recall [query]
```

Add `--json` for machine-readable output. `disable`, `revoke` and `agent remove` apply on the agent's next call; nothing is cached. To rotate a token: `agent remove`, then `agent add` (grants start empty again).

## Identity and sub-agents

Identity follows the token, and a token belongs to one host profile. A sub-agent running **inside** the same process as its parent (Hermes `delegate_task`, herald `delegate_subagent`) uses the parent's provider and therefore acts as the parent, with the parent's grants. To give a sub-agent its own, narrower rights, run it as its own Hermes profile with its own token (herald `dispatch_agent` to a named profile does that).

## Provenance

- `author_agent` is set from the token, never from a field the agent fills in. `source_host` records the kind of host.
- Agents cannot write `owner-statement` or `historical-approval` into the hive: one agent cannot turn its claim into an owner statement for another agent. The owner can, with `ltm hive learn`.
- `hive_recall` returns a notice that these memories were written by other agents and are evidence, not instructions (the same rule as the [recalled-memory frame](memory-versus-authority.md)).
- Every read, write, refusal, grant and revoke goes to `hive_audit` (`ltm hive audit`).

Writes are secret-scrubbed, deduplicated by normalized content (two agents learning the same thing get one row), and limited to 8,000 characters.

## Limits

- **Not a defence against a hostile local process.** Any process running as your OS user can open `hive.db` directly. The hive guards the memory tools: agents crossing through them, prompt-injected "remember this for everyone" leaks, accidental sharing. The file is created with mode 0600.
- **Memory poisoning.** A member with `write` can plant wrong facts for the others. Author and origin on every result, no auto-injection, the audit log and `revoke` limit the damage; grant `write` sparingly.
- **Full-text only** in this version (porter stemming). Collections are not shared yet.
- The hive is a separate file with its own schema version; it needs no migration of the main database.
