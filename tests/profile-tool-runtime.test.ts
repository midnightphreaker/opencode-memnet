import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type ScenarioInput = {
  args: Record<string, unknown>;
  userEmail?: string;
  profileData?: unknown;
};

const tempDirs: string[] = [];
const indexUrl = new URL("../plugin/src/index-remote.js", import.meta.url).href;
const remoteClientUrl = new URL("../plugin/src/services/remote-client.js", import.meta.url).href;
const clientIdentityUrl = new URL("../plugin/src/client-identity.js", import.meta.url).href;
const clientConfigUrl = new URL("../shared/client-config.js", import.meta.url).href;
const tagsUrl = new URL("../shared/tags.js", import.meta.url).href;
const privacyUrl = new URL("../shared/privacy.js", import.meta.url).href;
const loggerUrl = new URL("../shared/logger.js", import.meta.url).href;

function runScenario(input: ScenarioInput) {
  const dir = mkdtempSync(join(tmpdir(), "opencode-memnet-profile-runtime-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "scenario.mjs");

  const script = `
import { mock } from "bun:test";

let profileUserId = "not-called";
const userEmail = ${JSON.stringify(input.userEmail)};
const profileData = ${JSON.stringify(input.profileData ?? null)};
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
    defaultScope: "project",
  },
};

mock.module(${JSON.stringify(remoteClientUrl)}, () => ({
  getRemoteClient: () => ({
    clientConnect: async () => ({ success: true, data: null }),
    getUserProfile: async (userId) => {
      profileUserId = userId;
      return { success: true, data: profileData };
    },
    searchMemories: async () => ({ success: true, results: [], total: 0, timing: 0 }),
    listMemories: async () => ({ success: true, memories: [], pagination: {} }),
    addMemory: async () => ({ success: true, data: { id: "m1" } }),
    deleteMemory: async () => ({ success: true }),
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
    user: { userEmail },
    project: {
      tag: "project-tag",
      userEmail,
      projectPath: "/workspace",
      projectName: "workspace",
    },
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
const result = JSON.parse(
  await plugin.tool.memory.execute(${JSON.stringify(input.args)}, { sessionID: "s1" })
);

console.log(JSON.stringify({ result, profileUserId }));
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

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("memory tool profile runtime behavior", () => {
  it("reads the profile for the resolved user email", () => {
    const profile = {
      preferences: [{ description: "Default Jira board is DOPS", confidence: 0.9 }],
      patterns: [],
      workflows: [],
    };
    const result = runScenario({
      userEmail: "test@example.com",
      profileData: profile,
      args: { mode: "profile" },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.parsed.profileUserId).toBe("test@example.com");
    expect(result.parsed.result).toEqual({ success: true, profile });
  });

  it("returns null profile when the server has no profile", () => {
    const result = runScenario({
      userEmail: "test@example.com",
      profileData: null,
      args: { mode: "profile" },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.parsed.result).toEqual({ success: true, profile: null });
  });

  it("passes undefined user id when no user email is resolved", () => {
    const result = runScenario({
      args: { mode: "profile" },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.parsed.profileUserId).toBeUndefined();
    expect(result.parsed.result).toEqual({ success: true, profile: null });
  });
});
