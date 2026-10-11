/** Canonical event names written to hooks.log — consumed by /openltm:health for activity aggregation. */
export const EVENTS = {
  SESSION_START:      "session.start",
  SESSION_EVALUATED:  "session.evaluated",
  CONTEXT_UPDATED:    "context.updated",
  COMPACT_PRE:        "compact.pre",
  RECALL_HIT:         "recall.hit",
  LEARN_WRITE:        "learn.write",
  WIZARD_COMPLETE:    "wizard.complete",
  GIT_COMMIT:         "git.commit",
  PROMPT_RECALL:      "recall.prompt",
  STALE_FLAGGED:      "memory.stale_flagged",
} as const;

export type EventName = typeof EVENTS[keyof typeof EVENTS];
