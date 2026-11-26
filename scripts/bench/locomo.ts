#!/usr/bin/env bun
/**
 * bench/locomo.ts — reproducible retrieval benchmark on LoCoMo.
 *
 * LoCoMo (Maharana et al. 2024, snap-research/locomo) is 10 long conversations
 * with ~2,000 questions, each labelled with the dialogue turns that hold the
 * answer. This script stores every turn as a memory (one project per
 * conversation, the session date as occurred_at), asks each question through
 * core recall(), and scores whether the evidence turns come back.
 *
 * It measures retrieval only: no LLM answers, no LLM judge, nothing paid, so
 * two runs on the same commit give the same numbers. Adversarial questions
 * (category 5, no answer in the conversation) are skipped.
 *
 * The dataset (CC BY-NC 4.0) is not in this repo. It is downloaded once to
 * ~/.cache/openltm-bench/ and checked against a pinned SHA-256.
 *
 * Usage (repo root):
 *   bun run bench:locomo                       # FTS only, k=10, fixed + adaptive
 *   bun run bench:locomo -- --k 5 --convs 2    # quicker
 *   bun run bench:locomo -- --semantic         # hybrid; needs a running embedding server
 *   bun run bench:locomo -- --data ./locomo10.json --json
 */
import { createHash } from "crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";

const DATA_URL = "https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json";
const DATA_SHA256 = "79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4";
const CATEGORY_NAMES: Record<number, string> = { 1: "multi-hop", 2: "temporal", 3: "open-domain", 4: "single-hop" };

