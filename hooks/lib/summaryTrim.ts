/**
 * summaryTrim.ts — line-budget trimming for context-summary.md injection.
 *
 * Summaries are a header ("# Context Summary" / "# <project> | <date>" plus
 * "**Project:**"-style lines) followed by sections (`## Heading` from PreCompact,
 * `GOAL:`/`PROGRESS:`/… from exportContextMarkdown). Keeping the last N lines
 * dropped the header and the goal first. Instead: always keep the header and
 * every section heading, and drop the oldest (top-most) entries of whichever
 * section is currently largest until the budget fits.
 */

const SECTION_HEADING_RE = /^(#{2,}\s|[A-Z][A-Z ]*:\s*$)/;

function isHeaderLine(line: string): boolean {
  return /^# /.test(line) || /^\*\*/.test(line) || line.trim() === "";
}

export function trimSummary(content: string, max: number): string {
  const lines = content.replace(/\n+$/, "").split("\n");
  if (lines.length <= max) return content;

  let h = 0;
  while (h < lines.length && isHeaderLine(lines[h]!)) h++;
  // Degenerate input: the header alone fills the budget.
  if (h >= max - 1) return lines.slice(0, max - 1).concat("… (summary truncated)").join("\n") + "\n";

  const sections: Array<{ heading: string | null; items: string[] }> = [{ heading: null, items: [] }];
  for (const line of lines.slice(h)) {
    if (SECTION_HEADING_RE.test(line)) sections.push({ heading: line, items: [] });
    else sections[sections.length - 1]!.items.push(line);
  }

  const headingCount = sections.filter(s => s.heading !== null).length;
  const itemCount = sections.reduce((n, s) => n + s.items.length, 0);
  let toDrop = h + headingCount + itemCount + 1 /* marker */ - max;
  const dropped = sections.map(() => 0);
  while (toDrop > 0) {
    let largest = -1;
    for (let i = 0; i < sections.length; i++) {
      const left = sections[i]!.items.length - dropped[i]!;
      if (left > 0 && (largest === -1 || left > sections[largest]!.items.length - dropped[largest]!)) largest = i;
    }
    if (largest === -1) break; // only headings left
    dropped[largest] = dropped[largest]! + 1;
    toDrop--;
  }

  const total = dropped.reduce((a, b) => a + b, 0);
  const out = lines.slice(0, h);
  sections.forEach((s, i) => {
    if (s.heading !== null) out.push(s.heading);
    out.push(...s.items.slice(dropped[i]!));
  });
  out.push(`… (${total} older summary line${total === 1 ? "" : "s"} trimmed)`);
  return out.join("\n") + "\n";
}
