/**
 * Guards the suite-wide HOME isolation (bunfig preload + scripts/test-isolated.ts):
 * no test may resolve ~/.claude to the real user config dir.
 */
import { describe, expect, it } from "bun:test";
import { homedir, tmpdir } from "os";
import { join, sep } from "path";
import { realpathSync } from "fs";

const real = (p: string) => { try { return realpathSync(p); } catch { return p; } };
const under = (child: string, parent: string) =>
  real(child) === real(parent) || real(child).startsWith(real(parent) + sep);

describe("test HOME isolation", () => {
  it("os.homedir() is the isolated HOME", () => {
    expect(process.env.HOME).toBeTruthy();
    expect(real(homedir())).toBe(real(process.env.HOME!));
  });

  it("HOME is a temp dir, not the real home", () => {
    const wrapperHome = process.env.LTM_TEST_ISOLATED_HOME;
    if (wrapperHome) expect(real(homedir())).toBe(real(wrapperHome));
    else expect(under(homedir(), tmpdir())).toBe(true);

    const realHome = process.env.LTM_TEST_REAL_HOME;
    if (realHome) {
      expect(real(homedir())).not.toBe(real(realHome));
      expect(under(join(homedir(), ".claude"), join(realHome, ".claude"))).toBe(false);
    }
  });

  it("CLAUDE_CONFIG_DIR lives inside the isolated HOME", () => {
    expect(process.env.CLAUDE_CONFIG_DIR).toBeTruthy();
    expect(under(process.env.CLAUDE_CONFIG_DIR!, homedir())).toBe(true);
  });
});
