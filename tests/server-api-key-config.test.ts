import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerConfig } from "../src/server-config.js";
import { validateServerConfig } from "../src/server-config.js";

function runConfigScenario(args: {
  env: Record<string, string | undefined>;
  configFile?: Record<string, unknown>;
}) {
  const home = mkdtempSync(join(tmpdir(), "omnu-server-config-"));
  const configDir = join(home, ".config", "opencode");
  if (args.configFile) {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "opencode-memnet.jsonc"),
      JSON.stringify(args.configFile),
      "utf8"
    );
  }
  const script = `
process.env.HOME = ${JSON.stringify(home)};
process.env.XDG_CONFIG_HOME = "";
process.env.CONFIG_FILE = "";
for (const [key, value] of Object.entries(${JSON.stringify(args.env)})) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
const { initServerConfig } = await import(${JSON.stringify(
    new URL("../src/server-config.js", import.meta.url).href
  )});
const config = initServerConfig();
const legacyNewUserField = ["newUser", "ApiKey"].join("");
const legacyGeneratedField = ["serverApiKey", "Generated"].join("");
console.log(JSON.stringify({
  serverApiKey: config.serverApiKey,
  hasNewUserApiKey: Object.prototype.hasOwnProperty.call(config, legacyNewUserField),
  hasGeneratedFlag: Object.prototype.hasOwnProperty.call(config, legacyGeneratedField),
  hasProfileKeysFile: Object.prototype.hasOwnProperty.call(config, "profileKeysFile")
}));
`;
  const result = Bun.spawnSync({
    cmd: [process.execPath, "--eval", script],
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    return {
      exitCode: result.exitCode,
      stdout: Buffer.from(result.stdout).toString("utf8").trim(),
      stderr: Buffer.from(result.stderr).toString("utf8").trim(),
    };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    port: 4747,
    host: "0.0.0.0",
    serverApiKey: "admin-secret",
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
    logLevel: "info",
    clientWelcomeBackThreshold: 168,
    ...overrides,
  } as ServerConfig;
}

describe("SERVER_API_KEY v2 server config", () => {
  it("fails validation when SERVER_API_KEY is missing or empty", () => {
    expect(validateServerConfig(makeConfig({ serverApiKey: "" }))).toContain(
      "SERVER_API_KEY is required"
    );
    expect(validateServerConfig(makeConfig({ serverApiKey: "   " }))).toContain(
      "SERVER_API_KEY is required"
    );
  });

  it("uses configured SERVER_API_KEY without generated key metadata", () => {
    const result = runConfigScenario({
      env: {
        SERVER_API_KEY: "configured-admin",
        POSTGRES_URL: "postgres://localhost:5432/test",
        EMBEDDING_API_URL: "https://api.example.test/v1",
        EMBEDDING_MODEL: "text-embedding-3-small",
        EMBEDDING_API_KEY: "embedding-key",
      },
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      serverApiKey: "configured-admin",
      hasNewUserApiKey: false,
      hasGeneratedFlag: false,
      hasProfileKeysFile: false,
    });
  });

  it("uses config-file server.apiKey when env SERVER_API_KEY is absent", () => {
    const result = runConfigScenario({
      env: {
        SERVER_API_KEY: undefined,
        POSTGRES_URL: "postgres://localhost:5432/test",
        EMBEDDING_API_URL: "https://api.example.test/v1",
        EMBEDDING_MODEL: "text-embedding-3-small",
        EMBEDDING_API_KEY: "embedding-key",
      },
      configFile: { server: { apiKey: "config-admin" } },
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).serverApiKey).toBe("config-admin");
  });

  it("uses env SERVER_API_KEY over config-file server.apiKey", () => {
    const result = runConfigScenario({
      env: {
        SERVER_API_KEY: "env-admin",
        POSTGRES_URL: "postgres://localhost:5432/test",
        EMBEDDING_API_URL: "https://api.example.test/v1",
        EMBEDDING_MODEL: "text-embedding-3-small",
        EMBEDDING_API_KEY: "embedding-key",
      },
      configFile: { server: { apiKey: "config-admin" } },
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).serverApiKey).toBe("env-admin");
  });

  it("allows unauthenticated embedding endpoints", () => {
    expect(validateServerConfig(makeConfig({ embeddingApiKey: "" }))).not.toContain(
      "EMBEDDING_API_KEY is required (or OPENAI_API_KEY)"
    );
  });
});
