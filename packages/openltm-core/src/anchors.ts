/**
 * anchors.ts — file-path normalisation for code-anchored memory invalidation.
 *
 * Both sides of the feature MUST normalise identically or flagging silently misses:
 *   - learn() stores anchors a memory references (agent may pass absolute paths)
 *   - the post-commit hook flags memories anchored to files `git diff-tree
 *     --name-only` reports (always repo-relative, forward-slash, no leading ./)
 *
 * This module is the single source of truth for that normalisation. Output mirrors
 * git's repo-relative path form so anchors and changed-file lists compare exactly.
 */

/**
 * Normalise one path to the repo-relative, forward-slash form git emits.
 * When `repoRoot` is given, an absolute path under it is made relative.
 */
export function normalizeAnchorPath(path: string, repoRoot?: string): string {
  let s = path.trim().replace(/\\/g, "/");
  if (!s) return "";
  if (repoRoot) {
    const root = repoRoot.replace(/\\/g, "/").replace(/\/+$/, "");
    if (root && (s === root || s.startsWith(`${root}/`))) {
      s = s.slice(root.length + 1);
    }
  }
  // Strip leading "./" and any leading slashes — git paths are repo-relative.
  s = s.replace(/^(\.\/)+/, "").replace(/^\/+/, "");
  return s;
}

/** Normalise + de-duplicate a list of anchor paths, dropping empties. */
export function normalizeAnchorPaths(paths: string[], repoRoot?: string): string[] {
  const seen = new Set<string>();
  for (const p of paths) {
    const n = normalizeAnchorPath(p, repoRoot);
    if (n) seen.add(n);
  }
  return [...seen];
}
