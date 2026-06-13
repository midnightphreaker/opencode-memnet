import { beforeEach, describe, expect, it, mock } from "bun:test";

type MemoryRecord = {
  id: string;
  content: string;
  type: "fact";
  tags?: string;
  metadata?: Record<string, unknown>;
  profileId: string;
  repoId: string;
  createdAt: number;
  updatedAt: number;
};

type PromptRecord = {
  id: string;
  sessionId: string;
  content: string;
  createdAt: number;
  profileId: string;
  repoId: string;
  localProjectPath: string | null;
  linkedMemoryId: string | null;
};

let memoryResults: any[] = [];
let promptResults: PromptRecord[] = [];
const memories = new Map<string, MemoryRecord>();
const prompts = new Map<string, PromptRecord>();

const memoryRepo = {
  initialize: async () => {},
  search: async () => memoryResults,
  getById: async (id: string) => memories.get(id),
  getDistinctTags: async () => [
    { tag: "repo_project_alpha", profileId: "phrkr", repoId: "repo-a" },
  ],
};

const promptRepo = {
  initialize: async () => {},
  searchPrompts: async () => promptResults,
  getPromptsByIds: async (ids: string[]) =>
    ids.flatMap((id) => {
      const prompt = prompts.get(id);
      return prompt ? [prompt] : [];
    }),
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
  createTagRegistry: () => ({}),
}));

const { handleSearch } =
  await import("../src/services/api-handlers.js?profile-key-search-context-scope");

function searchMemory(id: string, profileId: string, repoId: string, promptId?: string) {
  return {
    id,
    memory: `memory ${id}`,
    tags: "tag",
    metadata: promptId ? { promptId, type: "fact" } : { type: "fact" },
    createdAt: 1,
    similarity: 0.9,
    profileId,
    repoId,
    isPinned: false,
  };
}

function memory(id: string, profileId: string, repoId: string): MemoryRecord {
  return {
    id,
    content: `memory ${id}`,
    type: "fact",
    tags: "tag",
    metadata: { type: "fact" },
    profileId,
    repoId,
    createdAt: 1,
    updatedAt: 1,
  };
}

function prompt(
  id: string,
  profileId: string,
  repoId: string,
  linkedMemoryId: string | null = null
): PromptRecord {
  return {
    id,
    sessionId: `session-${id}`,
    content: `prompt ${id}`,
    createdAt: 1,
    profileId,
    repoId,
    localProjectPath: null,
    linkedMemoryId,
  };
}

beforeEach(() => {
  memoryResults = [];
  promptResults = [];
  memories.clear();
  prompts.clear();
});

describe("profile key search context scope", () => {
  it("does not append cross-profile linked prompts from memory metadata", async () => {
    memoryResults = [searchMemory("mem-own", "phrkr", "repo-a", "prompt-other")];
    prompts.set("prompt-other", prompt("prompt-other", "other", "repo-b"));

    const result = await handleSearch("needle", undefined, 1, 20, "phrkr", "repo-a");

    expect(result.success).toBe(true);
    expect(result.data?.items.map((item) => item.id)).toEqual(["mem-own"]);
  });

  it("does not append cross-profile linked memories from prompt metadata", async () => {
    promptResults = [prompt("prompt-own", "phrkr", "repo-a", "mem-other")];
    memories.set("mem-other", memory("mem-other", "other", "repo-b"));

    const result = await handleSearch("needle", undefined, 1, 20, "phrkr", "repo-a");

    expect(result.success).toBe(true);
    expect(result.data?.items.map((item) => item.id)).toEqual(["prompt-own"]);
  });

  it("does not append same-profile prompts from another repo during tag search", async () => {
    memoryResults = [searchMemory("mem-own", "phrkr", "repo-a", "prompt-other-repo")];
    prompts.set("prompt-other-repo", prompt("prompt-other-repo", "phrkr", "repo-b"));

    const result = await handleSearch("needle", "repo_project_alpha", 1, 20, "phrkr");

    expect(result.success).toBe(true);
    expect(result.data?.items.map((item) => item.id)).toEqual(["mem-own"]);
  });

  it("does not append same-profile memories from another repo during tag search", async () => {
    promptResults = [prompt("prompt-own", "phrkr", "repo-a", "mem-other-repo")];
    memories.set("mem-other-repo", memory("mem-other-repo", "phrkr", "repo-b"));

    const result = await handleSearch("needle", "repo_project_alpha", 1, 20, "phrkr");

    expect(result.success).toBe(true);
    expect(result.data?.items.map((item) => item.id)).toEqual(["prompt-own"]);
  });
});
