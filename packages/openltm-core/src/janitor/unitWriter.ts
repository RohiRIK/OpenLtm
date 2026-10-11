/**
 * janitor/unitWriter.ts — Safe writer for `ltm janitor schedule --write`.
 *
 * Unit files live in user-owned config dirs (~/.config/systemd/user,
 * ~/Library/LaunchAgents), so the writer must never clobber something the
 * user owns or follow a planted link:
 *
 *   - Preflight every target with lstat (no follow) BEFORE writing anything.
 *     A symlink, or anything that is not a regular file, is always refused,
 *     even with --force. The link's target is never touched.
 *   - An existing regular file is refused unless `force`. With `force`, it is
 *     first copied to `<path>.bak` (or `<path>.bak-<timestamp>` if that exists)
 *     using COPYFILE_EXCL, so a backup is never overwritten either.
 *   - Content goes to an O_EXCL temp file in the same dir with mode 0600 and is
 *     fsynced, then moved in atomically: link() when the target must not exist
 *     (fails with EEXIST instead of overwriting), rename() when forcing (which
 *     replaces the directory entry and never writes through a link).
 */
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  copyFileSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "fs";
import { basename, dirname, join } from "path";

export interface UnitFile {
  path: string;
  content: string;
}

export type UnitRefusalReason = "exists" | "symlink" | "not-a-file";

export interface UnitRefusal {
  path: string;
  reason: UnitRefusalReason;
}

export type WriteUnitsResult =
  | { ok: true; written: string[]; backups: Array<{ path: string; backup: string }> }
  | { ok: false; refused: UnitRefusal[]; written: string[]; error?: string };

/** File mode for written unit files and their temp files. */
export const UNIT_FILE_MODE = 0o600;

type Probe = { kind: "missing" } | { kind: "file" } | { kind: "symlink" } | { kind: "other" };

function probe(path: string): Probe {
  try {
    const st = lstatSync(path);
    if (st.isSymbolicLink()) return { kind: "symlink" };
    if (st.isFile()) return { kind: "file" };
    return { kind: "other" };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
    throw err;
  }
}

/** Which targets would be refused. Pure preflight; writes nothing. */
export function preflightUnitFiles(files: UnitFile[], opts: { force?: boolean } = {}): UnitRefusal[] {
  const refused: UnitRefusal[] = [];
  for (const f of files) {
    const p = probe(f.path);
    if (p.kind === "symlink") refused.push({ path: f.path, reason: "symlink" });
    else if (p.kind === "other") refused.push({ path: f.path, reason: "not-a-file" });
    else if (p.kind === "file" && !opts.force) refused.push({ path: f.path, reason: "exists" });
  }
  return refused;
}

function backupPathFor(path: string): string {
  return `${path}.bak`;
}

function makeBackup(path: string): string {
  const primary = backupPathFor(path);
  try {
    copyFileSync(path, primary, fsConstants.COPYFILE_EXCL);
    return primary;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
  const stamped = `${primary}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  copyFileSync(path, stamped, fsConstants.COPYFILE_EXCL);
  return stamped;
}

function writeTemp(dir: string, base: string, content: string): string {
  const tmp = join(dir, `.${base}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`);
  // "wx" = O_CREAT|O_EXCL: fails if anything (including a symlink) is already there.
  const fd = openSync(tmp, "wx", UNIT_FILE_MODE);
  try {
    writeSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync(tmp, UNIT_FILE_MODE); // umask can't widen 0600, but be explicit
  return tmp;
}

/**
 * Write unit files safely. All-or-nothing on refusal: if any target is refused,
 * nothing is written. See the module comment for the exact rules.
 */
export function writeUnitFiles(files: UnitFile[], opts: { force?: boolean } = {}): WriteUnitsResult {
  const force = opts.force === true;
  const refused = preflightUnitFiles(files, { force });
  if (refused.length > 0) return { ok: false, refused, written: [] };

  const written: string[] = [];
  const backups: Array<{ path: string; backup: string }> = [];
  for (const f of files) {
    const dir = dirname(f.path);
    mkdirSync(dir, { recursive: true });
    let tmp: string | null = null;
    try {
      tmp = writeTemp(dir, basename(f.path), f.content);
      // Re-check right before the swap (narrows the preflight→write race).
      const now = probe(f.path);
      if (now.kind === "symlink" || now.kind === "other") {
        return { ok: false, refused: [{ path: f.path, reason: now.kind === "symlink" ? "symlink" : "not-a-file" }], written };
      }
      if (now.kind === "file") {
        if (!force) return { ok: false, refused: [{ path: f.path, reason: "exists" }], written };
        backups.push({ path: f.path, backup: makeBackup(f.path) });
        renameSync(tmp, f.path);
      } else {
        // link() refuses to replace an existing entry (EEXIST), unlike rename().
        try {
          linkSync(tmp, f.path);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "EEXIST") {
            return { ok: false, refused: [{ path: f.path, reason: "exists" }], written };
          }
          throw err;
        }
        unlinkSync(tmp);
      }
      tmp = null;
      written.push(f.path);
    } catch (err) {
      return { ok: false, refused: [], written, error: String(err) };
    } finally {
      if (tmp) try { unlinkSync(tmp); } catch { /* already moved or gone */ }
    }
  }
  return { ok: true, written, backups };
}
