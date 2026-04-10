# LTM Evolution Plan — Learnings

## T16-T18: Multi-Agent Memory Isolation

### Key Gotcha
**INSERT param order must match column order exactly** — SQLite bindings map positionally, not by name. When adding new columns to INSERT, ensure the params array order matches the column list order.

### Schema Changes
- Added `workspace_id`, `agent_id` columns to `memories` and `context_items`
- Added indexes for query performance
- Created migration `migrations/007_workspaces.sql`

### MCP Tool Updates
- `ltm_recall`: Added `workspace_id`, `agent_id` filter params
- `ltm_learn`: Added `workspace_id`, `agent_id` params for isolation
- Both default to `null` for backward compatibility (single-user mode)

### Concurrency
- WAL mode already enabled (from T10 work)
- Added `PRAGMA busy_timeout=5000` to handle concurrent access
- Added `withRetry()` helper for SQLITE_BUSY errors (optional utility)

### Verification
- TypeScript: ✅ clean
- Tests: 39/40 pass (1 pre-existing Playwright config error)
- Manual workspace filtering test: ✅ works correctly
