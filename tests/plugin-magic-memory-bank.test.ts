import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const plugin = readFileSync(join(import.meta.dir, "../plugin/src/index-remote.ts"), "utf-8");
const tempDirs: string[] = [];
const indexUrl = new URL("../plugin/src/index-remote.js", import.meta.url).href;
const remoteClientUrl = new URL("../plugin/src/services/remote-client.js", import.meta.url).href;
const clientIdentityUrl = new URL("../plugin/src/client-identity.js", import.meta.url).href;
const clientConfigUrl = new URL("../shared/client-config.js", import.meta.url).href;
const tagsUrl = new URL("../shared/tags.js", import.meta.url).href;
const privacyUrl = new URL("../shared/privacy.js", import.meta.url).href;
const loggerUrl = new URL("../shared/logger.js", import.meta.url).href;

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function runMagicScenario() {
  const dir = mkdtempSync(join(tmpdir(), "opencode-memnet-magic-bank-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "scenario.mjs");
  const script = `
import { mock } from "bun:test";

const created = [];
const clientConfig = {
  serverUrl: "http://localhost:4747",
  apiKey: "test-key",
  autoCaptureEnabled: false,
  showAutoCaptureToasts: false,
  showErrorToasts: false,
  chatMessage: {
    enabled: false,
    maxMemories: 3,
    excludeCurrentSession: true,
    injectOn: "first",
  },
  customMessage: {
    enabled: false,
    frequency: "first",
    text: "",
  },
  memory: {
    defaultScope: "project",
  },
};

mock.module(${JSON.stringify(remoteClientUrl)}, () => ({
  getRemoteClient: () => ({
    clientConnect: async () => ({ success: true, data: null }),
    createMemoryBank: async (args) => {
      created.push(args);
      return {
        success: true,
        data: {
          memoryBank: {
            id: "bank-1",
            apiKeyId: "key-1",
            name: args.name,
            description: args.description,
            shortcut: args.name,
            createdAt: "2026-06-26T00:00:00.000Z",
            updatedAt: "2026-06-26T00:00:00.000Z",
          },
        },
      };
    },
    getContext: async () => {
      throw new Error("context should not be fetched");
    },
    searchMemories: async () => ({ success: true, results: [], total: 0, timing: 0 }),
    listMemories: async () => ({ success: true, memories: [], pagination: {} }),
    addMemory: async () => ({ success: true, data: { id: "m1" } }),
    deleteMemory: async () => ({ success: true }),
    getUserProfile: async () => ({ success: true, data: null }),
    autoCapture: async () => ({ success: true, data: { captured: false } }),
    searchMemoriesBySessionID: async () => ({ success: true, results: [], total: 0, timing: 0 }),
  }),
}));

mock.module(${JSON.stringify(clientIdentityUrl)}, () => ({
  getClientId: () => "client-test-id",
  getClientMetadata: () => ({ platform: "test" }),
}));

mock.module(${JSON.stringify(clientConfigUrl)}, () => ({
  CLIENT_CONFIG: clientConfig,
  initClientConfig: () => {},
  isClientConfigured: () => true,
}));

mock.module(${JSON.stringify(tagsUrl)}, () => ({
  getTags: () => ({
    project: { tag: "project-tag", userEmail: "u@example.com" },
    user: { userEmail: "u@example.com" },
  }),
}));

mock.module(${JSON.stringify(privacyUrl)}, () => ({
  stripPrivateContent: (value) => value,
  isFullyPrivate: () => false,
}));

mock.module(${JSON.stringify(loggerUrl)}, () => ({
  log: () => {},
  logInfo: () => {},
  logWarn: () => {},
  logError: () => {},
  logDebug: () => {},
}));

const { OpenCodeMemPlugin } = await import(${JSON.stringify(indexUrl)});
const plugin = await OpenCodeMemPlugin({ directory: "/workspace/my-repo", client: {} });
const output = {
  message: { id: "msg-1" },
  parts: [
    {
      id: "prt-user-1",
      sessionID: "s1",
      messageID: "msg-1",
      type: "text",
      text: "!opencode-memnet!New memory bank called 'Launch Plan', create it, and activate it!",
    },
  ],
};
await plugin["chat.message"]({ sessionID: "s1" }, output);

console.log(JSON.stringify({ created, parts: output.parts }));
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

describe("OpenCode plugin magic Memory Bank prompt", () => {
  it("parses magic prompt and creates then activates a Memory Bank", () => {
    expect(plugin).toContain("parseMagicMemoryBankPrompt");
    expect(plugin).toContain("createMemoryBank");
    expect(plugin).toContain("Created and activated");
    expect(plugin).toContain("work relating to");
  });

  it("creates and activates a bank even when context injection is disabled", () => {
    const result = runMagicScenario();

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.parsed.created).toEqual([
      { name: "launch-plan", description: "work relating to launch-plan" },
    ]);
    expect(result.parsed.parts[0].text).toBe(
      "Created and activated the `launch-plan` Memory Bank. I set its description to `work relating to launch-plan`. You should consider changing the description to make it more identifiable; ask me anytime to change it."
    );
  });
});
