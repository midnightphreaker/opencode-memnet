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
  enabled: boolean;
  frequency: "first" | "always";
  text: string;
  sessionIDs: string[];
};

function runScenario(input: ScenarioInput) {
  const dir = mkdtempSync(join(tmpdir(), "opencode-memnet-custom-message-"));
  tempDirs.push(dir);

  const scriptPath = join(dir, "scenario.mjs");
  const script = `
import { mock } from "bun:test";

let getContextCalls = 0;
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
    enabled: ${JSON.stringify(input.enabled)},
    frequency: ${JSON.stringify(input.frequency)},
    text: ${JSON.stringify(input.text)},
  },
  memory: {
    defaultScope: "project",
  },
};

mock.module(${JSON.stringify(remoteClientUrl)}, () => ({
  getRemoteClient: () => ({
    clientConnect: async () => ({ success: true, data: null }),
    getContext: async () => {
      getContextCalls += 1;
      return { success: true, data: null };
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
const plugin = await OpenCodeMemPlugin({ directory: "/workspace", client: {} });

if (!plugin["chat.message"]) {
  throw new Error("chat.message hook not available");
}

const outputs = [];
for (const [index, sessionID] of ${JSON.stringify(input.sessionIDs)}.entries()) {
  const output = {
    message: { id: "msg-" + index },
    parts: [
      {
        id: "prt-user-" + index,
        sessionID,
        messageID: "msg-" + index,
        type: "text",
        text: "User message " + index,
      },
    ],
  };
  await plugin["chat.message"]({ sessionID }, output);
  outputs.push(output.parts.map((part) => ({
    type: part.type,
    text: part.text,
    synthetic: Boolean(part.synthetic),
  })));
}

console.log(JSON.stringify({ outputs, getContextCalls }));
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

describe("plugin custom message injection", () => {
  it("injects a configured custom message after every user message", () => {
    const result = runScenario({
      enabled: true,
      frequency: "always",
      text: "Always include the deployment checklist.",
      sessionIDs: ["s1", "s1"],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.parsed.getContextCalls).toBe(0);
    expect(result.parsed.outputs[0]).toEqual([
      { type: "text", text: "User message 0", synthetic: false },
      { type: "text", text: "Always include the deployment checklist.", synthetic: true },
    ]);
    expect(result.parsed.outputs[1]).toEqual([
      { type: "text", text: "User message 1", synthetic: false },
      { type: "text", text: "Always include the deployment checklist.", synthetic: true },
    ]);
  });

  it("injects a first-frequency custom message only once per session", () => {
    const result = runScenario({
      enabled: true,
      frequency: "first",
      text: "Ask about acceptance criteria before coding.",
      sessionIDs: ["s1", "s1", "s2"],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.parsed.outputs[0].at(-1)).toEqual({
      type: "text",
      text: "Ask about acceptance criteria before coding.",
      synthetic: true,
    });
    expect(result.parsed.outputs[1]).toEqual([
      { type: "text", text: "User message 1", synthetic: false },
    ]);
    expect(result.parsed.outputs[2].at(-1)).toEqual({
      type: "text",
      text: "Ask about acceptance criteria before coding.",
      synthetic: true,
    });
  });

  it("does not inject a custom message when the text is blank", () => {
    const result = runScenario({
      enabled: true,
      frequency: "always",
      text: "   ",
      sessionIDs: ["s1"],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.parsed.outputs[0]).toEqual([
      { type: "text", text: "User message 0", synthetic: false },
    ]);
  });
});
