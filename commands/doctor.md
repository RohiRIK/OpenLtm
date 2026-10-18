---
description: "USE WHEN OpenLTM is down or misbehaving: the MCP server will not start, memories are not injected, hooks fail, or a migration error (such as a checksum mismatch) blocks the database. Read-only diagnostic with a fix line for every failed check."
allowed-tools: ["Bash"]
---

Runs the read-only plugin health check: manifest and version, bun runtime, database (applied migrations and recorded checksums), MCP registration, hooks, stale executables, and marketplace source. It changes nothing.

```bash
CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA}" bun "${CLAUDE_PLUGIN_ROOT}/hooks/lib/pluginDoctor.ts"
```

Show the output as-is, then summarize the failed (❌) checks and their `→` fix lines. Do not run a fix for the user unless they ask.

For a **migration checksum mismatch**, the fix is `/openltm:admin migrate --accept-checksums`: it backs the database up first, then re-records the checksum of each mismatched migration. No migration SQL runs and no memories change.

For memory health (scores, decay, activity), use `/openltm:health`.
