---
type: llm
focus: trace
---

Judge the spec file the agent wrote under `specs/` (its content appears in the Write call in the trace). Pass only if ALL of these hold:
1. It has sections for what is being built, existing context, numbered acceptance criteria, and out of scope.
2. Every acceptance criterion is testable — a concrete given/when/then or an observable result, not "should be fast" or "should be robust".
3. Its existing-context section carries forward the recalled prior decision that cross-cutting request policies such as rate limits belong in `src/middleware/` and are registered once in `src/server.ts` (memory #31), rather than ignoring it or contradicting it.
4. It covers at least one edge case (for example the limit boundary, an unidentified client, or the reset window).
