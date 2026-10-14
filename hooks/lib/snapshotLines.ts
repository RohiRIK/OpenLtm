/**
 * snapshotLines.ts — PreCompact snapshot lines are egress (written to
 * context-summary.md, then injected by SessionStart). Every line goes through
 * scrubForEgress; a line whose scrub failed is omitted, never written raw.
 */
import { existsSync, writeFileSync } from "fs";
import { scrubForEgress, isEgressScrubFailed } from "@rohirik/openltm-core";

export interface SnapshotStats { input: number; kept: number }

export function newSnapshotStats(): SnapshotStats {
  return { input: 0, kept: 0 };
}

export function scrubSnapshotLines(lines: string[], stats?: SnapshotStats): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (stats) stats.input++;
    const s = scrubForEgress(line);
    if (isEgressScrubFailed(s)) continue;
    out.push(s);
    if (stats) stats.kept++;
  }
  return out;
}

/**
 * Write the summary unless scrubbing dropped every line it was given and a
 * previous summary exists — then keep the previous file rather than replace
 * real context with an empty skeleton. Returns true when the file was written.
 */
export function writeSnapshotUnlessAllDropped(path: string, summary: string, stats: SnapshotStats): boolean {
  if (stats.input > 0 && stats.kept === 0 && existsSync(path)) return false;
  writeFileSync(path, summary);
  return true;
}
