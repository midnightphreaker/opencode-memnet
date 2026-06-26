import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";

describe("OpenCode plugin loader bundle boundary", () => {
  it("does not pull local embedding transformer internals into the plugin-loader bundle", async () => {
    if (!existsSync("./plugin/dist/opencode-memnet.js")) {
      const build = Bun.spawnSync({
        cmd: ["bun", "run", "build:plugin"],
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(Buffer.from(build.stderr).toString("utf8")).toBe("");
      expect(build.exitCode).toBe(0);
    }

    const result = await Bun.build({
      entrypoints: ["./plugin/dist/opencode-memnet.js"],
      target: "bun",
      packages: "bundle",
    });

    expect(result.success).toBe(true);
    const output = await result.outputs[0]!.text();
    expect(output).not.toContain("node_modules/@xenova/transformers");
    expect(output).not.toContain("@xenova/transformers/src");
    expect(output).not.toContain("@xenova/transformers/dist");
    expect(output).not.toContain("node_modules/@huggingface/transformers");
    expect(output).not.toContain("@huggingface/transformers/dist");
  });
});
