import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Principal } from "../src/services/auth-service.js";

type Owner = { apiKeyId: string; memoryBankId: string };
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
  apiKeyId: string;
  memoryBankId: string;
};

type TestPrompt = {
  id: string;
  sessionId: string;
  messageId: string;
  content: string;
  createdAt: number;
  profileId: string;
  repoId: string;
  apiKeyId: string;
  memoryBankId: string;
  localProjectPath: string | null;
  linkedMemoryId: string | null;
};

const memories = new Map<string, TestMemory>();
const prompts = new Map<string, TestPrompt>();

const calls = {
  memoryDeletes: [] as Array<{ id: string; owner?: Owner }>,
  memoryUpdates: [] as Array<{ id: string; owner?: Owner }>,
  memoryPins: [] as Array<{ id: string; owner?: Owner }>,
  memoryUnpins: [] as Array<{ id: string; owner?: Owner }>,
  promptDeletes: [] as Array<{ id: string; owner?: Owner }>,
};

function ownerMatches(row: { apiKeyId: string; memoryBankId: string }, owner?: Owner): boolean {
  return !owner || (row.apiKeyId === owner.apiKeyId && row.memoryBankId === owner.memoryBankId);
}

const memoryRepo = {
  initialize: async () => {},
  getById: async (id: string, owner?: Owner) => {
    const row = memories.get(id);
    return row && ownerMatches(row, owner) ? row : null;
  },
  delete: async (id: string, owner?: Owner) => {
    calls.memoryDeletes.push({ id, owner });
    const row = memories.get(id);
    if (!row || !ownerMatches(row, owner)) return false;
    memories.delete(id);
    return true;
  },
  update: async (record: TestMemory) => {
    calls.memoryUpdates.push({
      id: record.id,
      owner:
        record.apiKeyId && record.memoryBankId
          ? { apiKeyId: record.apiKeyId, memoryBankId: record.memoryBankId }
          : undefined,
    });
    const row = memories.get(record.id);
    if (!row || !ownerMatches(row, record)) return;
    memories.set(record.id, record);
  },
  pin: async (id: string, owner?: Owner) => {
    calls.memoryPins.push({ id, owner });
  },
  unpin: async (id: string, owner?: Owner) => {
    calls.memoryUnpins.push({ id, owner });
  },
};

const promptRepo = {
  initialize: async () => {},
  getPromptById: async (id: string, owner?: Owner) => {
    const row = prompts.get(id);
    return row && ownerMatches(row, owner) ? row : null;
  },
  deletePrompt: async (id: string, owner?: Owner) => {
    calls.promptDeletes.push({ id, owner });
    const row = prompts.get(id);
    if (row && ownerMatches(row, owner)) prompts.delete(id);
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
  createUserProfileRepository: () => ({ initialize: async () => {} }),
  createClientRepository: () => ({ initialize: async () => {} }),
  createUserApiKeyRepository: () => ({ initialize: async () => {} }),
  createMemoryBankRepository: () => ({ initialize: async () => {} }),
  createTagRegistry: () => ({
    unlinkMemoryTags: async () => {},
    linkMemoryTags: async () => {},
  }),
}));

const {
  handleBulkDelete,
  handleDeleteMemory,
  handleDeletePrompt,
  handlePinMemory,
  handleUnpinMemory,
  handleUpdateMemory,
} = await import("../src/services/api-handlers.js?memory-bank-api-ownership");

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
const expectedOwner = { apiKeyId: "key-1", memoryBankId: "bank-1" };

function memory(id: string, bank = "bank-1", metadata?: TestMemory["metadata"]): TestMemory {
  return {
    id,
    content: `content for ${id}`,
    containerTag: "opencode_project_repo",
    type: "fact",
    tags: "tag",
    createdAt: 1,
    updatedAt: 1,
    metadata,
    profileId: bank,
    repoId: "repo",
    apiKeyId: bank === "bank-1" ? "key-1" : "key-2",
    memoryBankId: bank,
  };
}

function prompt(id: string, bank = "bank-1", linkedMemoryId: string | null = null): TestPrompt {
  return {
    id,
    sessionId: `session-${id}`,
    messageId: `message-${id}`,
    content: `prompt for ${id}`,
    createdAt: 1,
    profileId: bank,
    repoId: "repo",
    apiKeyId: bank === "bank-1" ? "key-1" : "key-2",
    memoryBankId: bank,
    localProjectPath: null,
    linkedMemoryId,
  };
}

beforeEach(() => {
  memories.clear();
  prompts.clear();
  calls.memoryDeletes = [];
  calls.memoryUpdates = [];
  calls.memoryPins = [];
  calls.memoryUnpins = [];
  calls.promptDeletes = [];
});

describe("Memory Bank API ownership checks", () => {
  it("treats cross-bank getById as not found for delete/update/pin/unpin", async () => {
    memories.set("mem-other", memory("mem-other", "bank-2"));

    expect(await handleDeleteMemory("mem-other", false, scope)).toEqual({
      success: false,
      error: "Memory not found",
    });
    expect(await handleUpdateMemory("mem-other", { content: "new" }, scope)).toEqual({
      success: false,
      error: "Memory not found",
    });
    expect(await handlePinMemory("mem-other", scope)).toEqual({
      success: false,
      error: "Memory not found",
    });
    expect(await handleUnpinMemory("mem-other", scope)).toEqual({
      success: false,
      error: "Memory not found",
    });

    expect(calls.memoryDeletes).toEqual([]);
    expect(calls.memoryUpdates).toEqual([]);
    expect(calls.memoryPins).toEqual([]);
    expect(calls.memoryUnpins).toEqual([]);
  });

  it("passes bank owner into deleteMany-equivalent handler flow", async () => {
    memories.set("mem-own-1", memory("mem-own-1"));
    memories.set("mem-other", memory("mem-other", "bank-2"));
    memories.set("mem-own-2", memory("mem-own-2"));

    const result = await handleBulkDelete(["mem-own-1", "mem-other", "mem-own-2"], false, scope);

    expect(result).toEqual({
      success: true,
      data: {
        deleted: 2,
        total: 3,
        failedIds: ["mem-other"],
      },
    });
    expect(calls.memoryDeletes).toEqual([
      { id: "mem-own-1", owner: expectedOwner },
      { id: "mem-own-2", owner: expectedOwner },
    ]);
  });

  it("does not delete prompts from another Memory Bank during memory cascade", async () => {
    memories.set("mem-own", memory("mem-own", "bank-1", { promptId: "prompt-other" }));
    prompts.set("prompt-other", prompt("prompt-other", "bank-2"));

    const result = await handleDeleteMemory("mem-own", true, scope);

    expect(result).toEqual({ success: true, data: { deletedPrompt: false } });
    expect(calls.promptDeletes).toEqual([]);
    expect(calls.memoryDeletes).toEqual([{ id: "mem-own", owner: expectedOwner }]);
  });

  it("does not delete memories from another Memory Bank during prompt cascade", async () => {
    prompts.set("prompt-own", prompt("prompt-own", "bank-1", "mem-other"));
    memories.set("mem-other", memory("mem-other", "bank-2"));

    const result = await handleDeletePrompt("prompt-own", true, scope);

    expect(result).toEqual({
      success: true,
      data: { deletedMemory: false },
    });
    expect(calls.memoryDeletes).toEqual([]);
    expect(calls.promptDeletes).toEqual([{ id: "prompt-own", owner: expectedOwner }]);
  });
});
