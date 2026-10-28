/**
 * A WAL database whose last writer closed cleanly has no -shm file. A
 * `{ readonly: true }` connection cannot create it (SQLITE_CANTOPEN), which
 * silently disabled prompt-time injection whenever no other process held the DB.
 */
import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, rmSync } from "fs";
import { searchPromptMemories } from "../../../hooks/lib/promptRecall";
import { initSandboxDb, makeSandbox, seedMemory } from "./hookHarness";

describe("prompt recall on a WAL database with no -shm file", () => {
  it("still finds memories", () => {
    const sb = makeSandbox("prompt-no-shm");
    try {
      initSandboxDb(sb);
      const id = seedMemory(sb, { content: "Payments webhook signatures use HMAC SHA256 before parsing", category: "gotcha", project: "shop" });
      // What a clean last close leaves behind (Homebrew SQLite removes these itself).
      for (const ext of ["-wal", "-shm"]) rmSync(sb.dbPath + ext, { force: true });
      expect(existsSync(sb.dbPath + "-shm")).toBe(false);
      expect(() => new Database(sb.dbPath, { readonly: true }).query("SELECT 1 FROM memories").get()).toThrow();

      const hits = searchPromptMemories(sb.dbPath, { prompt: "how are payments webhook signatures verified?", project: "shop", limit: 5 });
      expect(hits.map((h) => h.id)).toContain(id);
    } finally {
      sb.cleanup();
    }
  });
});
