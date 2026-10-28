/**
 * facts.ts — Pull entity / slot / value facts out of prose memories.
 *
 * memvid extracts subject-predicate-object "memory cards" with regex rules at
 * ingest. Here the same idea feeds an agent-visible collection: a fixed set of
 * English patterns ("X listens on port N", "X is pinned to vN", "X uses Y",
 * "prefer X over Y", "X lives in <path>", "X depends on Y", "the default X is
 * Y") turns sentences into records of a global `facts` collection keyed by
 * entity.slot, so `record query facts where slot = port` answers what prose
 * recall can only hint at.
 *
 * Deterministic and conservative: a rule fires only on its exact shape, no
 * model is called, and nothing is written unless the owner runs
 * `ltm facts extract --apply`. Memories are applied oldest first, so when two
 * memories set the same entity.slot the newest wins, and each record links the
 * memory it came from (memory_id).
 */
import type { Database } from "bun:sqlite";
import { getDb } from "./shared-db.js";
import type { MemoryOrigin } from "./origin.js";

export interface Fact {
  entity: string;
  slot: string;
  value: string;
  /** Which rule matched (for review). */
  rule: string;
}

export const FACTS_COLLECTION = "facts";

export const FACTS_FIELDS = [
  { name: "fact_key", type: "string", required: true, description: "entity.slot; one record per key, newest memory wins" },
  { name: "entity", type: "string", required: true, description: "What the fact is about, lowercase" },
  { name: "slot", type: "string", required: true, description: "The attribute: port, pinned_version, uses, runs_on, language, location, depends_on, default, prefer_over_<x>" },
  { name: "value", type: "string", required: true },
  { name: "rule", type: "string", required: true, searchable: false, description: "Extraction rule that produced it" },
] as const;

const NAME = String.raw`[A-Za-z@][\w.+/@-]*?(?:[ -][A-Za-z][\w.+-]*?){0,3}?`;
const VALUE = String.raw`[\w.+#/@:~-]+?(?: [\w.+#/@:~-]+?){0,2}?`;
const END = String.raw`(?=[.,;:!?)]|\s+(?:for|to|instead|with|and|so|because|when|in|on|since|after|before|by)\b|\s*$)`;

interface Rule {
  id: string;
  re: RegExp;
  build: (m: RegExpExecArray) => Omit<Fact, "rule"> | null;
}

const RULES: Rule[] = [
  {
    id: "port",
    re: new RegExp(String.raw`\b(?:the )?(${NAME}) (?:listens on(?: port)?|runs on port|is served on port|served on port|is exposed on port|serves on port|is reachable on port) (\d{2,5})\b`, "gi"),
    build: (m) => ({ entity: m[1]!, slot: "port", value: m[2]! }),
  },
  {
    id: "pinned",
    re: new RegExp(String.raw`\b(?:the )?(${NAME}) (?:is |are |stays |stay )?pinned (?:to|at) (v?\d+(?:\.\d+){0,3}[\w.-]*)`, "gi"),
    build: (m) => ({ entity: m[1]!, slot: "pinned_version", value: m[2]! }),
  },
  {
    id: "uses",
    re: new RegExp(String.raw`\b(?:the )?(${NAME}) (uses|use|runs on|run on|is built with|are built with|is written in|are written in) (${VALUE})${END}`, "gi"),
    build: (m) => (/^port\b/i.test(m[3]!) ? null : {
      entity: m[1]!,
      slot: ({ uses: "uses", use: "uses", "runs on": "runs_on", "run on": "runs_on", "is built with": "uses", "are built with": "uses", "is written in": "language", "are written in": "language" } as Record<string, string>)[m[2]!.toLowerCase()]!,
      value: m[3]!,
    }),
  },
  {
    id: "prefer",
    re: new RegExp(String.raw`\bprefer (${VALUE}) (?:over|to|instead of) (${VALUE})${END}`, "gi"),
    build: (m) => ({ entity: "owner", slot: `prefer_over_${slug(m[2]!)}`, value: m[1]! }),
  },
  {
    id: "use-instead",
    re: new RegExp(String.raw`\b(?:we |always )?use (${VALUE}) (?:instead of|rather than) (${VALUE})${END}`, "gi"),
    build: (m) => ({ entity: "owner", slot: `prefer_over_${slug(m[2]!)}`, value: m[1]! }),
  },
  {
    id: "location",
    re: new RegExp(String.raw`\b(?:the )?(${NAME}) (?:lives?|is stored|are stored|is located|are located|is kept|are kept) (?:in|at|under) ([\w./~-]*[/.][\w./~-]*)`, "gi"),
    build: (m) => ({ entity: m[1]!, slot: "location", value: m[2]!.replace(/\.$/, "") }),
  },
  {
    id: "depends",
    re: new RegExp(String.raw`\b(?:the )?(${NAME}) depends on (${VALUE})${END}`, "gi"),
    build: (m) => ({ entity: m[1]!, slot: "depends_on", value: m[2]! }),
  },
  {
    id: "default",
    re: new RegExp(String.raw`\b(?:the )?default ([a-z][\w-]*(?: [a-z][\w-]*){0,2}) (?:is|=) (${VALUE})${END}`, "gi"),
    build: (m) => ({ entity: "defaults", slot: slug(m[1]!), value: m[2]! }),
  },
];

