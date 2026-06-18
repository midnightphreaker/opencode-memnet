import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/mcp", { recursive: true });
await mkdir("dist/hooks", { recursive: true });

const mcp = await Bun.build({
  entrypoints: ["src/mcp/server.ts"],
  outdir: "dist/mcp",
  target: "node",
  format: "esm",
});

const hook = await Bun.build({
  entrypoints: ["src/hooks/runner.ts"],
  outdir: "dist/hooks",
  target: "node",
  format: "esm",
});

if (!mcp.success || !hook.success) {
  for (const log of [...mcp.logs, ...hook.logs]) console.error(log);
  process.exit(1);
}

await cp(".codex-plugin", "dist/.codex-plugin", { recursive: true });
await cp("hooks", "dist/hooks", { recursive: true });
await cp("skills", "dist/skills", { recursive: true });
