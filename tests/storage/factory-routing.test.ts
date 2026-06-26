import { describe, expect, it, mock } from "bun:test";

const memoryRepoCalls: Array<{ method: string; args: unknown[] }> = [];

mock.module("../../src/services/storage/postgres/memory-repository.js", () => ({
  PostgresMemoryRepository: class {
    async initialize() {}
    async close() {}
    async getById(...args: unknown[]) {
      memoryRepoCalls.push({ method: "getById", args });
      return null;
    }
    async delete(...args: unknown[]) {
      memoryRepoCalls.push({ method: "delete", args });
      return true;
    }
    async deleteMany(...args: unknown[]) {
      memoryRepoCalls.push({ method: "deleteMany", args });
      return 1;
    }
    async pin(...args: unknown[]) {
      memoryRepoCalls.push({ method: "pin", args });
    }
    async unpin(...args: unknown[]) {
      memoryRepoCalls.push({ method: "unpin", args });
    }
    async list() {
      return [];
    }
    async search() {
      return [];
    }
    async getAllWithVectors() {
      return [];
    }
  },
}));

describe("Storage factory routing under strict identity", () => {
  it("does not export user identity repository creation", async () => {
    const factory = await import("../../src/services/storage/factory.js");
    expect("createUserIdentityRepository" in factory).toBe(false);
  });

  it("memory repository proxy exposes strict-scope methods", async () => {
    const { createMemoryRepository } = await import("../../src/services/storage/factory.js");
    const repo = createMemoryRepository();
    expect(typeof repo.list).toBe("function");
    expect(typeof repo.search).toBe("function");
    expect(typeof repo.getAllWithVectors).toBe("function");
  });

  it("memory repository proxy forwards Memory Bank owner filters for ID mutators", async () => {
    const { closeStorage, createMemoryRepository } =
      await import("../../src/services/storage/factory.js?owner-forwarding");
    await closeStorage();
    memoryRepoCalls.length = 0;
    const repo = createMemoryRepository();
    const owner = { apiKeyId: "key-1", memoryBankId: "bank-1" };

    await repo.getById("mem-1", owner);
    await repo.delete("mem-1", owner);
    await repo.deleteMany(["mem-1", "mem-2"], owner);
    await repo.pin("mem-1", owner);
    await repo.unpin("mem-1", owner);

    expect(memoryRepoCalls).toEqual([
      { method: "getById", args: ["mem-1", owner] },
      { method: "delete", args: ["mem-1", owner] },
      { method: "deleteMany", args: [["mem-1", "mem-2"], owner] },
      { method: "pin", args: ["mem-1", owner] },
      { method: "unpin", args: ["mem-1", owner] },
    ]);
    await closeStorage();
  });

  it("prompt repository proxy exposes repo-scoped prompt methods", async () => {
    const { createUserPromptRepository } = await import("../../src/services/storage/factory.js");
    const repo = createUserPromptRepository();
    expect(typeof repo.savePrompt).toBe("function");
    expect(typeof repo.getCapturedPrompts).toBe("function");
    expect(typeof repo.searchPrompts).toBe("function");
  });
});
