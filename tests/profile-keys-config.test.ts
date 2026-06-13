import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerConfig } from "../src/server-config.js";
import { validateServerConfig } from "../src/server-config.js";

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    port: 4747,
    host: "0.0.0.0",
    serverApiKey: "admin",
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
    logLevel: "info",
    clientWelcomeBackThreshold: 168,
    ...overrides,
  };
}

describe("profile key config", () => {
  it("rejects an empty profile key file when client auth is enabled", () => {
    const dir = mkdtempSync(join(tmpdir(), "profile-keys-"));
    const file = join(dir, "keys.json");
    writeFileSync(file, "{}");

    try {
      const errors = validateServerConfig(makeConfig({ profileKeysFile: file }));
      expect(errors).toContain("PROFILE_KEYS_FILE must contain at least one profile key");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