interface Turn { speaker: string; dia_id: string; text: string; blip_caption?: string }
interface Qa { question: string; evidence?: string[]; category: number }
interface Sample { sample_id: string; conversation: Record<string, unknown>; qa: Qa[] }

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function loadDataset(path: string | undefined): Promise<Sample[]> {
  let file = path;
  if (!file) {
    const dir = join(homedir(), ".cache", "openltm-bench");
    file = join(dir, "locomo10.json");
    if (!existsSync(file)) {
      mkdirSync(dir, { recursive: true });
      process.stderr.write(`[bench] downloading ${DATA_URL}\n`);
      const res = await fetch(DATA_URL);
      if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    }
  }
  const bytes = readFileSync(file);
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== DATA_SHA256 && !flag("allow-other-data")) {
    throw new Error(`${file} has SHA-256 ${sha}, expected ${DATA_SHA256}. The upstream file changed; pass --allow-other-data to run anyway (numbers are then not comparable).`);
  }
  return JSON.parse(bytes.toString("utf-8")) as Sample[];
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "1:56 pm on 8 May, 2023" → "2023-05-08 13:56:00". */
export function parseSessionDate(s: string): string | undefined {
  const m = /(\d{1,2}):(\d{2})\s*(am|pm)\s+on\s+(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})/i.exec(s);
  if (!m) return undefined;
  const month = MONTHS.indexOf(m[5]!.toLowerCase());
  if (month < 0) return undefined;
  let hour = Number(m[1]) % 12;
  if (m[3]!.toLowerCase() === "pm") hour += 12;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${m[6]}-${pad(month + 1)}-${pad(Number(m[4]))} ${pad(hour)}:${m[2]}:00`;
}

/** Evidence ids, normalised: "D8:6; D9:17" → ["D8:6", "D9:17"]; malformed ids are dropped. */
export function evidenceIds(qa: Qa): string[] {
  return (qa.evidence ?? []).flatMap((e) => e.split(/[;,\s]+/)).filter((e) => /^D\d+:\d+$/.test(e));
}

function turns(sample: Sample): Array<Turn & { date?: string }> {
  const out: Array<Turn & { date?: string }> = [];
  for (let i = 1; ; i++) {
    const session = sample.conversation[`session_${i}`] as Turn[] | undefined;
    if (!session) break;
    const date = parseSessionDate(String(sample.conversation[`session_${i}_date_time`] ?? ""));
    for (const t of session) out.push({ ...t, date });
  }
  return out;
}

interface Score { questions: number; evidence: number; found: number; hits: number; returned: number }
const empty = (): Score => ({ questions: 0, evidence: 0, found: 0, hits: 0, returned: 0 });

async function main(): Promise<void> {
  const k = Number(arg("k") ?? 10);
  const maxConvs = Number(arg("convs") ?? Infinity);
  const semantic = flag("semantic");
  const data = await loadDataset(arg("data"));

  const tmp = mkdtempSync(join(tmpdir(), "ltm-locomo-"));
  process.env.LTM_DB_PATH = join(tmp, "bench.db");
  if (!semantic) process.env.LTM_EMBED_PROVIDER = "disabled";
  const core = await import("../../packages/openltm-core/src/index.js");
  const { waitForInit, getDb } = await import("../../packages/openltm-core/src/shared-db.js");
  await waitForInit();
  const db = getDb();

  const variants = { fixed: { adaptive: false }, adaptive: { adaptive: true } } as const;
  const scores: Record<keyof typeof variants, Record<string, Score>> = { fixed: {}, adaptive: {} };
  const started = Date.now();
  let memories = 0;

  try {
    for (const sample of data.slice(0, maxConvs)) {
      const project = `locomo-${sample.sample_id}`;
      const idToDia = new Map<number, string>();
      const insert = db.prepare(
        `INSERT INTO memories (content, title, category, project_scope, dedup_key, occurred_at, source, origin)
         VALUES (?, ?, 'pattern', ?, ?, ?, 'bench:locomo', 'external-source')`,
      );
      db.transaction(() => {
        for (const t of turns(sample)) {
          const content = `${t.speaker}: ${t.text}${t.blip_caption ? ` (shares an image: ${t.blip_caption})` : ""}`;
          const r = insert.run(content, content.slice(0, 60), project, `${project}:${t.dia_id}`, t.date ?? null);
          idToDia.set(Number(r.lastInsertRowid), t.dia_id);
        }
      })();
      memories += idToDia.size;
      if (semantic) {
        const { backfill } = await import("../../packages/openltm-core/src/embeddings.js");
        await backfill(db);
      }

      for (const qa of sample.qa) {
        const cat = CATEGORY_NAMES[qa.category];
        const evidence = evidenceIds(qa);
        if (!cat || evidence.length === 0) continue;
        for (const [name, opts] of Object.entries(variants) as Array<[keyof typeof variants, { adaptive: boolean }]>) {
          const hits = await core.recall({ query: qa.question, project, limit: k, semantic, adaptive: opts.adaptive });
          // Recall bumps recall_count, which feeds ranking: undo it so question order cannot matter.
          if (hits.length > 0) {
            db.run(`UPDATE memories SET recall_count = 0, last_recalled_at = NULL, first_recalled_at = NULL WHERE id IN (${hits.map(() => "?").join(",")})`, hits.map((h) => h.id));
          }
          const got = new Set(hits.map((h) => idToDia.get(h.id)));
          const found = evidence.filter((e) => got.has(e)).length;
          for (const key of [cat, "all"]) {
            const s = (scores[name][key] ??= empty());
            s.questions++;
            s.evidence += evidence.length;
            s.found += found;
            s.hits += found > 0 ? 1 : 0;
            s.returned += hits.length;
          }
        }
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  const rows = ["all", ...Object.values(CATEGORY_NAMES)].filter((c) => scores.fixed[c]);
  const pct = (n: number, d: number) => (d === 0 ? "-" : `${((100 * n) / d).toFixed(1)}%`);
  const report = {
    dataset: { url: DATA_URL, sha256: DATA_SHA256, conversations: Math.min(data.length, maxConvs), memories },
    k, semantic, seconds: Math.round((Date.now() - started) / 1000),
    results: Object.fromEntries((Object.keys(variants) as Array<keyof typeof variants>).map((v) => [v, Object.fromEntries(rows.map((c) => {
      const s = scores[v][c]!;
      return [c, { questions: s.questions, evidence_recall: s.found / s.evidence, hit_rate: s.hits / s.questions, avg_returned: s.returned / s.questions }];
    }))])),
  };
  if (flag("json")) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return;
  }
  const lines = [
    `LoCoMo retrieval — ${report.dataset.conversations} conversations, ${memories} turns, k=${k}, ${semantic ? "hybrid (FTS + vectors)" : "full-text only"}, ${report.seconds}s`,
    "",
    "| category | questions | evidence recall@k (fixed) | hit@k (fixed) | evidence recall (adaptive) | hit (adaptive) | avg returned (adaptive) |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((c) => {
      const f = scores.fixed[c]!;
      const a = scores.adaptive[c]!;
      return `| ${c} | ${f.questions} | ${pct(f.found, f.evidence)} | ${pct(f.hits, f.questions)} | ${pct(a.found, a.evidence)} | ${pct(a.hits, a.questions)} | ${(a.returned / a.questions).toFixed(1)} |`;
    }),
  ];
  process.stdout.write(lines.join("\n") + "\n");
}

if (import.meta.main) {
  main().catch((err) => {
    process.stderr.write(`[bench] ${(err as Error).message}\n`);
    process.exit(1);
  });
}
