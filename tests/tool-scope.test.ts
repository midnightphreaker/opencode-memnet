import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const indexUrl = new URL("../plugin/src/index-remote.js", import.meta.url).href;
const remoteClientUrl = new URL("../plugin/src/services/remote-client.js", import.meta.url).href;
const clientIdentityUrl = new URL("../plugin/src/client-identity.js", import.meta.url).href;
const clientConfigUrl = new URL("../shared/client-config.js", import.meta.url).href;
const tagsUrl = new URL("../shared/tags.js", import.meta.url).href;
const privacyUrl = new URL("../shared/privacy.js", import.meta.url).href;
const loggerUrl = new URL("../shared/logger.js", import.meta.url).href;

type ScenarioInput = {
  defaultScope?: "project" | "all-projects";
  args: Record<string, unknown>;
};

function runScenario(input: ScenarioInput) {
  const dir = mkdtempSync(join(tmpdir(), "opencode-memnet-tool-scope-"));
  tempDirs.push(dir);

  const scriptPath = join(dir, "scenario.mjs");
  const script = `
import { mock } from "bun:test";

const searchCalls = [];
let lastListScope;
const defaultScope = ${JSON.stringify(input.defaultScope)};
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
  memory: {
    defaultScope: defaultScope ?? "project",
  },
};

mock.module(${JSON.stringify(remoteClientUrl)}, () => ({
  getRemoteClient: () => ({
    clientConnect: async () => ({
      success: true,
      data: {
        principal: {
          kind: "user-api-key",
          apiKeyId: "key-1",
          apiKeyName: "opencode",
          apiKeyDescription: "OpenCode agent memory access",
        },
        memoryBanks: [
          {
            id: "bank-1",
            apiKeyId: "key-1",
            apiKeyName: "opencode",
            name: "repo",
            description: "Work done on repo",
            shortcut: "opencode>repo",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
        requiresMemoryBank: false,
      },
    }),
    searchMemories: async (...args) => {
      searchCalls.push(args);
      return { success: true, results: [], total: 0, timing: 0 };
    },
    listMemories: async (_tag, _limit, scope = "project") => {
      lastListScope = scope;
      return {
        success: true,
        memories: [],
        pagination: { currentPage: 1, totalItems: 0, totalPages: 0 },
        scope,
      };
    },
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
const plugin = await OpenCodeMemPlugin({ directory: "/workspace", client: {} });
const memoryTool = plugin.tool?.memory;

if (!memoryTool) {
  throw new Error("memory tool not available");
}

await memoryTool.execute(${JSON.stringify(input.args)}, { sessionID: "s1" });

console.log(
  JSON.stringify({
    searchScope: searchCalls[0]?.[2],
    listScope: lastListScope,
  })
);
`;

  writeFileSync(scriptPath, script);

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

describe("tool memory scope", () => {
  it("falls back to config default scope", () => {
    const result = runScenario({
      defaultScope: "all-projects",
      args: { mode: "search", query: "hello" },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.parsed?.searchScope).toBe("all-projects");
  });

  it("lets explicit args scope override config", () => {
    const result = runScenario({
      defaultScope: "all-projects",
      args: { mode: "list", scope: "project" },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.parsed?.listScope).toBe("project");
  });

  it("falls back to project when config scope is unset", () => {
    const result = runScenario({
      args: { mode: "list" },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.parsed?.listScope).toBe("project");
  });
});
