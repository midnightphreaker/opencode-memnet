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
  const dir = mkdtempSync(join(tmpdir(), "opencode-memnet-timeout-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "scenario.mjs");
  const script = `
import { mock } from "bun:test";

const logs = { warn: [], debug: [] };

mock.module(${JSON.stringify(loggerUrl)}, () => ({
  log: () => {},
  logDebug: (message, data) => logs.debug.push({ message, data }),
  logWarn: (message, data) => logs.warn.push({ message, data }),
  initLogger: () => {},
}));

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
let timeoutMs = null;

globalThis.setTimeout = (callback, ms) => {
  timeoutMs = ms;
  queueMicrotask(callback);
  return 1;
};
globalThis.clearTimeout = () => {};
globalThis.fetch = async (_url, init) => {
  return await new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => {
      reject(new DOMException("The operation was aborted.", "AbortError"));
    });
  });
};

try {
  const { RemoteMemoryClient } = await import(${JSON.stringify(remoteClientUrl)});
  const client = new RemoteMemoryClient("https://memory.example", "test-key", "client-id");
  const result = await client.autoCapture({
    sessionID: "s1",
    projectTag: "opencode_project_test",
    projectMetadata: {},
    conversationMessages: [],
    userPrompt: "Fix the build",
    promptMessageId: "msg1",
  });

  console.log(JSON.stringify({ result, timeoutMs, logs }));
} finally {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
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

describe("RemoteMemoryClient auto-capture timeout handling", () => {
  it("uses a longer timeout and logs auto-capture aborts at debug level", () => {
    const result = runScenario();

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout);
    }
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.parsed.timeoutMs).toBe(180000);
    expect(result.parsed.result).toEqual({
      success: false,
      error: "Request timed out after 180000ms",
    });
    expect(result.parsed.logs.warn).toEqual([]);
    expect(result.parsed.logs.debug).toContainEqual({
      message: "RemoteMemoryClient: request failed",
      data: {
        method: "POST",
        path: "/api/auto-capture",
        url: "https://memory.example/api/auto-capture",
        error: "Request timed out after 180000ms",
      },
    });
  });
});