/** Words that make a bad entity: pronouns and fillers a rule can catch at sentence start. */
const STOP_ENTITIES = new Set(["it", "this", "that", "we", "you", "they", "he", "she", "one", "which", "who", "everything", "nothing", "something", "always", "never", "also", "now"]);

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
}

function cleanEntity(s: string): string {
  // "move the badger api" (lead-in caught by the regex) -> "badger api": keep what follows the last article.
  const parts = s.toLowerCase().replace(/\s+/g, " ").trim().split(/\b(?:the|our|a|an) /);
  return parts[parts.length - 1]!.trim();
}

/** Every fact the rules find in `text`, de-duplicated by entity.slot (last match wins). */
export function extractFacts(text: string): Fact[] {
  const out = new Map<string, Fact>();
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    for (let m = rule.re.exec(text); m; m = rule.re.exec(text)) {
      const f = rule.build(m);
      if (!f) continue;
      const entity = cleanEntity(f.entity);
      const value = f.value.trim().replace(/^(?:the|a|an)\s+/i, "").replace(/[.,;:]+$/, "");
      if (!entity || STOP_ENTITIES.has(entity) || !value || value.length > 200) continue;
      if (STOP_ENTITIES.has(value.toLowerCase())) continue;
      out.set(`${entity}.${f.slot}`, { entity, slot: f.slot, value, rule: rule.id });
    }
  }
  return [...out.values()];
}

export interface FactCandidate extends Fact {
  memory_id: number;
  origin: MemoryOrigin | null;
}

/** Facts from active memories (one project plus globals, or all), oldest memory first. Reads only. */
export function scanMemoryFacts(opts: { project?: string; limit?: number } = {}, db: Database = getDb()): FactCandidate[] {
  const where = opts.project ? "AND (project_scope = ? OR project_scope IS NULL)" : "";
  const params = opts.project ? [opts.project] : [];
  const rows = db.query<{ id: number; content: string; origin: MemoryOrigin | null }, string[]>(
    `SELECT id, content, origin FROM memories WHERE status = 'active' ${where} ORDER BY created_at ASC, id ASC LIMIT ${Math.max(1, Math.min(opts.limit ?? 5000, 50_000))}`,
  ).all(...params);
  return rows.flatMap((r) => extractFacts(r.content).map((f) => ({ ...f, memory_id: r.id, origin: r.origin })));
}

export interface ApplyFactsResult {
  defined: boolean;
  created: number;
  updated: number;
  unchanged: number;
  errors: string[];
}

/** Write candidates to the global `facts` collection (defined on first use). Newest memory per key wins. */
export async function applyFacts(candidates: FactCandidate[], db: Database = getDb()): Promise<ApplyFactsResult> {
  const { defineCollection, putRecord, resolveCollection, getRecord } = await import("./collections/store.js");
  const result: ApplyFactsResult = { defined: false, created: 0, updated: 0, unchanged: 0, errors: [] };
  if (!resolveCollection(FACTS_COLLECTION, null, db)) {
    defineCollection({
      name: FACTS_COLLECTION,
      description: "Entity / slot / value facts extracted from memories by `ltm facts extract` (newest memory per entity.slot wins)",
      fields: FACTS_FIELDS,
      key_field: "fact_key",
      origin: "agent-observation",
      created_by: "ltm:facts",
      force: true,
    }, db);
    result.defined = true;
  }
  // Last candidate per key = newest memory (scan is oldest first).
  const latest = new Map<string, FactCandidate>();
  for (const c of candidates) latest.set(`${c.entity}.${c.slot}`, c);
  for (const [key, c] of latest) {
    const data = { fact_key: key, entity: c.entity, slot: c.slot, value: c.value, rule: c.rule };
    try {
      const before = getRecord(FACTS_COLLECTION, { key }, null, db);
      if (before && before.data.value === c.value && before.memory_id === c.memory_id) { result.unchanged++; continue; }
      const r = putRecord({
        collection: FACTS_COLLECTION, data,
        origin: c.origin ?? "agent-observation",
        created_by: "ltm:facts", memory_id: c.memory_id,
      }, db);
      if (r.created) result.created++; else result.updated++;
    } catch (err) {
      result.errors.push(`${key}: ${(err as Error).message}`);
    }
  }
  return result;
}
