import { describe, expect, it } from "bun:test";
import {
  AuthService,
  generateUserApiKeyValue,
  timingSafeEqualString,
} from "../src/services/auth-service.js";

function makeRepos() {
  const userKeys = new Map<string, any>();
  const banks = new Map<string, any>();
  return {
    userApiKeyRepo: {
      initialize: async () => {},
      close: async () => {},
      create: async (args: any) => {
        const row = {
          id: args.id,
          name: args.name,
          description: args.description,
          apiKeyHash: "hash",
          createdAt: 1,
          updatedAt: 1,
          lastUsedAt: null,
          revokedAt: null,
          apiKeyValue: args.apiKeyValue,
        };
        userKeys.set(args.apiKeyValue, row);
        return row;
      },
      list: async () => Array.from(userKeys.values()),
      getById: async (id: string) =>
        Array.from(userKeys.values()).find((row) => row.id === id) ?? null,
      findByApiKey: async (value: string) => userKeys.get(value) ?? null,
      touchLastUsed: async () => {},
      update: async () => null,
      revoke: async () => false,
    },
    memoryBankRepo: {
      initialize: async () => {},
      close: async () => {},
      create: async (args: any) => {
        const row = {
          id: args.id,
          apiKeyId: args.apiKeyId,
          apiKeyName: "opencode",
          name: args.name,
          description: args.description,
          shortcut: `opencode>${args.name}`,
          createdAt: 1,
          updatedAt: 1,
        };
        banks.set(row.id, row);
        return row;
      },
      listForApiKey: async (apiKeyId: string) =>
        Array.from(banks.values()).filter((bank) => bank.apiKeyId === apiKeyId),
      getForApiKey: async (args: any) => {
        const bank = banks.get(args.memoryBankId);
        return bank?.apiKeyId === args.apiKeyId ? bank : null;
      },
      getById: async (id: string) => banks.get(id) ?? null,
      update: async () => null,
      countRowsForBank: async () => ({
        memories: 0,
        prompts: 0,
        profileLearning: 0,
        aiSessions: 0,
        aiMessages: 0,
      }),
      delete: async () => false,
    },
  };
}

describe("AuthService", () => {
  it("generates prefixed user API keys", () => {
    const value = generateUserApiKeyValue();
    expect(value.startsWith("omnu_")).toBe(true);
    expect(value.length).toBeGreaterThan(40);
  });

  it("compares strings through digest equality", () => {
    expect(timingSafeEqualString("same", "same")).toBe(true);
    expect(timingSafeEqualString("same", "different")).toBe(false);
  });

  it("authenticates SERVER_API_KEY as admin", async () => {
    const repos = makeRepos();
    const service = new AuthService({ serverApiKey: "admin-secret", ...repos });
    await expect(service.authenticateBearer("admin-secret")).resolves.toEqual({ kind: "admin" });
  });

  it("creates user API keys and returns the value once", async () => {
    const repos = makeRepos();
    const service = new AuthService({ serverApiKey: "admin-secret", ...repos });
    const created = await service.createUserApiKey({
      name: "opencode",
      description: "OpenCode agent memory access",
    });

    expect(created.value.startsWith("omnu_")).toBe(true);
    expect(created.apiKey.name).toBe("opencode");
    await expect(service.authenticateBearer(created.value)).resolves.toEqual({
      kind: "user-api-key",
      apiKeyId: created.apiKey.id,
      apiKeyName: "opencode",
      apiKeyDescription: "OpenCode agent memory access",
    });
  });

  it("rejects empty names and descriptions", async () => {
    const repos = makeRepos();
    const service = new AuthService({ serverApiKey: "admin-secret", ...repos });

    await expect(service.createUserApiKey({ name: "", description: "desc" })).rejects.toThrow(
      "API key name is required"
    );
    await expect(service.createUserApiKey({ name: "opencode", description: "" })).rejects.toThrow(
      "API key description is required"
    );
  });
});
