import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Principal } from "../src/services/auth-service.js";

const distinctTagCalls: unknown[] = [];
const countCalls: unknown[] = [];
const countByTypeCalls: unknown[] = [];

const memoryRepo = {
  initialize: async () => {},
  getDistinctTags: async (args?: unknown) => {
    distinctTagCalls.push(args);
    return [
      { tag: "repo_project_alpha", apiKeyId: "key-1", memoryBankId: "bank-1" },
      { tag: "repo_project_beta", apiKeyId: "key-2", memoryBankId: "bank-2" },
    ];
  },
  count: async (args?: unknown) => {
    countCalls.push(args);
    return 3;
  },
  countByType: async (args?: unknown) => {
    countByTypeCalls.push(args);
    return { fact: 6 };
  },
};

mock.module("../src/services/storage/factory.js", () => ({
  createMemoryRepository: () => memoryRepo,
  createUserPromptRepository: () => ({ initialize: async () => {} }),
  createUserProfileRepository: () => ({ initialize: async () => {} }),
  createClientRepository: () => ({ initialize: async () => {} }),
  createUserApiKeyRepository: () => ({ initialize: async () => {} }),
  createMemoryBankRepository: () => ({ initialize: async () => {} }),
  createTagRegistry: () => ({}),
}));

const { handleListTags, handleStats } =
  await import("../src/services/api-handlers.js?principal-filter-bank-scope");

const principal: Principal = {
  kind: "user-api-key",
  apiKeyId: "key-1",
  apiKeyName: "opencode",
  apiKeyDescription: "OpenCode agent memory access",
};
const scope = {
  principal,
  memoryBank: {
    id: "bank-1",
    apiKeyId: "key-1",
    apiKeyName: "opencode",
    name: "repo",
    description: "repo memory",
    shortcut: "opencode>repo",
    createdAt: 1,
    updatedAt: 1,
  },
};

beforeEach(() => {
  distinctTagCalls.length = 0;
  countCalls.length = 0;
  countByTypeCalls.length = 0;
});

describe("api handler Memory Bank filters", () => {
  it("passes bank ownership to tag storage and filters returned tags defensively", async () => {
    const result = await handleListTags(scope);

    expect(result.success).toBe(true);
    expect(distinctTagCalls.at(-1)).toEqual({
      scope: "project",
      apiKeyId: "key-1",
      memoryBankId: "bank-1",
    });
    expect(result.data?.project.map((tag) => tag.tag)).toEqual(["repo_project_alpha"]);
  });

  it("passes bank ownership into stats counters", async () => {
    const result = await handleStats(scope);

    expect(result.success).toBe(true);
    expect(countCalls).toEqual([
      { scope: "user", profileId: undefined, apiKeyId: "key-1", memoryBankId: "bank-1" },
      { scope: "project", profileId: undefined, apiKeyId: "key-1", memoryBankId: "bank-1" },
    ]);
    expect(countByTypeCalls).toEqual([
      { profileId: undefined, apiKeyId: "key-1", memoryBankId: "bank-1" },
    ]);
  });
});
