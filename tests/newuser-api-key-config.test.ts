import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import type { ServerConfig } from "../src/server-config.js";
import { validateServerConfig } from "../src/server-config.js";

const runtimeKeyPath = "/tmp/opencode-memnet-newuser-api-key";

afterEach(() => {
  rmSync(runtimeKeyPath, { force: true });
});

function runConfigScenario(env: Record<string, string | undefined>) {
  const script = `
for (const [key, value] of Object.entries(${JSON.stringify(env)})) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
const { initServerConfig } = await import(${JSON.stringify(
    new URL("../src/server-config.js", import.meta.url).href
  )});
const config = initServerConfig();
console.log(JSON.stringify({
  newUserApiKey: config.newUserApiKey,
  newUserApiKeyGenerated: config.newUserApiKeyGenerated,
  newUserApiKeyFile: config.newUserApiKeyFile,
}));
`;
  const result = Bun.spawnSync({
    cmd: [process.execPath, "--eval", script],
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = Buffer.from(result.stdout).toString("utf8").trim();
  const stderr = Buffer.from(result.stderr).toString("utf8").trim();
  if (result.exitCode !== 0) throw new Error(stderr || stdout);
  return JSON.parse(stdout);
}

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    port: 4747,
    host: "0.0.0.0",
    serverApiKey: "admin",
    newUserApiKey: "bootstrap",
    newUserApiKeyGenerated: false,
    postgres: {
      url: "postgres://localhost:5432/test",
      ssl: "require",
      maxConnections: 10,
      idleTimeoutSeconds: 30,
      connectTimeoutSeconds: 10,
      vectorType: "vector",
      hnswEfSearch: 128,
      hnswEfConstruction: 256,
    },
    embeddingModel: "text-embedding-3-small",
    embeddingApiUrl: "https://api.example.test/v1",
    embeddingApiKey: "embedding-key",
    embeddingDimensions: 1536,
    embeddingMaxTokens: { content: 2048, tags: 256, query: 512, migration: 2048 },
    embeddingTruncationSide: {
      content: "right",
      tags: "right",
      query: "right",
      migration: "right",
    },
    similarityThreshold: 0.6,
    maxMemories: 10,
    injectProfile: true,
    memoryProvider: "openai-chat",
    memoryModel: "gpt-test",
    memoryApiUrl: "https://api.example.test/v1",
    memoryApiKey: "memory-key",
    memoryTemperature: 0.3,
    autoCaptureMaxIterations: 5,
    autoCaptureIterationTimeout: 30000,
    autoCaptureLanguage: "auto",
    aiSessionRetentionDays: 7,
    userProfileAnalysisInterval: 10,
    userProfileMaxPreferences: 20,
    userProfileMaxPatterns: 15,
    userProfileMaxWorkflows: 10,
    userProfileConfidenceDecayDays: 30,
    userProfileChangelogRetentionCount: 5,
    autoCleanupRetentionDays: 90,
    webServerAllowedOrigin: "*",
    disableWebuiAuth: false,
    disableClientAuth: false,
    configuredProfiles: [],
    logLevel: "info",
    clientWelcomeBackThreshold: 168,
    ...overrides,
  } as ServerConfig;
}

describe("NEWUSER_API_KEY server config", () => {
  it("generates a runtime bootstrap key and writes it to a 0600 temp file when unset", () => {
    rmSync(runtimeKeyPath, { force: true });

    const config = runConfigScenario({ NEWUSER_API_KEY: "", SERVER_API_KEY: "admin" });

    expect(config.newUserApiKey).toBeString();
    expect(config.newUserApiKey.length).toBeGreaterThanOrEqual(32);
    expect(config.newUserApiKeyGenerated).toBe(true);
    expect(config.newUserApiKeyFile).toBe(runtimeKeyPath);
    expect(existsSync(runtimeKeyPath)).toBe(true);
    expect(readFileSync(runtimeKeyPath, "utf-8").trim()).toBe(config.newUserApiKey);
    expect(statSync(runtimeKeyPath).mode & 0o777).toBe(0o600);
  });

  it("uses a configured bootstrap key without writing the temp file", () => {
    rmSync(runtimeKeyPath, { force: true });

    const config = runConfigScenario({
      NEWUSER_API_KEY: "configured-bootstrap",
      SERVER_API_KEY: "admin",
    });

    expect(config).toEqual({
      newUserApiKey: "configured-bootstrap",
      newUserApiKeyGenerated: false,
      newUserApiKeyFile: null,
    });
    expect(existsSync(runtimeKeyPath)).toBe(false);
  });

  it("rejects bootstrap keys that match admin or static profile keys", () => {
    expect(
      validateServerConfig(makeConfig({ serverApiKey: "same", newUserApiKey: "same" }))
    ).toContain("NEWUSER_API_KEY must not match SERVER_API_KEY");

    expect(
      validateServerConfig(
        makeConfig({
          newUserApiKey: "profile-secret",
          configuredProfiles: [{ profileId: "phrkr", apiKey: "profile-secret" }],
        })
      )
    ).toContain("NEWUSER_API_KEY must not match any PROFILE_KEYS_FILE apiKey");
  });
});
