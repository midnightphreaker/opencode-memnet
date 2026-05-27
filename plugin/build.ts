import { build } from "bun";

const result = await build({
  entrypoints: ["src/plugin.ts"],
  outdir: "dist",
  target: "node",
  format: "esm",
  banner: "#!/usr/bin/env node",
  naming: "opencode-memnet.js",
  external: ["@opencode-ai/plugin", "@opencode-ai/sdk"],
  sourcemap: "none",
  minify: false,
});

if (!result.success) {
  console.error("Plugin build failed:", result.logs);
  process.exit(1);
}

// Copy package.json into dist/ so OpenCode's plugin loader can find it.
// Rewrite paths to be relative to dist/ (strip the "dist/" prefix).
const pkg: Record<string, unknown> = JSON.parse(await Bun.file("package.json").text());
if (pkg.main && typeof pkg.main === "string") pkg.main = pkg.main.replace(/^dist\//, "./");
if (pkg.exports && typeof pkg.exports === "object" && pkg.exports !== null) {
  const exports = pkg.exports as Record<string, Record<string, string>>;
  for (const val of Object.values(exports)) {
    for (const [fmt, path] of Object.entries(val)) {
      if (typeof path === "string") {
        val[fmt] = path.replace(/^\.\/dist\//, "./");
      }
    }
  }
}
await Bun.write("dist/package.json", JSON.stringify(pkg, null, 2) + "\n");

console.log(
  "Plugin built:",
  result.outputs.map((o) => o.path)
);
