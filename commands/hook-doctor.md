---
description: "DEPRECATED — use /ltm:doctor instead (now includes hook health). Run a health check on all registered Claude Code hooks."
allowed-tools: ["Bash"]
---

> ⚠ **Deprecated:** use `/ltm:doctor` instead — it now includes full hook health. This alias will be removed in v1.6.0.

Run and display output verbatim:

```bash
bun "${CLAUDE_PLUGIN_ROOT}/hooks/lib/hookDoctor.ts"
```

If `CLAUDE_PLUGIN_ROOT` is unset, find plugin root: `claude plugin info ltm 2>/dev/null | grep -i path | head -1`.

For any 🔴 or ❌ result, explain the error and suggest a fix.

| Icon | Meaning |
|------|---------|
| ✅ | File exists |
| ❌ | File missing — hook fails silently |
| 🟢 | No errors in last 24h |
| 🟡 | 1–2 errors — monitor |
| 🔴 | 3+ errors — needs attention |
