import { build } from "bun";

const result = await build({
  entrypoints: ["src/plugin.ts"],
  outdir: "dist",
  target: "bun",
  format: "esm",
  naming: "opencode-memnet.js",
  external: ["@opencode-ai/plugin", "@opencode-ai/sdk"],
  sourcemap: "none",
  minify: false,
});

if (!result.success) {
  console.error("Plugin build failed:", result.logs);
  process.exit(1);
}
console.log(
  "Plugin built:",
  result.outputs.map((o) => o.path)
);
