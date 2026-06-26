// shared/client-config.ts — Client-only config loading (extracted from src/config.ts)
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { stripJsoncComments } from "./jsonc.js";
import { initLogger } from "./logger.js";

const CONFIG_DIR = join(homedir(), ".config", "opencode");
const CONFIG_FILES = [
  join(CONFIG_DIR, "opencode-memnet.jsonc"),
  join(CONFIG_DIR, "opencode-memnet.json"),
];

if (!existsSync(CONFIG_DIR)) {
  mkdirSync(CONFIG_DIR, { recursive: true });
}

// ── Client Config ─────────────────────────────────────────────

export interface ClientConfig {
  serverUrl: string;
  apiKey: string;
  memoryBankId?: string;
  autoCaptureEnabled: boolean;
  showAutoCaptureToasts: boolean;
  showErrorToasts: boolean;
  chatMessage: {
    enabled: boolean;
    maxMemories: number;
    excludeCurrentSession: boolean;
    maxAgeDays?: number;
    injectOn: "first" | "always";
  };
  customMessage: {
    enabled: boolean;
    frequency: "first" | "always";
    text: string;
  };
  memory: {
    defaultScope: "project" | "all-projects";
  };
  logLevel?: "debug" | "info" | "warn" | "error";
}

export type ClientConfigSources = Partial<Record<keyof ClientConfig, string>>;

const CLIENT_DEFAULTS: ClientConfig = {
  serverUrl: "http://localhost:4747",
  apiKey: "",
  memoryBankId: undefined,
  autoCaptureEnabled: true,
  showAutoCaptureToasts: true,
  showErrorToasts: true,
  chatMessage: {
    enabled: true,
    maxMemories: 3,
    excludeCurrentSession: true,
    maxAgeDays: undefined,
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
  logLevel: undefined,
};

function buildClientConfig(fileConfig: Partial<ClientConfig>): ClientConfig {
  return {
    serverUrl: fileConfig.serverUrl ?? CLIENT_DEFAULTS.serverUrl,
    apiKey: fileConfig.apiKey ?? CLIENT_DEFAULTS.apiKey,
    memoryBankId: fileConfig.memoryBankId ?? CLIENT_DEFAULTS.memoryBankId,
    autoCaptureEnabled: fileConfig.autoCaptureEnabled ?? CLIENT_DEFAULTS.autoCaptureEnabled,
    showAutoCaptureToasts:
      fileConfig.showAutoCaptureToasts ?? CLIENT_DEFAULTS.showAutoCaptureToasts,
    showErrorToasts: fileConfig.showErrorToasts ?? CLIENT_DEFAULTS.showErrorToasts,
    chatMessage: {
      enabled: fileConfig.chatMessage?.enabled ?? CLIENT_DEFAULTS.chatMessage.enabled,
      maxMemories: fileConfig.chatMessage?.maxMemories ?? CLIENT_DEFAULTS.chatMessage.maxMemories,
      excludeCurrentSession:
        fileConfig.chatMessage?.excludeCurrentSession ??
        CLIENT_DEFAULTS.chatMessage.excludeCurrentSession,
      maxAgeDays: fileConfig.chatMessage?.maxAgeDays,
      injectOn: (fileConfig.chatMessage?.injectOn ?? CLIENT_DEFAULTS.chatMessage.injectOn) as
        | "first"
        | "always",
    },
    customMessage: {
      enabled: fileConfig.customMessage?.enabled ?? CLIENT_DEFAULTS.customMessage.enabled,
      frequency: (fileConfig.customMessage?.frequency ??
        CLIENT_DEFAULTS.customMessage.frequency) as "first" | "always",
      text: fileConfig.customMessage?.text ?? CLIENT_DEFAULTS.customMessage.text,
    },
    memory: {
      defaultScope: fileConfig.memory?.defaultScope ?? CLIENT_DEFAULTS.memory.defaultScope,
    },
    logLevel: fileConfig.logLevel ?? CLIENT_DEFAULTS.logLevel,
  };
}

// Helper: load first existing JSON/JSONC config file from a list of paths
function loadConfigFromPaths(paths: string[]): {
  config: Partial<ClientConfig>;
  sources: ClientConfigSources;
} {
  for (const path of paths) {
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, "utf-8");
        const json = stripJsoncComments(content);
        const config = JSON.parse(json) as Partial<ClientConfig>;
        const sources: ClientConfigSources = {};
        for (const key of Object.keys(config) as (keyof ClientConfig)[]) {
          sources[key] = path;
        }
        return { config, sources };
      } catch (err) {
        console.warn("[client-config] Failed to parse:", path, String(err));
      }
    }
  }
  return { config: {}, sources: {} };
}

export let CLIENT_CONFIG = buildClientConfig({});
export let CLIENT_CONFIG_SOURCES: ClientConfigSources = {};

export function initClientConfig(directory: string): void {
  const projectPaths = [
    join(directory, ".opencode", "opencode-memnet.jsonc"),
    join(directory, ".opencode", "opencode-memnet.json"),
  ];
  const global = loadConfigFromPaths(CONFIG_FILES);
  const project = loadConfigFromPaths(projectPaths);
  const globalConfig = global.config;
  const projectConfig = project.config;
  const merged: Partial<ClientConfig> = { ...globalConfig, ...projectConfig };
  const mergedSources: ClientConfigSources = { ...global.sources, ...project.sources };
  if (globalConfig.chatMessage && projectConfig.chatMessage) {
    merged.chatMessage = { ...globalConfig.chatMessage, ...projectConfig.chatMessage };
  }
  if (globalConfig.memory && projectConfig.memory) {
    merged.memory = { ...globalConfig.memory, ...projectConfig.memory };
  }
  if (globalConfig.customMessage && projectConfig.customMessage) {
    merged.customMessage = { ...globalConfig.customMessage, ...projectConfig.customMessage };
  }
  CLIENT_CONFIG = buildClientConfig(merged);
  CLIENT_CONFIG_SOURCES = mergedSources;
  // Initialize logger with config level (env var fallback handled inside initLogger)
  if (CLIENT_CONFIG.logLevel) {
    initLogger({ level: CLIENT_CONFIG.logLevel });
  }
}

export function isClientConfigured(): boolean {
  return !!CLIENT_CONFIG.serverUrl && !!CLIENT_CONFIG.apiKey;
}
