/**
 * promptRecall.ts — FTS-only memory lookup for the UserPromptSubmit hook.
 *
 * Runs on every prompt, so it stays off the heavy paths on purpose:
 *   - never imports @rohirik/openltm-core (module graph + sqlite-vec/Honker probing)
 *   - opens the DB read-only and never writes (no recall_count bumps, no migrations)
 *   - never calls an embedding provider (no network in the prompt hot path)
 *
 * Filters mirror core recall(): status = 'active' and project_scope NULL-or-current.
 * Stale-flagged memories are skipped as well — recall() only demotes them, but an
 * unprompted injection should not surface knowledge a commit already invalidated.
 */
import { Database } from "bun:sqlite";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { Config } from "../../src/config.js";

export const MIN_PROMPT_CHARS = 15;
export const MAX_CONTENT_CHARS = 200;
export const DEFAULT_PROMPT_RECALL_LIMIT = 5;
const MAX_PROMPT_RECALL_LIMIT = 20;
const MAX_QUERY_TOKENS = 12;
const CANDIDATE_LIMIT = 40;
/**
 * FTS5 bm25 rank (negative; lower = better) strong enough to accept a row that
 * matched only one query token. Roughly "a term found in <1% of a ~1k-row corpus";
 * small corpora never reach it, so they need two matching tokens.
 */
export const STRONG_RANK = -5;

// Common English + conversational filler. Dropped before building the FTS query
// so "can you please fix the hook" searches for "fix" and "hook" only.
const STOPWORDS = new Set(
  (
    "a about above after again against all also am an and any are aren as at be because been before being below " +
    "between both but by can cannot could couldn did didn do does doesn doing don done down during each else etc " +
    "even ever every few for from further get gets getting go goes going gonna got had hadn has hasn have haven having " +
    "he her here hers herself him himself his how however i if in into is isn it its itself just let lets like make " +
    "makes me might more most much must my myself need needs no nor not now of off ok okay on once one only or other " +
    "our ours ourselves out over own please pls really same see should shouldn so some something such sure than thank " +
    "thanks that the their theirs them themselves then there these they thing things this those through thx to too try " +
    "under until up us use used using very via want wanna was wasn way we were weren what whats when where whether " +
    "which while who whom why will with won would wouldn yeah yes yet you your yours yourself yourselves hey hi hello"
  ).split(" "),
);

export interface PromptHit {
  id: number;
  category: string;
  content: string;
  project_scope: string | null;
  rank: number;
}

// ── Skip rules ────────────────────────────────────────────────────────────────

/** Why the hook should not run for this prompt, or null to proceed. */
export function promptSkipReason(prompt: string, cfg: Partial<Config>): string | null {
  if (cfg.ltm?.autoRecall === false) return "autoRecall disabled";
  if (cfg.ltm?.promptRecall === false) return "promptRecall disabled";
  const text = prompt.trim();
  if (text.startsWith("/")) return "slash command";
  if (text.length < MIN_PROMPT_CHARS) return "prompt too short";
  return null;
}

/** ltm.promptRecallLimit, clamped to 1..20 (default 5). */
export function promptRecallLimit(cfg: Partial<Config>): number {
  const n = cfg.ltm?.promptRecallLimit;
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULT_PROMPT_RECALL_LIMIT;
  return Math.min(MAX_PROMPT_RECALL_LIMIT, Math.max(1, Math.floor(n)));
}

// ── Tokenisation (mirrors FTS5 unicode61: alnum runs, case- and diacritic-folded) ──

