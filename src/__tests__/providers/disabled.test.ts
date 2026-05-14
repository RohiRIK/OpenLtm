import { describe, expect, it } from "bun:test";

import { DisabledProvider, loadProvider } from "@rohirik/ltm-core";
describe("DisabledProvider", () => {
  it("name is disabled", () => {
    expect(new DisabledProvider().name).toBe("disabled");
  });

  it("model is none", () => {
    expect(new DisabledProvider().model).toBe("none");
  });

  it("dim is 0", () => {
    expect(new DisabledProvider().dim).toBe(0);
  });

  it("available() returns false", async () => {
    expect(await new DisabledProvider().available()).toBe(false);
  });

  it("generate() returns null without any I/O", async () => {
    expect(await new DisabledProvider().generate("hello world")).toBeNull();
  });
});

describe("loadProvider()", () => {
  it("returns DisabledProvider when provider is disabled", async () => {
    const p = await loadProvider({ provider: "disabled", confidenceThreshold: 0.6 });
    expect(p.name).toBe("disabled");
    expect(await p.available()).toBe(false);
    expect(await p.generate("test")).toBeNull();
  });

  it("returns DisabledProvider when config is undefined", async () => {
    const p = await loadProvider(undefined);
    expect(p.name).toBe("disabled");
  });

  it("returns DisabledProvider when config has no provider field", async () => {
    const p = await loadProvider({ confidenceThreshold: 0.6 });
    expect(p.name).toBe("disabled");
  });
});
