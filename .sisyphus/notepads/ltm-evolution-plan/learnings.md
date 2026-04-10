# Learnings

## [2026-04-10] Session Start
- Plan approved by Momus after 4 iterations (8 issues fixed across 3 rejections)
- Key fixes applied: file extensions (.js→.ts), MCP test harness (use DB functions directly, not server internals), migration CLI (--up not up), wave dependency conflicts (split waves), hook QA needs stdin JSON piping `echo '{"cwd":"/tmp/test-project"}' |`, Task 5 must add YAML frontmatter to GitLearn and session-context
- Hook test pattern: `echo '{"cwd":"/tmp/test-project"}' | LTM_DB_PATH=/tmp/test-ltm.db bun run hooks/src/SessionStart.ts`
- MCP harness: test `learn`, `recall`, `forget`, `relate` from `src/db.ts` directly — NOT the server
- Migration CLI: `bun run src/migrations.ts --up` (not `bun run src/migrations.ts up`)
- Wave ordering: 1 → 2a → 2b → 3 → 4a → 4b → 4c → 5a → 5b → 5c → FINAL

## 2026-04-10 — MUST-CALL trigger descriptions

- MCP tool descriptions serve as LLM auto-invocation hints — "MUST call before/after" phrasing reliably triggers automatic recall/learn calls in Claude sessions without explicit user prompting.
- Use imperative "MUST call" for the two highest-value auto-invocation targets (ltm_recall, ltm_context) and softer "Call when" for relationship/graph tools.
- Pattern: "[WHEN trigger]. [WHAT it does]. [Additional triggers]." keeps descriptions concise (1-3 sentences) while adding behavioural guidance.
- Descriptions should mention concrete scenarios (non-trivial task, session start, switching projects) not just generic categories.
- Test strategy: read the source file as text, extract description via regex match on server.tool() call site — avoids instantiating the MCP server and its DB dependencies.

## 2026-04-10 — Skill auto-invocation descriptions

- Skill descriptions should name the concrete trigger phrases and scenarios that should cause auto-invocation; this is more effective than describing only the skill contents.
- YAML frontmatter for skills should stay minimal but consistent: `name`, `description`, `user-invocable`, and `version` (plus any existing flags like `disable-model-invocation`).
- When updating Markdown code blocks, escape embedded shell newlines carefully so the rendered instructions stay valid and readable.