export function tokenize(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Distinct, non-stopword query tokens from the prompt, in prompt order. */
export function queryTokens(prompt: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tokenize(prompt)) {
    if (t.length < 2 || STOPWORDS.has(t) || /^\d{1,2}$/.test(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_QUERY_TOKENS) break;
  }
  return out;
}

// ── Search ────────────────────────────────────────────────────────────────────

export function searchPromptMemories(
  dbPath: string,
  opts: { prompt: string; project: string | null; limit: number; exclude?: ReadonlySet<number> },
): PromptHit[] {
  const tokens = queryTokens(opts.prompt);
  if (tokens.length === 0 || !existsSync(dbPath)) return [];

  let db: Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
    // Tokens are alnum-only, so quoting is enough to neutralise FTS5 syntax
    // (AND/OR/NEAR, column filters). OR keeps partial matches; the
    // per-row token count below restores precision.
    const match = tokens.map(t => `"${t}"`).join(" OR ");
    const rows = db.query<PromptHit & { title: string }, [string, string | null]>(
      `SELECT m.id AS id, m.category AS category, m.content AS content,
              m.project_scope AS project_scope, coalesce(m.title, '') AS title, f.rank AS rank
         FROM memories_fts f
         JOIN memories m ON m.id = f.rowid
        WHERE memories_fts MATCH ?
          AND m.status = 'active'
          AND m.stale_flagged_at IS NULL
          AND (m.project_scope IS NULL OR m.project_scope = ?)
        ORDER BY f.rank
        LIMIT ${CANDIDATE_LIMIT}`,
    ).all(match, opts.project);

    const minMatches = Math.min(2, tokens.length);
    const hits: PromptHit[] = [];
    for (const row of rows) {
      if (opts.exclude?.has(row.id)) continue;
      const words = new Set(tokenize(`${row.title} ${row.content}`));
      const matched = tokens.reduce((n, t) => n + (words.has(t) ? 1 : 0), 0);
      if (matched < minMatches && row.rank > STRONG_RANK) continue;
      hits.push({ id: row.id, category: row.category, content: row.content, project_scope: row.project_scope, rank: row.rank });
      if (hits.length >= opts.limit) break;
    }
    return hits;
  } catch (err) {
    // Old schema / locked / corrupt DB: prompt recall is best-effort, stay silent.
    process.stderr.write(`[promptRecall] ${err}\n`);
    return [];
  } finally {
    try { db?.close(); } catch { /* already closed */ }
  }
}

// ── Output ────────────────────────────────────────────────────────────────────

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= MAX_CONTENT_CHARS ? flat : `${flat.slice(0, MAX_CONTENT_CHARS - 1)}…`;
}

export function formatPromptRecall(hits: PromptHit[]): string {
  if (hits.length === 0) return "";
  const lines = ["LTM (relevant to this prompt):"];
  for (const h of hits) lines.push(`- [${h.id}] (${h.category}) ${clip(h.content)}`);
  return lines.join("\n") + "\n";
}

// ── Per-session dedupe state ──────────────────────────────────────────────────
// Shared with SessionStart, which records the IDs it injects so a prompt never
// repeats a memory already in context.

export function promptRecallStatePath(sessionId: string): string {
  return join(tmpdir(), `ltm-prompt-recall-${sessionId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
}

export function readInjectedIds(sessionId: string | undefined): Set<number> {
  if (!sessionId) return new Set();
  try {
    const parsed = JSON.parse(readFileSync(promptRecallStatePath(sessionId), "utf-8")) as { ids?: unknown };
    return new Set(Array.isArray(parsed.ids) ? parsed.ids.filter((n): n is number => typeof n === "number") : []);
  } catch {
    return new Set(); // absent or malformed — nothing injected yet
  }
}

/** Add IDs to the session's injected set; `reset` starts a fresh set (new context window). */
export function recordInjectedIds(sessionId: string | undefined, ids: number[], opts: { reset?: boolean } = {}): void {
  if (!sessionId) return;
  try {
    const all = opts.reset ? new Set<number>() : readInjectedIds(sessionId);
    for (const id of ids) all.add(id);
    writeFileSync(promptRecallStatePath(sessionId), JSON.stringify({ ids: [...all] }));
  } catch {
    // tmp not writable — dedupe degrades to per-prompt, never fail the hook
  }
}
