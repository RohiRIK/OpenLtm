---
description: "DEPRECATED — use /ltm:health instead. Run a full health check on the LTM plugin."
allowed-tools: ["Bash"]
---

> ⚠ **Deprecated:** use `/ltm:health` instead. This alias will be removed in v1.6.0.

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
