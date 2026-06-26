import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Principal } from "../src/services/auth-service.js";

const inserted: any[] = [];
const listedArgs: any[] = [];
const profileCalls: Array<{ method: string; args: any[] }> = [];
const promptCalls: Array<{ method: string; args: any[] }> = [];
const tagRegistryCalls: Array<{ method: string; args: any[] }> = [];
const cleanupCalls: Array<{ method: string; args: any[] }> = [];
const migrationCalls: Array<{ method: string; args: any[] }> = [];
const untaggedCounts = [0, 1, 0];

const memoryRepo = {
  initialize: async () => {},
  insert: async (record: any) => inserted.push(record),
  list: async (args: any) => {
    listedArgs.push(args);
    return [];
  },
  count: async () => 0,
  countByType: async () => ({}),
  getDistinctTags: async () => [],
  getById: async () => null,
  listOlderThan: async (...args: any[]) => {
    cleanupCalls.push({ method: "listOlderThan", args });
    return [];
  },
  getAllWithVectors: async (...args: any[]) => {
    cleanupCalls.push({ method: "getAllWithVectors", args });
    return [];
  },
  countUntagged: async (...args: any[]) => {
    migrationCalls.push({ method: "countUntagged", args });
    return untaggedCounts.shift() ?? 0;
  },
  getDistinctTagValues: async (...args: any[]) => {
    migrationCalls.push({ method: "getDistinctTagValues", args });
    return [];
  },
  getUntaggedProjectMemories: async (...args: any[]) => {
    migrationCalls.push({ method: "getUntaggedProjectMemories", args });
    return [];
  },
};

const promptRepo = {
  initialize: async () => {},
  getCapturedPrompts: async () => [],
  countUnanalyzedForUserLearning: async (...args: any[]) => {
    promptCalls.push({ method: "countUnanalyzedForUserLearning", args });
    return 100;
  },
  getPromptsForUserLearning: async (...args: any[]) => {
    promptCalls.push({ method: "getPromptsForUserLearning", args });
    return [
      {
        id: "prompt-1",
        content: "Prefer focused tests",
        profileId: "bank-1",
        repoId: "repo-1",
        apiKeyId: "key-1",
        memoryBankId: "bank-1",
      },
    ];
  },
  markMultipleAsUserLearningCaptured: async (...args: any[]) => {
    promptCalls.push({ method: "markMultipleAsUserLearningCaptured", args });
  },
  deleteOldPrompts: async (...args: any[]) => {
    promptCalls.push({ method: "deleteOldPrompts", args });
    return { deleted: 0, linkedMemoryIds: [] };
  },
};

const profileRepo = {
  initialize: async () => {},
  getActiveProfile: async (...args: any[]) => {
    profileCalls.push({ method: "getActiveProfile", args });
    return null;
  },
  getProfileChangelogs: async (...args: any[]) => {
    profileCalls.push({ method: "getProfileChangelogs", args });
    return [];
  },
  getChangelogById: async (...args: any[]) => {
    profileCalls.push({ method: "getChangelogById", args });
    return null;
  },
  createProfile: async (...args: any[]) => {
    profileCalls.push({ method: "createProfile", args });
    return "profile-row-1";
  },
  updateProfile: async (...args: any[]) => {
    profileCalls.push({ method: "updateProfile", args });
  },
  mergeProfileData: (_existing: any, updates: any) => updates,
};

const tagRegistry = {
  linkMemoryTags: async (...args: any[]) => {
    tagRegistryCalls.push({ method: "linkMemoryTags", args });
  },
  unlinkMemoryTags: async (...args: any[]) => {
    tagRegistryCalls.push({ method: "unlinkMemoryTags", args });
  },
  getAllCanonicalTags: async (...args: any[]) => {
    tagRegistryCalls.push({ method: "getAllCanonicalTags", args });
    return [];
  },
};

mock.module("../src/services/embedding.js", () => ({
  embeddingService: {
    warmup: async () => {},
    embedWithTimeout: async () => new Float32Array([0.1, 0.2, 0.3]),
  },
}));

mock.module("../src/services/storage/factory.js", () => ({
  createMemoryRepository: () => memoryRepo,
  createUserPromptRepository: () => promptRepo,
  createUserProfileRepository: () => profileRepo,
  createClientRepository: () => ({ initialize: async () => {} }),
  createUserApiKeyRepository: () => ({ initialize: async () => {} }),
  createMemoryBankRepository: () => ({ initialize: async () => {} }),
  createTagRegistry: () => tagRegistry,
}));

mock.module("../src/services/user-profile-learner-server.js", () => ({
  analyzeUserProfile: async () => ({ preferences: [], patterns: [], workflows: [] }),
  generateChangeSummary: async () => "Updated profile",
}));

const {
  handleAddMemory,
  handleCleanup,
  handleDeduplicate,
  handleDetectTagMigration,
  handleGetProfileChangelog,
  handleGetProfileSnapshot,
  handleGetUserProfile,
  handleListMemories,
  handleRunTagMigrationBatch,
  handleUserProfileLearn,
} = await import("../src/services/api-handlers.js?bank-scope");

