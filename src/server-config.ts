// src/server-config.ts
import { randomBytes } from "node:crypto";
import { chmodSync, writeFileSync } from "node:fs";
import {
  loadConfiguredProfiles,
  profileKeyMatchesApiKey,
  profileKeyMatchesServerKey,
  type ConfiguredProfile,
} from "./services/profile-auth.js";
import { resolveSecretValue } from "./services/secret-resolver.js";

const NEWUSER_API_KEY_FILE = "/tmp/opencode-memnet-newuser-api-key";

/**
 * Parse a duration string like "24h", "7d", "1w" into hours.
 * Returns 0 for unparseable values.
 */
export function parseDurationString(input: string): number {
  const match = input.match(/^(\d+)(h|d|w)$/);
  if (!match) return 0;
  const n = parseInt(match[1]!);
  switch (match[2]) {
    case "h":
      return n;
    case "d":
      return n * 24;
    case "w":
      return n * 24 * 7;
    default:
      return 0;
  }
}

export interface ServerConfig {
  port: number;
  host: string;
  serverApiKey: string;
  newUserApiKey: string;
  newUserApiKeyGenerated: boolean;
  newUserApiKeyFile: string | null;
  postgres: {
    url: string;
    ssl: boolean | "require";
    maxConnections: number;
    idleTimeoutSeconds: number;
    connectTimeoutSeconds: number;
    vectorType: "vector" | "halfvec";
    hnswEfSearch: number;
    hnswEfConstruction: number;
  };
  embeddingModel: string;
  embeddingApiUrl: string;
  embeddingApiKey: string;
  embeddingDimensions: number;
  embeddingMaxTokens: { content: number; tags: number; query: number; migration: number };
  embeddingTruncationSide: {
    content: "left" | "right";
    tags: "left" | "right";
    query: "left" | "right";
    migration: "left" | "right";
  };
  similarityThreshold: number;
  maxMemories: number;
  injectProfile: boolean;
  memoryProvider: "openai-chat";
  memoryModel?: string;
  memoryApiUrl?: string;
  memoryApiKey?: string;
  memoryTemperature?: number | false;
  memoryExtraParams?: Record<string, unknown>;
  opencodeProvider?: string;
  opencodeModel?: string;
  autoCaptureMaxIterations: number;
  autoCaptureIterationTimeout: number;
  autoCaptureLanguage: string;
  aiSessionRetentionDays: number;
  userProfileAnalysisInterval: number;
  userProfileMaxPreferences: number;
  userProfileMaxPatterns: number;
  userProfileMaxWorkflows: number;
  userProfileConfidenceDecayDays: number;
  userProfileChangelogRetentionCount: number;
  autoCleanupRetentionDays: number;
  webServerAllowedOrigin: string;
  /** @deprecated Removed. API routes always require SERVER_API_KEY or a profile key. */
  disableWebuiAuth: boolean;
  /** @deprecated Removed. API routes always require SERVER_API_KEY or a profile key. */
  disableClientAuth: boolean;
  profileKeysFile?: string;
  configuredProfiles: ConfiguredProfile[];
  logLevel: "debug" | "info" | "warn" | "error";
  clientWelcomeBackThreshold: number;
  /** @internal When true, tag migration is skipped because LLM config is missing */
  _tagMigrationDisabled?: boolean;
}

function getEmbeddingDimensions(model: string): number {
  const dimensionMap: Record<string, number> = {
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
    "text-embedding-ada-002": 1536,
    "embed-english-v3.0": 1024,
    "embed-multilingual-v3.0": 1024,
    "embed-english-light-v3.0": 384,
    "embed-multilingual-light-v3.0": 384,
    "text-embedding-004": 768,
    "text-multilingual-embedding-002": 768,
    "voyage-3": 1024,
    "voyage-3-lite": 512,
    "voyage-code-3": 1024,
  };
  return dimensionMap[model] || 1024;
}

let _config: ServerConfig | null = null;

function resolveNewUserApiKey(envValue: string | undefined): {
  key: string;
  generated: boolean;
  file: string | null;
} {
  const configured = envValue?.trim();
  if (configured) return { key: configured, generated: false, file: null };

  const key = randomBytes(32).toString("base64url");
  writeFileSync(NEWUSER_API_KEY_FILE, `${key}\n`, { mode: 0o600 });
  chmodSync(NEWUSER_API_KEY_FILE, 0o600);
  console.warn(
    `[opencode-memnet] NEWUSER_API_KEY was not configured; generated a temporary bootstrap key at ${NEWUSER_API_KEY_FILE}. Read this file inside the container. It is invalid after the next server restart.`
  );
  return { key, generated: true, file: NEWUSER_API_KEY_FILE };
}

