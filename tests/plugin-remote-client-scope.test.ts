import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDirs: string[] = [];
const remoteClientUrl = new URL("../plugin/src/services/remote-client.js", import.meta.url).href;
const loggerUrl = new URL("../shared/logger.js", import.meta.url).href;

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function runScenario() {
  const dir = mkdtempSync(join(tmpdir(), "opencode-memnet-scope-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "scenario.mjs");
  const script = `
import { mock } from "bun:test";

const urls = [];

mock.module(${JSON.stringify(loggerUrl)}, () => ({
  log: () => {},
  logDebug: () => {},
  logWarn: () => {},
  initLogger: () => {},
}));

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  urls.push(String(url));
  return new Response(JSON.stringify({ success: true, data: { items: [] } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

try {
  const { RemoteMemoryClient } = await import(${JSON.stringify(remoteClientUrl)});
  const client = new RemoteMemoryClient("https://memory.example", "test-key", "client-id");

  await client.searchMemories("database migration", "opencode_project_current", "project");
  await client.searchMemories("database migration", "opencode_project_current", "all-projects");
  await client.listMemories("opencode_project_current", 5, "project");
  await client.listMemories("opencode_project_current", 5, "all-projects");

  console.log(JSON.stringify({ urls }));
} finally {
  globalThis.fetch = originalFetch;
}
`;

  writeFileSync(scriptPath, script, "utf-8");
  const result = Bun.spawnSync({
    cmd: [process.execPath, scriptPath],
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = Buffer.from(result.stdout).toString("utf8").trim();
  const stderr = Buffer.from(result.stderr).toString("utf8").trim();

  return {
    exitCode: result.exitCode,
    stdout,
    stderr,
    parsed: stdout ? JSON.parse(stdout) : null,
  };
}

describe("RemoteMemoryClient memory scope query parameters", () => {
  it("sends tag for project scope and omits tag for all-projects scope", () => {
    const result = runScenario();

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout);
    }
    expect(result.parsed.urls).toEqual([
      "https://memory.example/api/search?q=database+migration&tag=opencode_project_current&pageSize=20",
      "https://memory.example/api/search?q=database+migration&pageSize=20",
      "https://memory.example/api/memories?tag=opencode_project_current&pageSize=5",
      "https://memory.example/api/memories?pageSize=5",
    ]);
  });
});
