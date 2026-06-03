/**
 * Unit tests for new storage methods in PostgresMemoryRepository:
 * - deleteMany
 * - updateTagsOnly
 * - updateVectorsOnly
 * - getMemoriesWithoutVectors
 *
 * Uses Bun's mock.module to mock the postgres client and related dependencies,
 * testing the actual method implementations without requiring a live database.
 *
 * These tests verify ISSUE-005 implementation:
 * - deleteMany: batch deletion with count return
 * - updateTagsOnly: tags column update without vectors
 * - updateVectorsOnly: vector/tags_vector column update
 * - getMemoriesWithoutVectors: retrieval of memories needing vector generation
 */

import { describe, expect, it, mock, beforeEach } from "bun:test";

// ── Mock SQL client ──────────────────────────────────────────────────────

const sqlCallLog: Array<{ query: string; params: any[] }> = [];

interface MockResponse {
  rows: any[];
  count?: number;
}

let mockResponses: MockResponse[] = [];

function resetMocks(): void {
  sqlCallLog.length = 0;
  mockResponses = [];
}

function enqueueResponse(rows: any[], count?: number): void {
  mockResponses.push({ rows, count });
}

function createMockSql(): any {
  const sqlFn = (stringsOrInput: any, ...values: any[]): any => {
    // Distinguish tagged template literal from regular function call.
    // TemplateStringsArray has a `raw` property; plain arrays do not.
    if (stringsOrInput != null && typeof stringsOrInput === "object" && "raw" in stringsOrInput) {
      // Tagged template literal: sql`query ${param}`
      const query = (stringsOrInput as string[]).join("?");
      sqlCallLog.push({ query, params: values });
      const response = mockResponses.shift() ?? { rows: [], count: 0 };
      const rows = response.rows ?? [];
      return Promise.resolve(Object.assign(rows, { count: response.count ?? rows.length }));
    } else {
      // Regular function call: sql(array) for IN clauses
      // Returns the array so it's captured as a template interpolation value
      return stringsOrInput;
    }
  };

  sqlFn.unsafe = (str: string): string => str;
  sqlFn.json = (obj: any): string => JSON.stringify(obj);

  return sqlFn;
}

const mockSql = createMockSql();

// ── Mock modules (must be declared before importing the module under test) ──

mock.module("../../src/config.js", () => ({
  CONFIG: {
    embeddingDimensions: 3,
    postgres: {
      vectorType: "vector",
      url: "postgres://mock:mock@localhost/test",
    },
  },
}));

mock.module("../../src/services/logger.js", () => ({
  log: (..._args: any[]) => {},
}));

mock.module("../../src/services/storage/postgres/client.js", () => ({
  getPostgresClient: () => mockSql,
  closePostgresClient: async () => {},
}));

mock.module("../../src/services/storage/postgres/migrations.js", () => ({
  runPostgresMigrations: async () => {},
}));

mock.module("../../src/services/storage/postgres/vector.js", () => ({
  vectorToPgLiteral: (v: Float32Array) => `[${Array.from(v).join(",")}]`,
  assertVectorDimensions: (_v: Float32Array, _dims: number) => {},
  getVectorCast: (type: string, dims: number) => `${type}(${dims})`,
  redactDatabaseUrl: (url: string) => url,
}));

// Import after mocking
import { PostgresMemoryRepository } from "../../src/services/storage/postgres/memory-repository.js";

// ── Row helper ───────────────────────────────────────────────────────────

function makeMemoryRow(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    id: overrides.id ?? "mem-1",
    content: overrides.content ?? "test memory content",
    vector: overrides.vector ?? "[0.1,0.2,0.3]",
    tags_vector: overrides.tags_vector ?? null,
    container_tag: overrides.container_tag ?? "opencode_project_abc",
    tags: overrides.tags ?? "bug,feature",
    type: overrides.type ?? null,
    created_at: overrides.created_at ?? 1700000000,
    updated_at: overrides.updated_at ?? 1700000000,
    metadata: overrides.metadata ?? null,
    display_name: overrides.display_name ?? null,
    user_name: overrides.user_name ?? null,
    user_email: overrides.user_email ?? null,
    project_path: overrides.project_path ?? null,
    project_name: overrides.project_name ?? null,
    git_repo_url: overrides.git_repo_url ?? null,
    is_pinned: overrides.is_pinned ?? false,
    scope: overrides.scope ?? "project",
    scope_hash: overrides.scope_hash ?? "abc",
  };
}

// ── Interface contract tests ─────────────────────────────────────────────

