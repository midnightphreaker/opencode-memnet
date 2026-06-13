import { describe, expect, it } from "bun:test";

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

  it("prompt repository proxy exposes repo-scoped prompt methods", async () => {
    const { createUserPromptRepository } = await import("../../src/services/storage/factory.js");
    const repo = createUserPromptRepository();
    expect(typeof repo.savePrompt).toBe("function");
    expect(typeof repo.getCapturedPrompts).toBe("function");
    expect(typeof repo.searchPrompts).toBe("function");
  });
});
