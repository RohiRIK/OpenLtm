import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const packageUrl = new URL("../../packages/adapter-pi/package.json", import.meta.url);
test("Pi extension is discoverable in the npm-backed package gallery", () => {
  const pkg = JSON.parse(readFileSync(packageUrl, "utf8"));
  expect(pkg.keywords).toContain("pi-package");
  expect(pkg.pi.extensions).toEqual(["./dist/index.js"]);
  expect(pkg.files).toContain("dist");
});