describe("New storage methods — interface contract", () => {
  it("deleteMany is declared on the MemoryRepository interface via factory proxy", async () => {
    const { createMemoryRepository } = await import("../../src/services/storage/factory.js");
    const repo = createMemoryRepository();
    expect("deleteMany" in repo).toBe(true);
    expect(typeof repo.deleteMany).toBe("function");
  });

  it("updateTagsOnly is declared on the MemoryRepository interface via factory proxy", async () => {
    const { createMemoryRepository } = await import("../../src/services/storage/factory.js");
    const repo = createMemoryRepository();
    expect("updateTagsOnly" in repo).toBe(true);
    expect(typeof repo.updateTagsOnly).toBe("function");
  });

  it("updateVectorsOnly is declared on the MemoryRepository interface via factory proxy", async () => {
    const { createMemoryRepository } = await import("../../src/services/storage/factory.js");
    const repo = createMemoryRepository();
    expect("updateVectorsOnly" in repo).toBe(true);
    expect(typeof repo.updateVectorsOnly).toBe("function");
  });

  it("getMemoriesWithoutVectors is declared on the MemoryRepository interface via factory proxy", async () => {
    const { createMemoryRepository } = await import("../../src/services/storage/factory.js");
    const repo = createMemoryRepository();
    expect("getMemoriesWithoutVectors" in repo).toBe(true);
    expect(typeof repo.getMemoriesWithoutVectors).toBe("function");
  });
});

// ── deleteMany tests ─────────────────────────────────────────────────────

describe("deleteMany", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("returns 0 for empty array without calling SQL", async () => {
    const repo = new PostgresMemoryRepository();
    const result = await repo.deleteMany([]);
    expect(result).toBe(0);
    expect(sqlCallLog).toHaveLength(0);
  });

  it("calls SQL DELETE with correct IDs and returns count", async () => {
    enqueueResponse([], 2);

    const repo = new PostgresMemoryRepository();
    const result = await repo.deleteMany(["mem-1", "mem-2"]);

    expect(result).toBe(2);
    expect(sqlCallLog).toHaveLength(1);
    expect(sqlCallLog[0].query).toContain("DELETE FROM memories");
    expect(sqlCallLog[0].query).toContain("WHERE id IN ?");
    // The ids array should be passed as a parameter
    expect(sqlCallLog[0].params).toHaveLength(1);
    expect(sqlCallLog[0].params[0]).toEqual(["mem-1", "mem-2"]);
  });

  it("handles partial success (some IDs don't exist)", async () => {
    // Only 1 of 3 IDs actually exists in the database
    enqueueResponse([], 1);

    const repo = new PostgresMemoryRepository();
    const result = await repo.deleteMany(["mem-1", "mem-nonexistent-1", "mem-nonexistent-2"]);

    expect(result).toBe(1);
    expect(sqlCallLog).toHaveLength(1);
  });
});

// ── updateTagsOnly tests ─────────────────────────────────────────────────

describe("updateTagsOnly", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("calls SQL UPDATE setting tags column for a given ID", async () => {
    enqueueResponse([]);

    const repo = new PostgresMemoryRepository();
    await repo.updateTagsOnly("mem-42", "bug,urgent", 1700000500);

    expect(sqlCallLog).toHaveLength(1);
    expect(sqlCallLog[0].query).toContain("UPDATE memories SET");
    expect(sqlCallLog[0].query).toContain("tags = ?");
    expect(sqlCallLog[0].query).toContain("updated_at = ?");
    expect(sqlCallLog[0].query).toContain("WHERE id = ?");
    expect(sqlCallLog[0].params).toEqual(["bug,urgent", 1700000500, "mem-42"]);
  });

  it("returns void/undefined on success", async () => {
    enqueueResponse([]);

    const repo = new PostgresMemoryRepository();
    const result = await repo.updateTagsOnly("mem-1", "docs", 1700000100);

    expect(result).toBeUndefined();
  });
});

// ── updateVectorsOnly tests ──────────────────────────────────────────────

