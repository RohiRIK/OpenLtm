import { describe, expect, it } from "bun:test";
import { commitRepoDir } from "../../../hooks/lib/commitCommand";

describe("commitRepoDir — detect git commit in a Bash command", () => {
  const cases: [string, string | null][] = [
    ["git commit -m x", "/w"],
    ["git add -A && git commit -m 'x'", "/w"],
    // Found in a live Claude Code run: global -c options before `commit` were missed.
    ["git -c user.name=qa -c user.email=a@b -c core.hooksPath=/dev/null commit -m 'add parser'", "/w"],
    ["git -C ../repo commit -am x", "/repo"],
    ["git -C '/abs path' commit", "/abs path"],
    ["git --no-pager commit -m x", "/w"],
    ["cd x && git commit --amend --no-edit", "/w"],
    ["git status", null],
    ["git commit-tree abc", null],
    ["git log --grep commit", null],
    ["legit commit", null],
  ];
  for (const [command, expected] of cases) {
    it(`${JSON.stringify(command)} → ${expected}`, () => {
      expect(commitRepoDir(command, "/w")).toBe(expected);
    });
  }
});
