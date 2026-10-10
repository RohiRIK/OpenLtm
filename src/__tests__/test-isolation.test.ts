/**
 * The test process itself must not see the real user's config locations: HOME,
 * CLAUDE_CONFIG_DIR and every XDG base dir point inside the temp home
 * (scripts/test-isolated.ts + src/__tests__/setup/isolate-home.ts).
 */
import { describe, expect, it } from "bun:test";
import { realpathSync } from "fs";
import { sep } from "path";

const real = (p: string) => { try { return realpathSync(p); } catch { return p; } };
const inside = (child: string | undefined, parent: string) =>
  !!child && (real(child) === real(parent) || real(child).startsWith(real(parent) + sep));

describe("test environment isolation", () => {
  it("CLAUDE_CONFIG_DIR and the XDG base dirs are inside the isolated HOME", () => {
    const home = process.env.HOME!;
    for (const key of ["CLAUDE_CONFIG_DIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"]) {
      expect({ key, inside: inside(process.env[key], home) }).toEqual({ key, inside: true });
    }
  });
});