describe("updateVectorsOnly", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("calls SQL UPDATE setting vector and tags_vector columns for a given ID", async () => {
    enqueueResponse([]);

    const repo = new PostgresMemoryRepository();
    const vector = new Float32Array([0.1, 0.2, 0.3]);
    const tagsVector = new Float32Array([0.4, 0.5, 0.6]);

    await repo.updateVectorsOnly("mem-99", vector, tagsVector, 1700000500);

    expect(sqlCallLog).toHaveLength(1);
    expect(sqlCallLog[0].query).toContain("UPDATE memories SET");
    expect(sqlCallLog[0].query).toContain("vector = ?");
    expect(sqlCallLog[0].query).toContain("tags_vector = ?");
    expect(sqlCallLog[0].query).toContain("updated_at = ?");
    expect(sqlCallLog[0].query).toContain("WHERE id = ?");

    // Params: [unsafe vector literal, unsafe tagsVector literal, updatedAt, id]
    const params = sqlCallLog[0].params;
    expect(params.length).toBeGreaterThanOrEqual(3);
    // The vector literal should be a string from vectorToPgLiteral wrapped in cast
    // Format: "'[<values>]'::vector(3)" — includes surrounding single quotes
    expect(typeof params[0]).toBe("string");
    expect(params[0]).toMatch(/^'\[.*\]'::vector\(3\)$/);
    // tagsVector literal
    expect(typeof params[1]).toBe("string");
    expect(params[1]).toMatch(/^'\[.*\]'::vector\(3\)$/);
    // updatedAt
    expect(params[2]).toBe(1700000500);
    // id
    expect(params[3]).toBe("mem-99");
  });

  it("returns void/undefined on success", async () => {
    enqueueResponse([]);

    const repo = new PostgresMemoryRepository();
    const vector = new Float32Array([0.1, 0.2, 0.3]);
    const result = await repo.updateVectorsOnly("mem-1", vector, undefined, 1700000100);

    expect(result).toBeUndefined();
  });

  it("handles null tagsVector by passing null as tags_vector param", async () => {
    enqueueResponse([]);

    const repo = new PostgresMemoryRepository();
    const vector = new Float32Array([0.1, 0.2, 0.3]);

    await repo.updateVectorsOnly("mem-1", vector, undefined, 1700000100);

    const params = sqlCallLog[0].params;
    // When tagsVector is undefined, tags_vector param should be null
    expect(params[1]).toBeNull();
  });
});

// ── getMemoriesWithoutVectors tests ──────────────────────────────────────

describe("getMemoriesWithoutVectors", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("returns memories that have tags but no vectors", async () => {
    const row1 = makeMemoryRow({
      id: "mem-1",
      tags: "bug,feature",
      vector: null, // no vector
      tags_vector: null, // no tags_vector
    });
    const row2 = makeMemoryRow({
      id: "mem-2",
      tags: "docs",
      vector: "[0.1,0.2,0.3]", // has vector
      tags_vector: null, // missing tags_vector
    });
    enqueueResponse([row1, row2]);

    const repo = new PostgresMemoryRepository();
    const results = await repo.getMemoriesWithoutVectors();

    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("mem-1");
    expect(results[0].tags).toBe("bug,feature");
    expect(results[1].id).toBe("mem-2");
    expect(results[1].tags).toBe("docs");
    // Verify the SQL query filters correctly
    expect(sqlCallLog).toHaveLength(1);
    expect(sqlCallLog[0].query).toContain("tags IS NOT NULL");
    expect(sqlCallLog[0].query).toContain("vector IS NULL OR tags_vector IS NULL");
  });

  it("returns empty array when all memories have vectors", async () => {
    enqueueResponse([]);

    const repo = new PostgresMemoryRepository();
    const results = await repo.getMemoriesWithoutVectors();

    expect(results).toHaveLength(0);
    expect(results).toEqual([]);
  });

  it("applies correct pagination (limit/offset)", async () => {
    enqueueResponse([]);

    const repo = new PostgresMemoryRepository();
    await repo.getMemoriesWithoutVectors(50, 100);

    expect(sqlCallLog).toHaveLength(1);
    expect(sqlCallLog[0].query).toContain("LIMIT ?");
    expect(sqlCallLog[0].query).toContain("OFFSET ?");
    expect(sqlCallLog[0].params).toEqual([50, 100]);
  });

  it("uses default limit=100 and offset=0 when no args provided", async () => {
    enqueueResponse([]);

    const repo = new PostgresMemoryRepository();
    await repo.getMemoriesWithoutVectors();

    expect(sqlCallLog).toHaveLength(1);
    expect(sqlCallLog[0].params).toEqual([100, 0]);
  });

  it("maps rows to MemoryRecord objects with correct field names", async () => {
    const row = makeMemoryRow({
      id: "mem-mapped",
      content: "A memory needing vectors",
      tags: "refactor,performance",
      vector: null,
      tags_vector: null,
      container_tag: "opencode_project_xyz",
    });
    enqueueResponse([row]);

    const repo = new PostgresMemoryRepository();
    const results = await repo.getMemoriesWithoutVectors();

    expect(results).toHaveLength(1);
    const record = results[0];
    expect(record.id).toBe("mem-mapped");
    expect(record.content).toBe("A memory needing vectors");
    expect(record.tags).toBe("refactor,performance");
    expect(record.containerTag).toBe("opencode_project_xyz");
    // vector should be parsed (null becomes empty Float32Array via parseVector)
    expect(record.vector).toBeInstanceOf(Float32Array);
  });
});
