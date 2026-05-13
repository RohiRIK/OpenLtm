import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { writeRegistryAtomic } from "../../hooks/lib/resolveProject.js";

const TEST_DIR = join(tmpdir(), `ltm-registry-lock-test-${process.pid}`);
const REGISTRY = join(TEST_DIR, "registry.json");
const LOCK = REGISTRY + ".lock";

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  // Remove any leftover lock from a previous run
  try { unlinkSync(LOCK); } catch {}
  try { unlinkSync(REGISTRY); } catch {}
});

afterEach(() => {
  try { unlinkSync(LOCK); } catch {}
  try { unlinkSync(REGISTRY); } catch {}
  try { Bun.spawnSync(["rm", "-rf", TEST_DIR]); } catch {}
});

describe("writeRegistryAtomic", () => {
  it("writes JSON atomically", () => {
    const data = { "/foo": "bar" };
    writeRegistryAtomic(REGISTRY, data);
    const read = JSON.parse(readFileSync(REGISTRY, "utf-8"));
    expect(read).toEqual(data);
  });

  it("no lock file remains after successful write", () => {
    writeRegistryAtomic(REGISTRY, {});
    expect(existsSync(LOCK)).toBe(false);
  });

  it("no lock file remains after error inside write", () => {
    // Patch the registry path to a dir so rename fails
    const badRegistry = TEST_DIR; // a directory — rename onto it will fail
    expect(() => writeRegistryAtomic(badRegistry, {})).toThrow();
    expect(existsSync(badRegistry + ".lock")).toBe(false);
  });

  it("reclaims stale lock (older than 5s)", () => {
    // Create a lock file with an old mtime
    writeFileSync(LOCK, "stale");
    const oldDate = new Date(Date.now() - 6000);
    Bun.spawnSync(["touch", "-t", oldDate.toISOString().replace(/[-:T]/g, "").slice(0, 12), LOCK]);
    // Should succeed without throwing
    writeRegistryAtomic(REGISTRY, { stale: true });
    expect(JSON.parse(readFileSync(REGISTRY, "utf-8"))).toEqual({ stale: true });
  });

  it("concurrent writes both succeed (sequential via retry)", async () => {
    const writes = Array.from({ length: 4 }, (_, i) =>
      Promise.resolve().then(() => writeRegistryAtomic(REGISTRY, { writer: i }))
    );
    await Promise.all(writes); // throws if any write fails
    // Final state is one of the valid writes
    const result = JSON.parse(readFileSync(REGISTRY, "utf-8"));
    expect(typeof result.writer).toBe("number");
  });
});
