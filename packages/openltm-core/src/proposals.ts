/**
 * proposals.ts — Review interface for memory proposals written by EvaluateSession.
 *
 * Proposals live as JSON files in ${CLAUDE_PLUGIN_DATA}/proposals/<session-id>.json.
 * Each file: { proposals: MemoryProposal[], generatedAt: number }
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { learn } from "./db.js";
import type { MemoryCategory } from "./db.js";

interface MemoryProposal {
  content: string;
  category: string;
  importance: number;
  source: string;
}

interface ProposalFile {
  proposals: MemoryProposal[];
  generatedAt: number;
}

export interface PendingProposal {
  sessionId: string;
  index: number;
  content: string;
  category: string;
  importance: number;
  source: string;
  generatedAt: number;
}

function getProposalsDir(): string {
  const base = process.env.CLAUDE_PLUGIN_DATA
    ?? join(homedir(), ".claude", "plugins", "data", "OpenLtm-openltm");
  return join(base, "proposals");
}

function readProposalFile(path: string): ProposalFile | null {
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as ProposalFile;
    if (!Array.isArray(parsed.proposals)) return null;
    return parsed;
  } catch {
    return null; // silent: malformed or missing file
  }
}

export function listPendingProposals(): PendingProposal[] {
  const dir = getProposalsDir();
  if (!existsSync(dir)) return [];

  const results: PendingProposal[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const sessionId = file.replace(/\.json$/, "");
    const data = readProposalFile(join(dir, file));
    if (!data) continue;
    for (let i = 0; i < data.proposals.length; i++) {
      const p = data.proposals[i]!;
      results.push({
        sessionId,
        index: i,
        content: p.content,
        category: p.category,
        importance: p.importance,
        source: p.source,
        generatedAt: data.generatedAt,
      });
    }
  }
  return results.sort((a, b) => b.importance - a.importance || b.generatedAt - a.generatedAt);
}

export function acceptProposal(sessionId: string, index: number): boolean {
  const dir = getProposalsDir();
  const filePath = join(dir, `${sessionId}.json`);
  const data = readProposalFile(filePath);
  if (!data) return false;

  const proposal = data.proposals[index];
  if (!proposal) return false;

  learn({
    content: proposal.content,
    category: proposal.category as MemoryCategory,
    importance: proposal.importance,
    source: proposal.source,
    skipExport: true,
  });

  // Remove the accepted proposal from the file; delete file if empty
  const remaining = data.proposals.filter((_, i) => i !== index);
  if (remaining.length === 0) {
    try { unlinkSync(filePath); } catch {}
  } else {
    writeFileSync(filePath, JSON.stringify({ ...data, proposals: remaining }, null, 2), "utf-8");
  }
  return true;
}

export function rejectProposal(sessionId: string, index: number): boolean {
  const dir = getProposalsDir();
  const filePath = join(dir, `${sessionId}.json`);
  const data = readProposalFile(filePath);
  if (!data) return false;

  if (index < 0 || index >= data.proposals.length) return false;

  const remaining = data.proposals.filter((_, i) => i !== index);
  if (remaining.length === 0) {
    try { unlinkSync(filePath); } catch {}
  } else {
    writeFileSync(filePath, JSON.stringify({ ...data, proposals: remaining }, null, 2), "utf-8");
  }
  return true;
}
