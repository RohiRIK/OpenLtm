import { describe, it, expect, beforeEach } from "bun:test";

import { WriteQueue } from "@rohirik/openltm-core";
function makeDb() {
  const calls: string[] = [];
  return {
    calls,
    exec: (sql: string) => { calls.push(sql.trim()); },
    run: (_sql: string, _params?: unknown[]) => {},
  } as unknown as import("bun:sqlite").Database & { calls: string[] };
}

describe("WriteQueue", () => {
  let q: WriteQueue;

  beforeEach(() => { q = new WriteQueue(); });

  it("calls fn without wrapping when no db provided", async () => {
    let called = false;
    await q.enqueue(() => { called = true; });
    expect(called).toBe(true);
  });

  it("wraps fn in BEGIN IMMEDIATE / COMMIT when db provided", async () => {
    const db = makeDb();
    await q.enqueue(() => { db.run("INSERT INTO t VALUES (1)"); }, db);
    expect(db.calls[0]).toBe("BEGIN IMMEDIATE");
    expect(db.calls[1]).toBe("COMMIT");
  });

  it("ROLLBACKs and rethrows on fn error", async () => {
    const db = makeDb();
    await expect(
      q.enqueue(() => { throw new Error("boom"); }, db)
    ).rejects.toThrow("boom");
    expect(db.calls[0]).toBe("BEGIN IMMEDIATE");
    expect(db.calls[1]).toBe("ROLLBACK");
  });

  it("serialises concurrent enqueues — no interleaving", async () => {
    const db = makeDb();
    const log: string[] = [];
    const p1 = q.enqueue(async () => {
      log.push("fn1-start");
      await new Promise(r => setTimeout(r, 5));
      log.push("fn1-end");
    }, db);
    const p2 = q.enqueue(() => { log.push("fn2"); }, db);
    await Promise.all([p1, p2]);
    expect(log).toEqual(["fn1-start", "fn1-end", "fn2"]);
  });

  it("queue continues after a rollback", async () => {
    const db = makeDb();
    await q.enqueue(() => { throw new Error("first fails"); }, db).catch(() => {});
    const result = await q.enqueue(() => 42, db);
    expect(result).toBe(42);
    expect(db.calls.at(-2)).toBe("BEGIN IMMEDIATE");
    expect(db.calls.at(-1)).toBe("COMMIT");
  });
});
