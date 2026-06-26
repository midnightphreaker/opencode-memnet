import { describe, expect, it, mock } from "bun:test";

mock.module("../src/services/storage/factory.js", () => ({
  createMemoryRepository: () => ({ initialize: async () => {} }),
  createUserPromptRepository: () => ({ initialize: async () => {} }),
  createUserProfileRepository: () => ({ initialize: async () => {} }),
  createClientRepository: () => ({
    initialize: async () => {},
    upsertClient: async () => ({
      firstTime: true,
      previousLastSeen: null,
      row: { id: "client-1" },
    }),
    getClientStatsForBank: async (args: any) => {
      if (args.apiKeyId !== "key-1" || args.memoryBankId !== "bank-1") {
        throw new Error("Memory Bank not found for API key");
      }
      return { totalMemories: 0, memoriesToday: 0, totalPrompts: 0 };
    },
  }),
  createUserApiKeyRepository: () => ({ initialize: async () => {} }),
  createMemoryBankRepository: () => ({
    initialize: async () => {},
    listForApiKey: async () => [],
  }),
  createTagRegistry: () => ({}),
}));

const { handleClientConnect } = await import("../src/services/api-handlers.js?client-connect-v2");

const authService = {
  requireBankForPrincipal: async (principal: any, memoryBankId: string) => {
    if (principal.apiKeyId !== "key-1" || memoryBankId !== "bank-1") {
      throw new Error("Memory Bank not found for API key");
    }
    return { id: "bank-1", apiKeyId: "key-1" };
  },
};

describe("v2 client connect", () => {
  it("returns API key identity and empty Memory Bank list without enrollment", async () => {
    const result = await handleClientConnect(
      { clientId: "client-1", metadata: { projectName: "vllm-setup" } },
      {
        kind: "user-api-key",
        apiKeyId: "key-1",
        apiKeyName: "opencode",
        apiKeyDescription: "OpenCode agent memory access",
      },
      authService as any
    );

    expect(result.success).toBe(true);
    expect(result.data?.principal).toEqual({
      kind: "user-api-key",
      apiKeyId: "key-1",
      apiKeyName: "opencode",
      apiKeyDescription: "OpenCode agent memory access",
    });
    expect(result.data?.memoryBanks).toEqual([]);
    expect(result.data?.requiresMemoryBank).toBe(true);
    expect(result.data?.stats).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("enrollment");
    expect(JSON.stringify(result)).not.toContain("profileId");
    expect(JSON.stringify(result)).not.toContain("firstTime");
    expect(JSON.stringify(result)).not.toContain("welcomeBack");
  });

  it("authorizes requested stats Memory Bank before reading scoped stats", async () => {
    const result = await handleClientConnect(
      {
        clientId: "client-1",
        includeStats: true,
        memoryBankId: "other-key-bank",
      },
      {
        kind: "user-api-key",
        apiKeyId: "key-1",
        apiKeyName: "opencode",
        apiKeyDescription: "OpenCode agent memory access",
      },
      authService as any
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Memory Bank");
  });
});