export function initServerConfig(): ServerConfig {
  if (_config) return _config;
  const env = process.env;
  const newUserApiKey = resolveNewUserApiKey(env.NEWUSER_API_KEY);
  _config = {
    port: parseInt(env.SERVER_PORT || "4747"),
    host: env.SERVER_HOST || "0.0.0.0",
    serverApiKey: env.SERVER_API_KEY || "",
    newUserApiKey: newUserApiKey.key,
    newUserApiKeyGenerated: newUserApiKey.generated,
    newUserApiKeyFile: newUserApiKey.file,
    postgres: {
      url: resolveSecretValue(env.POSTGRES_URL) || "",
      ssl: env.POSTGRES_SSL === "false" ? false : (env.POSTGRES_SSL as "require") || "require",
      maxConnections: parseInt(env.POSTGRES_MAX_CONNECTIONS || "10"),
      idleTimeoutSeconds: parseInt(env.POSTGRES_IDLE_TIMEOUT_SECONDS || "30"),
      connectTimeoutSeconds: parseInt(env.POSTGRES_CONNECT_TIMEOUT_SECONDS || "10"),
      vectorType: (env.POSTGRES_VECTOR_TYPE as "vector" | "halfvec") || "vector",
      hnswEfSearch: parseInt(env.POSTGRES_HNSW_EF_SEARCH || "128"),
      hnswEfConstruction: parseInt(env.POSTGRES_HNSW_EF_CONSTRUCTION || "256"),
    },
    embeddingModel: env.EMBEDDING_MODEL || "",
    embeddingApiUrl: env.EMBEDDING_API_URL || "",
    embeddingApiKey: resolveSecretValue(env.EMBEDDING_API_KEY || "") || env.OPENAI_API_KEY || "",
    embeddingDimensions:
      parseInt(env.EMBEDDING_DIMENSIONS || "0") ||
      getEmbeddingDimensions(env.EMBEDDING_MODEL || ""),
    embeddingMaxTokens: {
      content: parseInt(env.EMBEDDING_MAX_TOKENS_CONTENT || "2048"),
      tags: parseInt(env.EMBEDDING_MAX_TOKENS_TAGS || "256"),
      query: parseInt(env.EMBEDDING_MAX_TOKENS_QUERY || "512"),
      migration: parseInt(env.EMBEDDING_MAX_TOKENS_MIGRATION || "2048"),
    },
    embeddingTruncationSide: {
      content: (env.EMBEDDING_TRUNCATION_CONTENT as "left" | "right") || "right",
      tags: (env.EMBEDDING_TRUNCATION_TAGS as "left" | "right") || "right",
      query: (env.EMBEDDING_TRUNCATION_QUERY as "left" | "right") || "right",
      migration: (env.EMBEDDING_TRUNCATION_MIGRATION as "left" | "right") || "right",
    },
    similarityThreshold: parseFloat(env.SIMILARITY_THRESHOLD || "0.6"),
    maxMemories: parseInt(env.MAX_MEMORIES || "10"),
    injectProfile: env.INJECT_PROFILE !== "false",
    memoryProvider: "openai-chat",
    memoryModel: env.MEMORY_MODEL || undefined,
    memoryApiUrl: env.MEMORY_API_URL || undefined,
    memoryApiKey: resolveSecretValue(env.MEMORY_API_KEY || "") || undefined,
    memoryTemperature:
      env.MEMORY_TEMPERATURE === "false"
        ? false
        : env.MEMORY_TEMPERATURE
          ? parseFloat(env.MEMORY_TEMPERATURE)
          : 0.3,
    opencodeProvider: env.OPENCODE_PROVIDER || undefined,
    opencodeModel: env.OPENCODE_MODEL || undefined,
    autoCaptureMaxIterations: parseInt(env.AUTO_CAPTURE_MAX_ITERATIONS || "5"),
    autoCaptureIterationTimeout: parseInt(env.AUTO_CAPTURE_ITERATION_TIMEOUT || "30000"),
    autoCaptureLanguage: env.AUTO_CAPTURE_LANGUAGE || "auto",
    aiSessionRetentionDays: parseInt(env.AI_SESSION_RETENTION_DAYS || "7"),
    userProfileAnalysisInterval: parseInt(env.USER_PROFILE_ANALYSIS_INTERVAL || "10"),
    userProfileMaxPreferences: parseInt(env.USER_PROFILE_MAX_PREFERENCES || "20"),
    userProfileMaxPatterns: parseInt(env.USER_PROFILE_MAX_PATTERNS || "15"),
    userProfileMaxWorkflows: parseInt(env.USER_PROFILE_MAX_WORKFLOWS || "10"),
    userProfileConfidenceDecayDays: parseInt(env.USER_PROFILE_CONFIDENCE_DECAY_DAYS || "30"),
    userProfileChangelogRetentionCount: parseInt(env.USER_PROFILE_CHANGELOG_RETENTION || "5"),
    autoCleanupRetentionDays: parseInt(env.AUTO_CLEANUP_RETENTION_DAYS || "90"),
    webServerAllowedOrigin: env.WEB_SERVER_ALLOWED_ORIGIN || "*",
    disableWebuiAuth: env.DISABLE_WEBUI_AUTH === "true",
    disableClientAuth: env.DISABLE_CLIENT_AUTH === "true",
    profileKeysFile: env.PROFILE_KEYS_FILE || undefined,
    configuredProfiles: loadConfiguredProfiles(env.PROFILE_KEYS_FILE || undefined),
    logLevel:
      (env.LOG_LEVEL as "debug" | "info" | "warn" | "error") ||
      (env.DEBUG === "true" || env.DEBUG === "1" ? "debug" : "info"),
    clientWelcomeBackThreshold: parseDurationString(env.CLIENT_WELCOME_BACK_THRESHOLD || "7d"),
  };
  return _config;
}

