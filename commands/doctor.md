---
description: "Run a full health check on every aspect of the LTM plugin — versions, bun runtime, database, MCP, hooks, stale files, and marketplace source."
allowed-tools: ["Bash"]
---

Run and display output verbatim:

```bash
bun "${CLAUDE_PLUGIN_ROOT}/hooks/lib/pluginDoctor.ts"
```

If `CLAUDE_PLUGIN_ROOT` is unset, find plugin root: `claude plugin info ltm 2>/dev/null | grep -i path | head -1`.

For any ❌ result, explain the error and suggest a fix based on the `→` hint shown in the output.

| Icon | Meaning |
|------|---------|
| ✅ | Check passed |
| ❌ | Check failed — see `→` remediation |
| 🟡 | Warning — functional but needs attention |
| 🔴 | 3+ hook errors in last 24h |
| 🟢 | All checks passed |
