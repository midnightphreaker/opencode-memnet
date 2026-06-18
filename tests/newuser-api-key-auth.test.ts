import { describe, expect, it } from "bun:test";
import { AuthMiddleware } from "../src/services/auth.js";

function request(path: string, method: string, key: string): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "X-Opencode-Memnet-Client": "plugin" },
  });
}

function parseJsonLine(stdout: string): unknown {
  const line = stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .findLast((entry) => entry.startsWith("{") && entry.endsWith("}"));
  if (!line) throw new Error(`No JSON object line found in stdout: ${stdout}`);
  return JSON.parse(line);
}

describe("NEWUSER_API_KEY auth scope", () => {
  const auth = new AuthMiddleware("admin-secret", {
    configuredProfiles: [{ profileId: "phrkr", apiKey: "profile-secret" }],
    newUserApiKey: "bootstrap-secret",
  });

  it("accepts the bootstrap key only for POST /api/client/connect", async () => {
    const connect = auth.authenticate(
      request("/api/client/connect", "POST", "bootstrap-secret"),
      "client"
    );

    expect(connect instanceof Response).toBe(false);
    expect(connect).toEqual({ principal: { kind: "newuser" } });

    const search = auth.authenticate(request("/api/search", "GET", "bootstrap-secret"), "client");
    expect(search).toBeInstanceOf(Response);
    expect((search as Response).status).toBe(401);
    await expect((search as Response).json()).resolves.toEqual({
      success: false,
      error: "NEWUSER_API_KEY is only valid for POST /api/client/connect",
    });
  });
});

describe("generated profile key auth", () => {
  it("authenticates generated profile keys as profile principals", () => {
    const script = `
import { mock } from "bun:test";

mock.module(${JSON.stringify(new URL("../src/services/storage/factory.js", import.meta.url).href)}, () => ({
  createMemoryRepository: () => ({ initialize: async () => {} }),
  createUserPromptRepository: () => ({ initialize: async () => {} }),
  createUserProfileRepository: () => ({ initialize: async () => {} }),
  createClientRepository: () => ({ initialize: async () => {} }),
  createProfileApiKeyRepository: () => ({
    findProfileByApiKey: async (apiKey) => apiKey === "generated-secret" ? { profileId: "phrkr" } : null,
    touchLastUsed: async (profileId) => { globalThis.touched = profileId; },
  }),
  createTagRegistry: () => ({}),
}));

const { WebServer } = await import(${JSON.stringify(
      new URL("../src/services/web-server.js?generated-profile-key-auth", import.meta.url).href
    )});
const server = new WebServer({ port: 0, host: "127.0.0.1", enabled: false }, "admin-secret");
const result = await server.authenticateApiRequest(
  new Request("http://localhost/api/memories", {
    headers: { Authorization: "Bearer generated-secret" },
  }),
  "/api/memories"
);
console.log(JSON.stringify({ result, touched: globalThis.touched }));
`;
    const result = Bun.spawnSync({
      cmd: [process.execPath, "--eval", script],
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = Buffer.from(result.stdout).toString("utf8").trim();
    const stderr = Buffer.from(result.stderr).toString("utf8").trim();
    if (result.exitCode !== 0) throw new Error(stderr || stdout);

    expect(parseJsonLine(stdout)).toEqual({
      result: { principal: { kind: "profile", profileId: "phrkr" } },
      touched: "phrkr",
    });
  });
});
