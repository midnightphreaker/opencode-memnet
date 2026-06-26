import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseJsonc as parseJsoncFile } from "./jsonc";

export interface CodexMemnetConfig {
  serverUrl: string;
  apiKey: string;
  memoryBankId?: string;
  nickname?: string;
  timeoutMs: number;
  memory: {
    defaultScope: "project" | "all-projects";
  };
  context: {
    maxMemories: number;
    maxAgeDays: number | null;
    excludeCurrentSession: boolean;
  };
  capture: {
    enabled: boolean;
    includeRawHookPayload: boolean;
  };
}

export type CodexMemnetConfigInput = DeepPartial<CodexMemnetConfig>;
export { parseJsoncFile as parseJsonc };

const DEFAULT_CONFIG: CodexMemnetConfig = {
  serverUrl: "",
  apiKey: "",
  memoryBankId: undefined,
  timeoutMs: 30_000,
  memory: {
    defaultScope: "project",
  },
  context: {
    maxMemories: 5,
    maxAgeDays: null,
    excludeCurrentSession: true,
  },
  capture: {
    enabled: true,
    includeRawHookPayload: false,
  },
};

type ConfigEnv = Record<string, string | undefined>;

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object
    ? T[K] extends Array<unknown>
      ? T[K]
      : DeepPartial<T[K]>
    : T[K];
};

function deepMerge<T extends object>(base: T, override: DeepPartial<T>): T {
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };

  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) {
      continue;
    }

    const baseValue = result[key];
    if (isPlainObject(baseValue) && isPlainObject(value)) {
      result[key] = deepMerge(baseValue, value);
      continue;
    }

    result[key] = value;
  }

  return result as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function mergeConfig(
  user: CodexMemnetConfigInput,
  project: CodexMemnetConfigInput,
  env: ConfigEnv = process.env
): CodexMemnetConfig {
  const merged = deepMerge(deepMerge(DEFAULT_CONFIG, user), project);
  delete (merged as CodexMemnetConfig & { profileId?: string }).profileId;

  if (!merged.serverUrl && env.OPENCODE_MEMNET_SERVER_URL) {
    merged.serverUrl = env.OPENCODE_MEMNET_SERVER_URL;
  }
  if (!merged.apiKey && env.OPENCODE_MEMNET_API_KEY) {
    merged.apiKey = env.OPENCODE_MEMNET_API_KEY;
  }
  if (!merged.nickname && env.OPENCODE_MEMNET_NICKNAME) {
    merged.nickname = env.OPENCODE_MEMNET_NICKNAME;
  }
  if (!merged.memoryBankId && env.OPENCODE_MEMNET_MEMORY_BANK_ID) {
    merged.memoryBankId = env.OPENCODE_MEMNET_MEMORY_BANK_ID;
  }

  return merged;
}

export function loadConfig(cwd = process.cwd()): CodexMemnetConfig {
  const userPath = getUserConfigPath();
  const projectPath = join(cwd, ".codex", "opencode-memnet.jsonc");
  return loadConfigFromPaths({ userPath, projectPath });
}

export function getUserConfigPath(home = homedir()): string {
  return join(home, ".codex", "opencode-memnet.jsonc");
}

export function loadConfigFromPaths({
  userPath,
  projectPath,
  env = process.env,
}: {
  userPath: string;
  projectPath: string;
  env?: ConfigEnv;
}): CodexMemnetConfig {
  return mergeConfig(readConfigFile(userPath), readConfigFile(projectPath), env);
}

export function assertConfigured(config: CodexMemnetConfig): void {
  if (!config.serverUrl) {
    throw new Error("Missing serverUrl");
  }
  if (!config.apiKey) {
    throw new Error("Missing apiKey");
  }
}

function readConfigFile(path: string): CodexMemnetConfigInput {
  if (!existsSync(path)) {
    return {};
  }
  return parseJsoncFile<CodexMemnetConfigInput>(readFileSync(path, "utf8"));
}
