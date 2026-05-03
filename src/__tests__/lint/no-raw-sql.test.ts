/**
 * Guardrail: hooks/src/*.ts must not contain inline SQL.
 * All DB writes must go through src/dao/ (which uses writeQueue).
 * This test fails if any hook bypasses the DAO layer.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const HOOKS_SRC = join(import.meta.dir, "..", "..", "..", "hooks", "src");

// Only flag write operations — reads are safe without the writeQueue.
// DAO layer guards against concurrent writes; reads are always safe.
const RAW_SQL_PATTERNS = [
  /\bdb\.run\s*\(/,
  /\bdb\.prepare\s*\(.*\)\.run\s*\(/,
  /\bgetDb\(\)\.run\s*\(/,
  /\bgetDb\(\)\.prepare\s*\(/,
];

function getHookFiles(): string[] {
  return readdirSync(HOOKS_SRC)
    .filter(f => f.endsWith(".ts"))
    .map(f => join(HOOKS_SRC, f));
}

describe("no-raw-sql lint gate", () => {
  const hookFiles = getHookFiles();

  for (const filePath of hookFiles) {
    it(`${filePath.split("/").pop()} — no inline SQL`, () => {
      const src = readFileSync(filePath, "utf-8");
      const violations: string[] = [];

      for (const pattern of RAW_SQL_PATTERNS) {
        const lines = src.split("\n");
        lines.forEach((line, i) => {
          if (pattern.test(line)) {
            violations.push(`  line ${i + 1}: ${line.trim()}`);
          }
        });
      }

      if (violations.length > 0) {
        throw new Error(
          `Raw SQL found in ${filePath.split("/").pop()}. Use src/dao/ instead:\n${violations.join("\n")}`
        );
      }
      expect(violations).toHaveLength(0);
    });
  }
});
