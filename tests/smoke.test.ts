import { describe, it, expect } from "vitest";

describe("smoke test", () => {
  it("vitest is working", () => {
    expect(true).toBe(true);
  });

  it("plugin module loads", async () => {
    const { default: plugin } = await import("../src/index.js");
    expect(plugin).toBeDefined();
    expect(plugin.name).toBe("wopr-plugin-voice-call");
    expect(plugin.version).toBe("0.1.0");
    expect(typeof plugin.init).toBe("function");
    expect(typeof plugin.shutdown).toBe("function");
  });
});
