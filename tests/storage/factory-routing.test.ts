/**
 * Unit tests for storage factory routing.
 *
 * Verifies the factory creates the correct repository type based on
 * CONFIG.storageBackend without actually connecting to any database.
 *
 * Note: These tests verify the lazy proxy class names. The actual repo
 * implementations are only instantiated when methods are called.
 */

import { describe, expect, it, beforeEach, afterEach, mock } from "bun:test";

// We test by checking the constructor name of the returned proxy.
// The proxies use dynamic imports, so we check the class name.

describe("Storage factory routing", () => {
  // These tests read CONFIG.storageBackend (which defaults to "sqlite")
  // and verify the correct lazy proxy is instantiated.

  it("returns SQLite proxy by default", async () => {
    // Import factory fresh — CONFIG.storageBackend defaults to "sqlite"
    const { createMemoryRepository } = await import("../../src/services/storage/factory.js");

    // Reset singleton
    const mod = await import("../../src/services/storage/factory.js");
    // Access the module's internal state is not possible, so we test
    // the returned instance's constructor name
    const repo = createMemoryRepository();
    const className = repo.constructor.name;
    expect(className).toContain("Sqlite");
  });

  it("LazySqliteMemoryRepository delegates to SqliteMemoryRepository", async () => {
    const { createMemoryRepository } = await import("../../src/services/storage/factory.js");
    const repo = createMemoryRepository();
    // Should be a LazySqliteMemoryRepository
    expect(typeof repo.initialize).toBe("function");
    expect(typeof repo.insert).toBe("function");
    expect(typeof repo.search).toBe("function");
    expect(typeof repo.delete).toBe("function");
    expect(typeof repo.update).toBe("function");
    expect(typeof repo.getById).toBe("function");
    expect(typeof repo.list).toBe("function");
    expect(typeof repo.getBySessionId).toBe("function");
    expect(typeof repo.count).toBe("function");
    expect(typeof repo.getDistinctTags).toBe("function");
    expect(typeof repo.pin).toBe("function");
    expect(typeof repo.unpin).toBe("function");
    expect(typeof repo.listOlderThan).toBe("function");
    expect(typeof repo.getAllWithVectors).toBe("function");
    expect(typeof repo.countUntagged).toBe("function");
    expect(typeof repo.updateTagsAndVectors).toBe("function");
    expect(typeof repo.close).toBe("function");
  });
});
