import { beforeEach, describe, expect, it, mock } from "bun:test";

type TestMemoryRow = {
  id: string;
  content: string;
  containerTag: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  profileId: string;
  repoId: string;
  metadata?: Record<string, unknown>;
  isPinned?: boolean;
};

type TestMemoryRecord = Omit<TestMemoryRow, "tags"> & {
  vector: Float32Array;
  tags?: string;
};

const calls = {
  deleteOldPrompts: [] as unknown[],
  listOlderThan: [] as unknown[],
  getAllWithVectors: [] as unknown[],
  memoryDeletes: [] as string[],
};

let staleMemories: TestMemoryRow[] = [];
let vectorMemories: TestMemoryRecord[] = [];

const memoryRepo = {
  initialize: async () => {},
  listOlderThan: async (...args: unknown[]) => {
    calls.listOlderThan.push(args);
    return staleMemories;
  },
  getAllWithVectors: async (...args: unknown[]) => {
    calls.getAllWithVectors.push(args);
    return vectorMemories;
  },
  delete: async (id: string) => {
    calls.memoryDeletes.push(id);
    return true;
  },
};

const promptRepo = {
  initialize: async () => {},
  deleteOldPrompts: async (...args: unknown[]) => {
    calls.deleteOldPrompts.push(args);
    return { deleted: 1, linkedMemoryIds: [] };
  },
};

mock.module("../src/services/storage/factory.js", () => ({
  createMemoryRepository: () => memoryRepo,
  createUserPromptRepository: () => promptRepo,
  createUserProfileRepository: () => ({ initialize: async () => {} }),
  createClientRepository: () => ({ initialize: async () => {} }),
  createProfileApiKeyRepository: () => ({
    initialize: async () => {},
    findProfileByApiKey: async () => null,
    hasKeyForProfile: async () => false,
    createKeyForProfile: async () => true,
    touchLastUsed: async () => {},
  }),
  createTagRegistry: () => ({}),
}));

mock.module("../src/services/embedding.js", () => ({
  embeddingService: {
    warmup: async () => {},
    embedWithTimeout: async () => new Float32Array([1, 0, 0]),
  },
}));

const { handleCleanup, handleDeduplicate } =
  await import("../src/services/api-handlers.js?profile-key-maintenance-scope");

function staleMemory(
  id: string,
  profileId: string,
  options: Partial<TestMemoryRow> = {}
): TestMemoryRow {
  return {
    id,
    content: `content ${id}`,
    containerTag: `opencode_project_${profileId}_repo`,
    tags: ["tag"],
    createdAt: 1,
    updatedAt: 1,
    profileId,
    repoId: "repo",
    ...options,
  };
}

function vectorMemory(
  id: string,
  profileId: string,
  vector: Float32Array,
  options: Partial<TestMemoryRecord> = {}
): TestMemoryRecord {
  return {
    id,
    content: `content ${id}`,
    containerTag: `opencode_project_${profileId}_repo`,
    vector,
    tags: "tag",
    createdAt: 1,
    updatedAt: 1,
    profileId,
    repoId: "repo",
    ...options,
  };
}

beforeEach(() => {
  calls.deleteOldPrompts = [];
  calls.listOlderThan = [];
  calls.getAllWithVectors = [];
  calls.memoryDeletes = [];
  staleMemories = [];
  vectorMemories = [];
});

describe("profile-key maintenance scope", () => {
  it("passes profile scope into cleanup repositories and only deletes that profile", async () => {
    staleMemories = [
      staleMemory("own-delete", "phrkr"),
      staleMemory("own-pinned", "phrkr", { isPinned: true }),
      staleMemory("own-prompt-derived", "phrkr", { metadata: { promptId: "prompt-1" } }),
      staleMemory("other-delete", "other"),
    ];

    const result = await handleCleanup({
      scope: { kind: "profile", profileId: "phrkr" },
      skipGuard: true,
    });

    expect(result.success).toBe(true);
    expect(calls.deleteOldPrompts[0]).toEqual([
      { cutoffTime: expect.any(Number), profileId: "phrkr" },
    ]);
    expect(calls.listOlderThan[0]).toEqual([
      { cutoffTime: expect.any(Number), limit: 1000, offset: 0, profileId: "phrkr" },
    ]);
    expect(calls.memoryDeletes).toEqual(["own-delete"]);
    expect(result.data?.deletedMemories).toBe(1);
  });

  it("leaves cleanup global when the job scope is all", async () => {
    staleMemories = [staleMemory("global-delete", "phrkr")];

    const result = await handleCleanup({ scope: { kind: "all" }, skipGuard: true });

    expect(result.success).toBe(true);
    expect(calls.deleteOldPrompts[0]).toEqual([{ cutoffTime: expect.any(Number) }]);
    expect(calls.listOlderThan[0]).toEqual([
      { cutoffTime: expect.any(Number), limit: 1000, offset: 0 },
    ]);
    expect(calls.memoryDeletes).toEqual(["global-delete"]);
  });

  it("passes profile scope into deduplication and only removes that profile duplicates", async () => {
    vectorMemories = [
      vectorMemory("own-new", "phrkr", new Float32Array([1, 0, 0]), { updatedAt: 20 }),
      vectorMemory("own-old", "phrkr", new Float32Array([1, 0, 0]), { updatedAt: 10 }),
      vectorMemory("other-new", "other", new Float32Array([1, 0, 0]), { updatedAt: 20 }),
      vectorMemory("other-old", "other", new Float32Array([1, 0, 0]), { updatedAt: 10 }),
    ];

    const result = await handleDeduplicate({
      scope: { kind: "profile", profileId: "phrkr" },
      skipGuard: true,
    });

    expect(result.success).toBe(true);
    expect(calls.getAllWithVectors[0]).toEqual([{ profileId: "phrkr" }]);
    expect(calls.memoryDeletes).toEqual(["own-old"]);
    expect(result.data?.duplicatesRemoved).toBe(1);
  });
});
