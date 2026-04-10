import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { unlinkSync } from "fs";

const dbPath = `/tmp/test-ltm-mcp-tools-${Date.now()}.db`;

// Must set env BEFORE any dynamic import that triggers getDb()
process.env.LTM_DB_PATH = dbPath;

let learn: (input: import("../db.js").LearnInput) => import("../db.js").LearnResult;
let recall: (input?: import("../db.js").RecallInput) => Promise<import("../db.js").MemoryWithRelations[]>;
let forget: (input: { id: number; reason?: string; skipExport?: boolean }) => void;
let relate: (input: { source_id: number; target_id: number; relationship_type: import("../db.js").RelationshipType }) => void;
let getContextMerge: (project: string) => { globals: import("../db.js").Memory[]; scoped: import("../db.js").Memory[] };

beforeAll(async () => {
  const db = await import("../db.js");
  learn = db.learn;
  recall = db.recall;
  forget = db.forget;
  relate = db.relate;
  getContextMerge = db.getContextMerge;
});

afterAll(() => {
  try { unlinkSync(dbPath); } catch {}
});

describe("learn()", () => {
  it("stores a memory and returns action=created, id, confirm_count=1", () => {
    const result = learn({
      content: "Always use bun instead of npm in this project",
      category: "preference",
      importance: 3,
      skipExport: true,
    });
    expect(result.action).toBe("created");
    expect(typeof result.id).toBe("number");
    expect(result.id).toBeGreaterThan(0);
    expect(result.confirm_count).toBe(1);
  });

  it("reinforces a duplicate memory (dedup_key match)", () => {
    // Same content → dedup
    const r1 = learn({ content: "Use strict TypeScript everywhere", category: "pattern", importance: 4, skipExport: true });
    const r2 = learn({ content: "Use strict TypeScript everywhere", category: "pattern", importance: 4, skipExport: true });
    expect(r1.action).toBe("created");
    expect(r2.action).toBe("reinforced");
    expect(r2.id).toBe(r1.id);
    expect(r2.confirm_count).toBeGreaterThan(1);
  });
});

describe("recall()", () => {
  it("returns a Promise", () => {
    const result = recall({ query: "bun" });
    expect(result).toBeInstanceOf(Promise);
  });

  it("finds a stored memory by keyword", async () => {
    learn({ content: "recall-test-unique-xyz-keyword", category: "gotcha", importance: 2, skipExport: true });
    const results = await recall({ query: "recall-test-unique-xyz-keyword" });
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain("recall-test-unique-xyz-keyword");
  });

  it("returns empty array when nothing matches", async () => {
    const results = await recall({ query: "zzz-no-match-ever-9999" });
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(0);
  });

  it("results include tags and relations arrays", async () => {
    const results = await recall({ query: "bun" });
    if (results.length > 0) {
      expect(Array.isArray(results[0].tags)).toBe(true);
      expect(Array.isArray(results[0].relations)).toBe(true);
    }
  });
});

describe("forget()", () => {
  it("deletes a memory so recall returns empty", async () => {
    const { id } = learn({ content: "forget-me-now-unique-abc", category: "pattern", importance: 1, skipExport: true });
    const before = await recall({ query: "forget-me-now-unique-abc" });
    expect(before.length).toBeGreaterThan(0);

    forget({ id, skipExport: true });

    const after = await recall({ query: "forget-me-now-unique-abc" });
    expect(after.length).toBe(0);
  });

  it("throws when memory id does not exist", () => {
    expect(() => forget({ id: 999999, skipExport: true })).toThrow();
  });
});

describe("relate()", () => {
  it("links two memory IDs without throwing", () => {
    const a = learn({ content: "relate-source-memory-unique", category: "architecture", importance: 3, skipExport: true });
    const b = learn({ content: "relate-target-memory-unique", category: "architecture", importance: 3, skipExport: true });
    expect(() => relate({ source_id: a.id, target_id: b.id, relationship_type: "supports" })).not.toThrow();
  });

  it("throws when source memory does not exist", () => {
    const b = learn({ content: "relate-orphan-target-unique", category: "gotcha", importance: 2, skipExport: true });
    expect(() => relate({ source_id: 999998, target_id: b.id, relationship_type: "related_to" })).toThrow();
  });
});

describe("getContextMerge()", () => {
  it("returns { globals, scoped } shape", () => {
    const result = getContextMerge("test-project");
    expect(result).toHaveProperty("globals");
    expect(result).toHaveProperty("scoped");
    expect(Array.isArray(result.globals)).toBe(true);
    expect(Array.isArray(result.scoped)).toBe(true);
  });

  it("scoped includes project-scoped memories with importance >= 3", () => {
    learn({
      content: "context-merge-scoped-memory-unique",
      category: "pattern",
      importance: 4,
      project_scope: "ctx-merge-project",
      skipExport: true,
    });
    const result = getContextMerge("ctx-merge-project");
    const found = result.scoped.find(m => m.content.includes("context-merge-scoped-memory-unique"));
    expect(found).toBeDefined();
  });

  it("globals includes global memories with importance >= 4", () => {
    learn({
      content: "global-high-importance-memory-unique",
      category: "architecture",
      importance: 5,
      project_scope: null as unknown as string,
      skipExport: true,
    });
    const result = getContextMerge("any-project");
    const found = result.globals.find(m => m.content.includes("global-high-importance-memory-unique"));
    expect(found).toBeDefined();
  });
});
