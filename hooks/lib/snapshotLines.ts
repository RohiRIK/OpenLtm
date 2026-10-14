/**
 * snapshotLines.ts — PreCompact snapshot lines are egress (written to
 * context-summary.md, then injected by SessionStart). Every line goes through
 * scrubForEgress; a line whose scrub failed is omitted, never written raw.
 */
import { scrubForEgress, isEgressScrubFailed } from "@rohirik/openltm-core";

export function scrubSnapshotLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const s = scrubForEgress(line);
    if (isEgressScrubFailed(s)) continue;
    out.push(s);
  }
  return out;
}
