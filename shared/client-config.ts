// shared/client-config.ts — Client-only config loading (extracted from src/config.ts)
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
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
  profileId?: string;
}

export type ClientConfigSources = Partial<Record<keyof ClientConfig, string>>;

const CLIENT_DEFAULTS: ClientConfig = {
  serverUrl: "http://localhost:4747",
  apiKey: "",
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
    profileId: fileConfig.profileId,
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
  if (!mergedSources.apiKey) {
    mergedSources.apiKey =
      project.sources.profileId ??
      global.sources.profileId ??
      project.sources.serverUrl ??
      global.sources.serverUrl;
  }
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

type TopLevelPropertyLocation =
  | {
      valueStart: number;
      valueEnd: number;
      insertBefore?: never;
    }
  | {
      insertBefore: number;
      needsLeadingComma: boolean;
      valueStart?: never;
      valueEnd?: never;
    };

function skipWhitespace(text: string, index: number): number {
  while (index < text.length && /\s/.test(text[index]!)) index++;
  return index;
}

function skipString(text: string, index: number): number {
  index++;
  while (index < text.length) {
    const char = text[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    index++;
    if (char === '"') break;
  }
  return index;
}

function skipLineComment(text: string, index: number): number {
  index += 2;
  while (index < text.length && text[index] !== "\n") index++;
  return index;
}

function skipBlockComment(text: string, index: number): number {
  const end = text.indexOf("*/", index + 2);
  return end === -1 ? text.length : end + 2;
}

function skipIgnored(text: string, index: number): number {
  while (index < text.length) {
    index = skipWhitespace(text, index);
    if (text.startsWith("//", index)) {
      index = skipLineComment(text, index);
      continue;
    }
    if (text.startsWith("/*", index)) {
      index = skipBlockComment(text, index);
      continue;
    }
    return index;
  }
  return index;
}

function skipValue(text: string, index: number): number {
  let depth = 0;
  while (index < text.length) {
    if (text.startsWith("//", index)) {
      index = skipLineComment(text, index);
      continue;
    }
    if (text.startsWith("/*", index)) {
      index = skipBlockComment(text, index);
      continue;
    }
    const char = text[index];
    if (char === '"') {
      index = skipString(text, index);
      continue;
    }
    if (char === "{" || char === "[") {
      depth++;
      index++;
      continue;
    }
    if (char === "}" || char === "]") {
      if (depth === 0) return index;
      depth--;
      index++;
      continue;
    }
    if (char === "," && depth === 0) return index;
    index++;
  }
  return index;
}

function findTopLevelApiKeyLocation(text: string): TopLevelPropertyLocation {
  let index = skipIgnored(text, 0);
  if (text[index] !== "{") {
    throw new Error("Client config must be a JSON object");
  }
  index++;
  let hasProperty = false;
  let lastTokenWasComma = false;

  while (index < text.length) {
    index = skipIgnored(text, index);
    if (text[index] === "}") {
      return { insertBefore: index, needsLeadingComma: hasProperty && !lastTokenWasComma };
    }
    if (text[index] === ",") {
      lastTokenWasComma = true;
      index++;
      continue;
    }
    if (text[index] !== '"') {
      throw new Error("Client config contains invalid JSONC object syntax");
    }

    const keyStart = index;
    const keyEnd = skipString(text, index);
    const key = JSON.parse(text.slice(keyStart, keyEnd)) as string;
    index = skipIgnored(text, keyEnd);
    if (text[index] !== ":") {
      throw new Error("Client config contains an object key without a value");
    }
    index = skipIgnored(text, index + 1);
    const valueStart = index;
    const valueEnd = skipValue(text, valueStart);
    if (key === "apiKey") return { valueStart, valueEnd };
    hasProperty = true;
    lastTokenWasComma = false;
    index = valueEnd;
  }

  return { insertBefore: index, needsLeadingComma: hasProperty && !lastTokenWasComma };
}

export async function rewriteClientApiKeySource(apiKey: string): Promise<void> {
  const source = CLIENT_CONFIG_SOURCES.apiKey;
  if (!source) {
    throw new Error("Cannot rewrite apiKey because no config source file supplied it");
  }
  const content = readFileSync(source, "utf-8");
  const location = findTopLevelApiKeyLocation(content);
  const encoded = JSON.stringify(apiKey);
  const next =
    "valueStart" in location
      ? `${content.slice(0, location.valueStart)}${encoded}${content.slice(location.valueEnd)}`
      : `${content.slice(0, location.insertBefore)}${
          location.needsLeadingComma ? "," : ""
        }\n  "apiKey": ${encoded}\n${content.slice(location.insertBefore)}`;
  writeFileSync(source, next, "utf-8");
  CLIENT_CONFIG = { ...CLIENT_CONFIG, apiKey };
}

export function isClientConfigured(): boolean {
  return !!CLIENT_CONFIG.serverUrl && !!CLIENT_CONFIG.apiKey;
}
