import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getUserConfigPath,
  loadConfigFromPaths,
  mergeConfig,
  parseJsonc,
  type CodexMemnetConfigInput,
} from "../src/config";

const legacyProfileEnv = ["OPENCODE", "MEMNET", "PROFILE", "ID"].join("_");

describe("mergeConfig", () => {
  test("uses Codex home for the default user config path", () => {
    expect(getUserConfigPath("/home/example")).toBe("/home/example/.codex/opencode-memnet.jsonc");
  });

  test("project config overrides user config and env fills missing values", () => {
    const user: CodexMemnetConfigInput = {
      serverUrl: "http://user.example",
      apiKey: "user-key",
      context: { maxMemories: 3 },
    };
    const project: CodexMemnetConfigInput = {
      serverUrl: "http://project.example",
      nickname: "Codex Workstation",
    };
    const env = {
      OPENCODE_MEMNET_API_KEY: "env-key",
      OPENCODE_MEMNET_NICKNAME: "Env Name",
    };

    const result = mergeConfig(user, project, env);

    expect(result.serverUrl).toBe("http://project.example");
    expect(result.apiKey).toBe("user-key");
    expect(result.nickname).toBe("Codex Workstation");
    expect(result.context.maxMemories).toBe(3);
    expect(result.context.excludeCurrentSession).toBe(true);
  });

  test("returns concrete defaults for nested resolved config", () => {
    const result = mergeConfig({}, {}, {});

    expect(result.context.maxMemories).toBe(5);
    expect(result.context.excludeCurrentSession).toBe(true);
    expect(result.capture.enabled).toBe(true);
    expect(result.memory.defaultScope).toBe("project");
  });

  test("env fills missing server url, api key, and nickname", () => {
    const result = mergeConfig(
      {},
      {},
      {
        OPENCODE_MEMNET_SERVER_URL: "http://env.example",
        OPENCODE_MEMNET_API_KEY: "env-key",
        OPENCODE_MEMNET_NICKNAME: "Env Name",
      }
    );

    expect(result.serverUrl).toBe("http://env.example");
    expect(result.apiKey).toBe("env-key");
    expect(result.nickname).toBe("Env Name");
  });

  test("parses JSONC config with comments and trailing commas", () => {
    const parsed = parseJsonc<CodexMemnetConfigInput>(`
      {
        // user-local server
        "serverUrl": "http://jsonc.example",
        "context": {
          "maxMemories": 9,
        },
      }
    `);

    expect(parsed.serverUrl).toBe("http://jsonc.example");
    expect(parsed.context?.maxMemories).toBe(9);
  });

  test("loads user and project JSONC from injected paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-config-"));
    const userPath = join(dir, "user.jsonc");
    const projectPath = join(dir, "project.jsonc");

    try {
      writeFileSync(
        userPath,
        `{
          "serverUrl": "http://user.example",
          "apiKey": "user-key",
        }`
      );
      writeFileSync(
        projectPath,
        `{
          "serverUrl": "http://project.example",
          "capture": { "enabled": false },
        }`
      );

      const result = loadConfigFromPaths({ userPath, projectPath, env: {} });

      expect(result.serverUrl).toBe("http://project.example");
      expect(result.apiKey).toBe("user-key");
      expect(result.capture.enabled).toBe(false);
      expect(result.capture.includeRawHookPayload).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("ignores legacy profileId config and environment fields", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-config-profile-"));
    const userPath = join(dir, "user.jsonc");
    const projectPath = join(dir, "project.jsonc");

    try {
      writeFileSync(userPath, `{}`);
      writeFileSync(
        projectPath,
        `{
          "profileId": "profile-project-1",
        }`
      );

      const result = loadConfigFromPaths({
        userPath,
        projectPath,
        env: { [legacyProfileEnv]: "profile-env-1" },
      });

      expect("profileId" in result).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
