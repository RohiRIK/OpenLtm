/**
 * commitCommand.ts — find `git … commit` in a Bash command line.
 *
 * Claude rarely types a bare `git commit`: it uses global options such as
 * `git -c user.name=x commit`, `git -C ../repo commit` or `git --no-pager commit`.
 * Returns the directory the commit ran in (from `-C`, resolved against cwd),
 * or null when the command makes no commit.
 */
import { isAbsolute, resolve } from "path";

// git, then any global options (-C <dir>, -c <k=v>, --flag[=v], -x), then `commit`.
const GIT_COMMIT_RE =
  /(?:^|[\s;&|()`$])git((?:\s+(?:-C\s+(?:"[^"]*"|'[^']*'|\S+)|-c\s+(?:"[^"]*"|'[^']*'|\S+)|--[\w-]+(?:=\S+)?|-[A-Za-z]+))*)\s+commit(?=\s|$|[;&|)])/;
const DASH_C_DIR_RE = /-C\s+("[^"]*"|'[^']*'|\S+)/g;

export function commitRepoDir(command: string, cwd: string): string | null {
  const m = GIT_COMMIT_RE.exec(command);
  if (!m) return null;
  let dir = cwd;
  for (const c of (m[1] ?? "").matchAll(DASH_C_DIR_RE)) {
    const raw = c[1]!.replace(/^["']|["']$/g, "");
    dir = isAbsolute(raw) ? raw : resolve(dir, raw);
  }
  return dir;
}
