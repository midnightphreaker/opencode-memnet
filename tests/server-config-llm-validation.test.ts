import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import type { ServerConfig } from "../src/server-config.js";

// We need to re-import for each test since validateServerConfig is stateless
// but we need fresh module references for spying on log
const { validateServerConfig } = await import("../src/server-config.js");

function makeBaseConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    port: 4747,
    host: "0.0.0.0",
    serverApiKey: "test-key",
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
    embeddingApiUrl: "https://api.openai.com/v1",
    embeddingApiKey: "sk-test",
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
    memoryModel: "gpt-4o-mini",
    memoryApiUrl: "https://api.openai.com/v1",
    memoryApiKey: "sk-test",
    memoryTemperature: 0.3,
    opencodeProvider: undefined,
    opencodeModel: undefined,
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
  } as ServerConfig;
}

describe("validateServerConfig — LLM provider validation", () => {
  it("should not return errors or set _tagMigrationDisabled when both memoryModel and memoryApiUrl are present", () => {
    const config = makeBaseConfig({
      memoryModel: "gpt-4o-mini",
      memoryApiUrl: "https://api.openai.com/v1",
    });
    const errors = validateServerConfig(config);
    expect(errors).not.toContain(expect.stringContaining("MEMORY_MODEL"));
    expect((config as any)._tagMigrationDisabled).toBeFalsy();
  });

  it("should set _tagMigrationDisabled to true when memoryModel is missing", () => {
    const config = makeBaseConfig({
      memoryModel: undefined,
      memoryApiUrl: "https://api.openai.com/v1",
    });
    const errors = validateServerConfig(config);
    expect((config as any)._tagMigrationDisabled).toBe(true);
    // Should be a warning (not an error), so no error about MEMORY_MODEL in errors array
    // The design says "warn, not fail"
    expect(errors).not.toContain(expect.stringContaining("MEMORY_MODEL"));
  });

  it("should set _tagMigrationDisabled to true when memoryApiUrl is missing", () => {
    const config = makeBaseConfig({
      memoryModel: "gpt-4o-mini",
      memoryApiUrl: undefined,
    });
    const errors = validateServerConfig(config);
    expect((config as any)._tagMigrationDisabled).toBe(true);
  });

  it("should set _tagMigrationDisabled to true when both memoryModel and memoryApiUrl are missing", () => {
    const config = makeBaseConfig({
      memoryModel: undefined,
      memoryApiUrl: undefined,
    });
    const errors = validateServerConfig(config);
    expect((config as any)._tagMigrationDisabled).toBe(true);
  });

  it("should NOT set _tagMigrationDisabled when both are configured", () => {
    const config = makeBaseConfig({
      memoryModel: "gpt-4o-mini",
      memoryApiUrl: "https://api.openai.com/v1",
    });
    validateServerConfig(config);
    expect((config as any)._tagMigrationDisabled).toBeFalsy();
  });

  it("should still return required-field errors when embedding/postgres config is missing", () => {
    const config = makeBaseConfig({
      memoryModel: undefined,
      memoryApiUrl: undefined,
      embeddingApiUrl: "",
      embeddingModel: "",
    });
    const errors = validateServerConfig(config);
    // Should still have the normal required-field errors
    expect(errors.length).toBeGreaterThan(0);
    // And _tagMigrationDisabled should be set
    expect((config as any)._tagMigrationDisabled).toBe(true);
  });
});
