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

const requests = [];

mock.module(${JSON.stringify(loggerUrl)}, () => ({
  log: () => {},
  logDebug: () => {},
  logWarn: () => {},
  initLogger: () => {},
}));

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const request = new Request(url, init);
  requests.push({
    url: String(url),
    memoryBankId: request.headers.get("X-Memory-Bank-ID"),
  });
  return new Response(JSON.stringify({ success: true, data: { items: [] } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

try {
  const { RemoteMemoryClient } = await import(${JSON.stringify(remoteClientUrl)});
  const client = new RemoteMemoryClient("https://memory.example", "test-key", "client-id");

  await client.searchMemories("database migration", "opencode_project_current", "project", {
    memoryBankId: "bank-1",
  });
  await client.searchMemories("database migration", "opencode_project_current", "all-projects", {
    memoryBankId: "bank-1",
  });
  await client.listMemories("opencode_project_current", 5, "project", {
    memoryBankId: "bank-1",
  });
  await client.listMemories("opencode_project_current", 5, "all-projects", {
    memoryBankId: "bank-1",
  });

  console.log(JSON.stringify({ requests }));
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

describe("RemoteMemoryClient Memory Bank routing", () => {
  it("sends X-Memory-Bank-ID while keeping project tag query behavior", () => {
    const result = runScenario();

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout);
    }
    expect(result.parsed.requests).toEqual([
      {
        url: "https://memory.example/api/search?q=database+migration&tag=opencode_project_current&pageSize=20",
        memoryBankId: "bank-1",
      },
      {
        url: "https://memory.example/api/search?q=database+migration&pageSize=20",
        memoryBankId: "bank-1",
      },
      {
        url: "https://memory.example/api/memories?tag=opencode_project_current&pageSize=5",
        memoryBankId: "bank-1",
      },
      {
        url: "https://memory.example/api/memories?pageSize=5",
        memoryBankId: "bank-1",
      },
    ]);
    expect(
      result.parsed.requests.some((request: { url: string }) => request.url.includes("profileId="))
    ).toBe(false);
    expect(
      result.parsed.requests.some((request: { url: string }) => request.url.includes("repoId="))
    ).toBe(false);
  });
});
