---
description: "Run a full health check on every aspect of the LTM plugin — versions, bun runtime, database, MCP, hooks, stale files, and marketplace source."
allowed-tools: ["Bash"]
---

If `CLAUDE_PLUGIN_ROOT` is unset, find plugin root: `claude plugin info ltm 2>/dev/null | grep -i path | head -1`.

## Plugin Health

Run and display output verbatim:

```bash
bun "${CLAUDE_PLUGIN_ROOT}/hooks/lib/pluginDoctor.ts"
```

For any ❌ result, explain the error and suggest a fix based on the `→` hint shown in the output.

## Hook Health

Run and display output verbatim:

```bash
bun "${CLAUDE_PLUGIN_ROOT}/hooks/lib/hookDoctor.ts"
```

For any 🔴 or ❌ result, explain the error and suggest a fix.

| Icon | Meaning |
|------|---------|
| ✅ | Check passed / file exists |
| ❌ | Check failed / file missing — hook fails silently |
| 🟡 | Warning — functional but needs attention / 1–2 errors |
| 🔴 | 3+ hook errors in last 24h |
| 🟢 | All checks passed |
