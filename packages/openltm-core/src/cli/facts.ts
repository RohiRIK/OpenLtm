/**
 * cli/facts.ts — `ltm facts extract [--project p] [--apply] [--json]`.
 *
 * Without --apply it lists what the extraction rules (facts.ts) find and
 * writes nothing. With --apply it stores them in the global `facts`
 * collection, defining it on first use.
 */
import { applyFacts, scanMemoryFacts } from "../facts.js";

export interface FactsCommandResult {
  exitCode: number;
  output: string;
}

const HELP = [
  "",
  "  ltm facts extract [--project <name>] [--limit <n>] [--apply] [--json]",
  "",
  "  Finds entity / slot / value facts in active memories (ports, pinned",
  "  versions, what a component uses or runs on, preferences, locations,",
  "  dependencies, defaults). Lists them; --apply stores them in the global",
  "  'facts' collection, one record per entity.slot, newest memory wins.",
  "",
].join("\n");

function option(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

export async function runFactsCommand(argv: string[]): Promise<FactsCommandResult> {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) return { exitCode: argv.length === 0 ? 1 : 0, output: HELP };
  if (argv[0] !== "extract") return { exitCode: 1, output: `  ltm facts: unknown command '${argv[0]}'\n${HELP}` };
  const rest = argv.slice(1);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--project" || a === "--limit") { i++; continue; }
    if (a !== "--apply" && a !== "--json") return { exitCode: 1, output: `  ltm facts: unknown option '${a}'\n${HELP}` };
  }
  const limit = option(rest, "--limit") ? Number(option(rest, "--limit")) : undefined;
  if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) return { exitCode: 1, output: "  ltm facts: --limit must be a positive integer" };

  const { waitForInit } = await import("../shared-db.js");
  await waitForInit();
  const candidates = scanMemoryFacts({ project: option(rest, "--project"), limit });
  const json = rest.includes("--json");

  if (!rest.includes("--apply")) {
    if (json) return { exitCode: 0, output: JSON.stringify(candidates, null, 2) };
    if (candidates.length === 0) return { exitCode: 0, output: "  No facts found." };
    const lines = candidates.map((c) => `  [${c.memory_id}] ${c.entity}.${c.slot} = ${c.value}  (${c.rule})`);
    return { exitCode: 0, output: `${lines.join("\n")}\n\n  ${candidates.length} fact(s). Run with --apply to store them in the 'facts' collection.` };
  }
  const r = await applyFacts(candidates);
  if (json) return { exitCode: r.errors.length ? 1 : 0, output: JSON.stringify(r, null, 2) };
  const out = [
    `${r.defined ? "  Defined the 'facts' collection.\n" : ""}  facts: ${r.created} new, ${r.updated} updated, ${r.unchanged} unchanged`,
    ...r.errors.map((e) => `  error: ${e}`),
  ];
  return { exitCode: r.errors.length ? 1 : 0, output: out.join("\n") };
}
