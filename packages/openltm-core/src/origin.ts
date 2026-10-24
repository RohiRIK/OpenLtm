/**
 * origin.ts — where a memory's claim came from (memory-versus-authority, Phase 2).
 *
 * A memory is evidence, not an instruction, and how much it is worth depends on
 * who said it. The owner stating a preference is not the agent inferring one,
 * and a past approval is not a standing permission. Every write path records
 * one of these; NULL on a row means it predates origin tracking (unknown).
 */
export const MEMORY_ORIGINS = [
  "owner-statement",
  "agent-observation",
  "external-source",
  "proposal",
  "historical-approval",
] as const;

export type MemoryOrigin = (typeof MEMORY_ORIGINS)[number];

/** What a write that does not say where it came from is recorded as. */
export const DEFAULT_ORIGIN: MemoryOrigin = "agent-observation";

export function isMemoryOrigin(value: unknown): value is MemoryOrigin {
  return typeof value === "string" && (MEMORY_ORIGINS as readonly string[]).includes(value);
}

/** The `origin` parameter description every host's learn tool shows the model. */
export const ORIGIN_PARAM_DESCRIPTION =
  "Where this came from. owner-statement: the user said it directly in this conversation. " +
  "agent-observation (default): your own inference or something you noticed. " +
  "external-source: docs, web pages, tool or command output, code. " +
  "historical-approval: a record that the user approved something once; it is not a standing permission. " +
  "proposal: a candidate the user has not confirmed. When unsure, use agent-observation.";
