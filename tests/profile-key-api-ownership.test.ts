import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Principal } from "../src/services/profile-auth.js";

type TestMemory = {
  id: string;
  content: string;
  containerTag: string;
  type: "fact";
  tags?: string;
  createdAt: number;
  updatedAt: number;
  metadata?: string | Record<string, unknown>;
  profileId?: string;
  repoId?: string;
};

type TestPrompt = {
  id: string;
  sessionId: string;
  content: string;
  createdAt: number;
  profileId: string;
  repoId: string;
  localProjectPath: string | null;
  linkedMemoryId: string | null;
};

type TestChangelog = {
  id: string;
  profileId: string;
  version: number;
  changeType: string;
  changeSummary: string;
  profileDataSnapshot: string;
  createdAt: number;
};

const memories = new Map<string, TestMemory>();
const prompts = new Map<string, TestPrompt>();
const changelogs = new Map<string, TestChangelog>();

const calls = {
  memoryDeletes: [] as string[],
  memoryUpdates: [] as string[],
  memoryPins: [] as string[],
  memoryUnpins: [] as string[],
  promptDeletes: [] as string[],
};

const memoryRepo = {
  initialize: async () => {},
  getById: async (id: string) => memories.get(id),
  delete: async (id: string) => {
    calls.memoryDeletes.push(id);
    memories.delete(id);
  },
  deleteMany: async (ids: string[]) => {
    for (const id of ids) {
      calls.memoryDeletes.push(id);
      memories.delete(id);
    }
    return ids.length;
  },
  update: async (record: TestMemory) => {
    calls.memoryUpdates.push(record.id);
    memories.set(record.id, record);
  },
  pin: async (id: string) => {
    calls.memoryPins.push(id);
  },
  unpin: async (id: string) => {
    calls.memoryUnpins.push(id);
  },
};

const promptRepo = {
  initialize: async () => {},
  getPromptById: async (id: string) => prompts.get(id),
  deletePrompt: async (id: string) => {
    calls.promptDeletes.push(id);
    prompts.delete(id);
  },
};

const profileRepo = {
  initialize: async () => {},
  getChangelogById: async (id: string) => changelogs.get(id),
  getAllActiveProfiles: async () => [{ profileId: "phrkr" }, { profileId: "other" }],
};

const clientRepo = {
  initialize: async () => {},
};

const profileApiKeyRepo = {
  initialize: async () => {},
  findProfileByApiKey: async () => null,
  hasKeyForProfile: async () => false,
  createKeyForProfile: async () => true,
  touchLastUsed: async () => {},
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
  createClientRepository: () => clientRepo,
  createProfileApiKeyRepository: () => profileApiKeyRepo,
  createTagRegistry: () => ({
    unlinkMemoryTags: async () => {},
    linkMemoryTags: async () => {},
  }),
}));

const {
  handleBulkDelete,
  handleDeleteMemory,
  handleDeletePrompt,
  handleGetProfileSnapshot,
  handlePinMemory,
  handleUnpinMemory,
  handleUpdateMemory,
} = await import("../src/services/api-handlers.js?profile-key-api-ownership");

const principal: Principal = { kind: "profile", profileId: "phrkr" };

function memory(id: string, profileId: string, metadata?: TestMemory["metadata"]): TestMemory {
  return {
    id,
    content: `content for ${id}`,
    containerTag: `${profileId}_project_repo`,
    type: "fact",
    tags: "tag",
    createdAt: 1,
    updatedAt: 1,
    metadata,
    profileId,
    repoId: "repo",
  };
}

function prompt(id: string, profileId: string, linkedMemoryId: string | null = null): TestPrompt {
  return {
    id,
    sessionId: `session-${id}`,
    content: `prompt for ${id}`,
    createdAt: 1,
    profileId,
    repoId: "repo",
    localProjectPath: null,
    linkedMemoryId,
  };
}

beforeEach(() => {
  memories.clear();
  prompts.clear();
  changelogs.clear();
  calls.memoryDeletes = [];
  calls.memoryUpdates = [];
  calls.memoryPins = [];
  calls.memoryUnpins = [];
  calls.promptDeletes = [];
});

describe("profile key API ownership checks", () => {
  it("rejects unauthorized memory delete/update/pin/unpin without calling mutators", async () => {
    memories.set("mem-other", memory("mem-other", "other"));

    const deleteResult = await handleDeleteMemory("mem-other", false, principal);
    const updateResult = await handleUpdateMemory("mem-other", { content: "new" }, principal);
    const pinResult = await handlePinMemory("mem-other", principal);
    const unpinResult = await handleUnpinMemory("mem-other", principal);

    expect(deleteResult).toEqual({
      success: false,
      error: "Profile key cannot access another profile",
    });
    expect(updateResult).toEqual({
      success: false,
      error: "Profile key cannot access another profile",
    });
    expect(pinResult).toEqual({
      success: false,
      error: "Profile key cannot access another profile",
    });
    expect(unpinResult).toEqual({
      success: false,
      error: "Profile key cannot access another profile",
    });
    expect(calls.memoryDeletes).toEqual([]);
    expect(calls.memoryUpdates).toEqual([]);
    expect(calls.memoryPins).toEqual([]);
    expect(calls.memoryUnpins).toEqual([]);
  });

  it("bulk deletes only memory records owned by the principal", async () => {
    memories.set("mem-own-1", memory("mem-own-1", "phrkr"));
    memories.set("mem-other", memory("mem-other", "other"));
    memories.set("mem-own-2", memory("mem-own-2", "phrkr"));

    const result = await handleBulkDelete(
      ["mem-own-1", "mem-other", "mem-own-2"],
      false,
      principal
    );

    expect(result).toEqual({
      success: true,
      data: {
        deleted: 2,
        total: 3,
        failedIds: ["mem-other"],
      },
    });
    expect(calls.memoryDeletes).toEqual(["mem-own-1", "mem-own-2"]);
  });

  it("does not raw-delete another profile prompt during memory cascade", async () => {
    memories.set("mem-own", memory("mem-own", "phrkr", { promptId: "prompt-other" }));
    prompts.set("prompt-other", prompt("prompt-other", "other"));

    const result = await handleDeleteMemory("mem-own", true, principal);

    expect(result).toEqual({
      success: false,
      error: "Profile key cannot access another profile",
    });
    expect(calls.promptDeletes).toEqual([]);
    expect(calls.memoryDeletes).toEqual([]);
  });

  it("does not delete another profile memory during prompt cascade", async () => {
    prompts.set("prompt-own", prompt("prompt-own", "phrkr", "mem-other"));
    memories.set("mem-other", memory("mem-other", "other"));

    const result = await handleDeletePrompt("prompt-own", true, principal);

    expect(result).toEqual({
      success: true,
      data: { deletedMemory: false },
    });
    expect(calls.memoryDeletes).toEqual([]);
    expect(calls.promptDeletes).toEqual(["prompt-own"]);
  });

  it("rejects profile snapshots owned by another profile", async () => {
    changelogs.set("change-other", {
      id: "change-other",
      profileId: "other",
      version: 1,
      changeType: "update",
      changeSummary: "changed",
      profileDataSnapshot: "{}",
      createdAt: 1,
    });

    const result = await handleGetProfileSnapshot("change-other", principal);

    expect(result).toEqual({
      success: false,
      error: "Profile key cannot access another profile",
    });
  });
});