const principal: Principal = {
  kind: "user-api-key",
  apiKeyId: "key-1",
  apiKeyName: "opencode",
  apiKeyDescription: "OpenCode agent memory access",
};
const bank = {
  id: "bank-1",
  apiKeyId: "key-1",
  apiKeyName: "opencode",
  name: "vllm-setup",
  description: "Work done on vllm-setup repo",
  shortcut: "opencode>vllm-setup",
  createdAt: 1,
  updatedAt: 1,
};

beforeEach(() => {
  inserted.length = 0;
  listedArgs.length = 0;
  profileCalls.length = 0;
  promptCalls.length = 0;
  tagRegistryCalls.length = 0;
  cleanupCalls.length = 0;
  migrationCalls.length = 0;
  untaggedCounts.splice(0, untaggedCounts.length, 0, 1, 0);
});

describe("Memory Bank-scoped handlers", () => {
  it("writes apiKeyId and memoryBankId on added memories", async () => {
    const result = await handleAddMemory(
      {
        content: "Remember the vLLM launch command",
        containerTag: "opencode_project_repo",
        type: "fact",
        tags: ["vllm"],
      },
      { principal, memoryBank: bank }
    );

    expect(result.success).toBe(true);
    expect(inserted[0].apiKeyId).toBe("key-1");
    expect(inserted[0].memoryBankId).toBe("bank-1");
    expect(inserted[0].profileId).toBeUndefined();
  });

  it("lists memories only inside the active Memory Bank", async () => {
    await handleListMemories(undefined, 1, 20, true, { principal, memoryBank: bank });

    expect(listedArgs[0].apiKeyId).toBe("key-1");
    expect(listedArgs[0].memoryBankId).toBe("bank-1");
  });

  it("passes active Memory Bank ownership to canonical tag writes", async () => {
    await handleAddMemory(
      {
        content: "Remember scoped tag writes",
        containerTag: "opencode_project_repo",
        type: "fact",
        tags: ["scoped-tags"],
      },
      { principal, memoryBank: bank }
    );

    expect(tagRegistryCalls).toContainEqual({
      method: "linkMemoryTags",
      args: [expect.stringMatching(/^mem_/), ["scoped-tags"], expectedOwner],
    });
  });

  it("passes active Memory Bank ownership into profile read paths", async () => {
    await handleGetUserProfile(undefined, { principal, memoryBank: bank });
    await handleGetProfileChangelog(undefined, 5, { principal, memoryBank: bank });
    await handleGetProfileSnapshot("changelog-1", { principal, memoryBank: bank });

    expect(profileCalls).toEqual([
      { method: "getActiveProfile", args: ["bank-1", expectedOwner] },
      { method: "getProfileChangelogs", args: ["bank-1", 5, expectedOwner] },
      { method: "getChangelogById", args: ["changelog-1", expectedOwner] },
    ]);
  });

  it("passes active Memory Bank ownership into profile learning prompt paths", async () => {
    await handleUserProfileLearn({}, { principal, memoryBank: bank });

    expect(promptCalls).toEqual([
      { method: "countUnanalyzedForUserLearning", args: ["bank-1", expectedOwner] },
      {
        method: "getPromptsForUserLearning",
        args: [{ profileId: "bank-1", limit: expect.any(Number), ...expectedOwner }],
      },
      { method: "markMultipleAsUserLearningCaptured", args: [["prompt-1"], expectedOwner] },
    ]);
    expect(profileCalls.at(-1)).toEqual({
      method: "createProfile",
      args: ["bank-1", { preferences: [], patterns: [], workflows: [] }, 1, expectedOwner],
    });
  });

  it("passes active Memory Bank ownership into maintenance repository paths", async () => {
    await handleCleanup({
      scope: { kind: "memory-bank", ...expectedOwner },
      skipGuard: true,
    });
    await handleDeduplicate({
      scope: { kind: "memory-bank", ...expectedOwner },
      skipGuard: true,
    });

    expect(promptCalls).toContainEqual({
      method: "deleteOldPrompts",
      args: [{ cutoffTime: expect.any(Number), ...expectedOwner }],
    });
    expect(cleanupCalls).toContainEqual({
      method: "listOlderThan",
      args: [{ cutoffTime: expect.any(Number), limit: 1000, offset: 0, ...expectedOwner }],
    });
    expect(cleanupCalls).toContainEqual({
      method: "getAllWithVectors",
      args: [expectedOwner],
    });
  });

  it("passes active Memory Bank ownership into tag migration detection and run paths", async () => {
    await handleDetectTagMigration({ principal, memoryBank: bank });
    await handleRunTagMigrationBatch(5, { principal, memoryBank: bank });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(migrationCalls).toContainEqual({ method: "countUntagged", args: [expectedOwner] });
    expect(migrationCalls).toContainEqual({
      method: "getDistinctTagValues",
      args: [{ scope: "project", ...expectedOwner }],
    });
  });
});

const expectedOwner = { apiKeyId: "key-1", memoryBankId: "bank-1" };