export function getServerConfig(): ServerConfig {
  if (!_config) throw new Error("Server config not initialized. Call initServerConfig() first.");
  return _config;
}

export function validateServerConfig(config: ServerConfig): string[] {
  const errors: string[] = [];
  const configuredProfiles = config.configuredProfiles ?? [];
  if (!config.postgres.url?.trim()) errors.push("POSTGRES_URL is required");
  else if (
    !config.postgres.url.startsWith("postgresql://") &&
    !config.postgres.url.startsWith("postgres://")
  ) {
    errors.push("POSTGRES_URL must start with postgresql:// or postgres://");
  }
  if (!config.embeddingApiUrl) errors.push("EMBEDDING_API_URL is required");
  if (!config.embeddingModel) errors.push("EMBEDDING_MODEL is required");
  if (!config.embeddingApiKey) errors.push("EMBEDDING_API_KEY is required (or OPENAI_API_KEY)");
  if (!config.serverApiKey) {
    errors.push("SERVER_API_KEY is required");
  }
  if (config.disableWebuiAuth) {
    errors.push("DISABLE_WEBUI_AUTH has been removed; use SERVER_API_KEY or profile keys");
  }
  if (config.disableClientAuth) {
    errors.push("DISABLE_CLIENT_AUTH has been removed; use SERVER_API_KEY or profile keys");
  }
  if (config.profileKeysFile && configuredProfiles.length === 0) {
    errors.push("PROFILE_KEYS_FILE must contain at least one profile key");
  }
  if (profileKeyMatchesServerKey(configuredProfiles, config.serverApiKey)) {
    errors.push("PROFILE_KEYS_FILE contains a profile apiKey that matches SERVER_API_KEY");
  }
  if (config.newUserApiKey && config.serverApiKey && config.newUserApiKey === config.serverApiKey) {
    errors.push("NEWUSER_API_KEY must not match SERVER_API_KEY");
  }
  if (profileKeyMatchesApiKey(configuredProfiles, config.newUserApiKey)) {
    errors.push("NEWUSER_API_KEY must not match any PROFILE_KEYS_FILE apiKey");
  }

  // Validate LLM provider config for tag migration
  if (!config.memoryModel || !config.memoryApiUrl) {
    console.warn(
      "[opencode-memnet] [WARN] MEMORY_MODEL and/or MEMORY_API_URL are not configured. LLM tagging will be disabled."
    );
    config._tagMigrationDisabled = true;
  } else {
    config._tagMigrationDisabled = false;
  }

  return errors;
}
