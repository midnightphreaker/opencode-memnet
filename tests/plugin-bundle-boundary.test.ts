import { describe, expect, it } from "bun:test";

describe("OpenCode plugin loader bundle boundary", () => {
  it("does not pull @huggingface/transformers internals into the plugin-loader bundle", async () => {
    const result = await Bun.build({
      entrypoints: ["./dist/plugin.js"],
      target: "bun",
      packages: "bundle",
    });

    expect(result.success).toBe(true);
    const output = await result.outputs[0]!.text();
    expect(output).not.toContain("node_modules/@huggingface/transformers");
    expect(output).not.toContain("@huggingface/transformers/dist");
  });
});
