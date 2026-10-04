# @rohirik/pi-ltm

OpenLTM long-term memory extension for the [Pi coding agent](https://pi.dev). Shares the local memory database with Claude Code and OpenCode.

## Install

```bash
pi install npm:@rohirik/pi-ltm
```

If Pi is already running, use `/reload` to load the extension. Pi records the package in `~/.pi/agent/settings.json`; use `pi install --local npm:@rohirik/pi-ltm` for a project-scoped install.

Find the extension in the [Pi package catalog](https://pi.dev/packages/@rohirik/pi-ltm). The npm package declares the `pi-package` discovery keyword and a `pi.extensions` manifest pointing to its compiled entrypoint.

## Requirements

Install [Bun](https://bun.sh) and make it available on `PATH`. Pi loads the extension under Node; the extension runs OpenLTM's core MCP server in a Bun child process, avoiding direct Node imports of `bun:sqlite`. The core package is installed as a dependency.

## What it does

- Registers the memory tools returned by OpenLTM's core MCP server, including recall, learn, forget, project context, and memory relationships.
- On Pi's `before_agent_start` event, waits for the core connection and appends relevant project memories as a `## Prior Knowledge (LTM)` block.
- Uses a local SQLite database shared with the other OpenLTM adapters. If Bun or the core server cannot be found, the extension currently skips registration.

The current Pi adapter does not register a compaction hook.

## Shared memory

Default database path:

```text
~/.claude/plugins/data/OpenLtm-openltm/openltm.db
```

Override it before starting Pi:

```bash
export LTM_DB_PATH="/custom/path/openltm.db"
```

A memory learned in Pi is available to another OpenLTM adapter using the same database.

## Privacy and license

Memory is stored locally. Optional embedding or janitor providers can send memory content to the provider you configure; see the [repository's security notes](https://github.com/RohiRIK/OpenLtm#security-notes). MIT licensed.
