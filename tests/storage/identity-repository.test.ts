/**
 * Unit tests for PostgresUserIdentityRepository.
 *
 * Tests the canonical identity store that backs the nickname unification system.
 * Uses Bun's mock.module to mock the postgres client.
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
    if (stringsOrInput != null && typeof stringsOrInput === "object" && "raw" in stringsOrInput) {
      const query = (stringsOrInput as string[]).join("?");
      sqlCallLog.push({ query, params: values });
      const response = mockResponses.shift() ?? { rows: [], count: 0 };
      const rows = response.rows ?? [];
      return Promise.resolve(Object.assign(rows, { count: response.count ?? rows.length }));
    } else {
      return stringsOrInput;
    }
  };

  sqlFn.unsafe = (str: string): string => str;
  sqlFn.json = (obj: any): string => JSON.stringify(obj);

  return sqlFn;
}

const mockSql = createMockSql();

// ── Mock modules ─────────────────────────────────────────────────────────

mock.module("../../src/services/logger.js", () => ({
  log: (..._args: any[]) => {},
  logDebug: (..._args: any[]) => {},
  logError: (..._args: any[]) => {},
}));

mock.module("../../src/services/storage/postgres/client.js", () => ({
  getPostgresClient: () => mockSql,
  closePostgresClient: async () => {},
}));

mock.module("../../src/services/storage/postgres/migrations.js", () => ({
  runPostgresMigrations: async () => {},
}));

// Import after mocking
import { PostgresUserIdentityRepository } from "../../src/services/storage/postgres/identity-repository.js";

// ── Row helpers ──────────────────────────────────────────────────────────

function makeIdentityRow(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    id: overrides.id ?? "uid_abc123_id",
    email: overrides.email ?? "user@example.com",
    nickname: overrides.nickname ?? null,
    display_name: overrides.display_name ?? null,
    created_at: overrides.created_at ?? new Date(),
    updated_at: overrides.updated_at ?? new Date(),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("PostgresUserIdentityRepository", () => {
  beforeEach(() => {
    resetMocks();
  });

  describe("initialize", () => {
    it("runs migrations on initialize", async () => {
      const repo = new PostgresUserIdentityRepository();
      // Should not throw
      await repo.initialize();
    });
  });

  describe("getByEmail", () => {
    it("returns mapped identity row when found", async () => {
      const row = makeIdentityRow({ email: "test@example.com", nickname: "tester" });
      enqueueResponse([row]);

      const repo = new PostgresUserIdentityRepository();
      const result = await repo.getByEmail("test@example.com");

      expect(result).not.toBeNull();
      expect(result!.email).toBe("test@example.com");
      expect(result!.nickname).toBe("tester");
      expect(sqlCallLog).toHaveLength(1);
      expect(sqlCallLog[0].query).toContain("user_identities");
      expect(sqlCallLog[0].query).toContain("email = ?");
      expect(sqlCallLog[0].params[0]).toBe("test@example.com");
    });

    it("returns null when no identity found", async () => {
      enqueueResponse([]);

      const repo = new PostgresUserIdentityRepository();
      const result = await repo.getByEmail("nobody@example.com");

      expect(result).toBeNull();
    });
  });

  describe("getById", () => {
    it("returns mapped identity row when found", async () => {
      const row = makeIdentityRow({ id: "uid_123" });
      enqueueResponse([row]);

      const repo = new PostgresUserIdentityRepository();
      const result = await repo.getById("uid_123");

      expect(result).not.toBeNull();
      expect(result!.id).toBe("uid_123");
    });

    it("returns null when no identity found", async () => {
      enqueueResponse([]);

      const repo = new PostgresUserIdentityRepository();
      const result = await repo.getById("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("upsertIdentity", () => {
    it("inserts new identity with generated ID", async () => {
      // Only INSERT needed now (ID generation is in JS, not SQL)
      const insertedRow = makeIdentityRow({
        email: "new@example.com",
        nickname: "newuser",
      });
      enqueueResponse([insertedRow]);

      const repo = new PostgresUserIdentityRepository();
      const result = await repo.upsertIdentity("new@example.com", { nickname: "newuser" });

      expect(result.email).toBe("new@example.com");
      expect(result.nickname).toBe("newuser");
      expect(sqlCallLog).toHaveLength(1);
      expect(sqlCallLog[0].query).toContain("INSERT INTO user_identities");
      expect(sqlCallLog[0].query).toContain("ON CONFLICT");
    });

    it("updates existing identity via ON CONFLICT", async () => {
      const updatedRow = makeIdentityRow({
        email: "existing@example.com",
        nickname: "updated_nick",
      });
      enqueueResponse([updatedRow]);

      const repo = new PostgresUserIdentityRepository();
      const result = await repo.upsertIdentity("existing@example.com", {
        nickname: "updated_nick",
      });

      expect(result.nickname).toBe("updated_nick");
    });
  });

  describe("setNickname", () => {
    it("updates nickname via upsertIdentity", async () => {
      // setNickname now just calls upsertIdentity
      enqueueResponse([makeIdentityRow({ email: "user@example.com", nickname: "newnick" })]);

      const repo = new PostgresUserIdentityRepository();
      const result = await repo.setNickname("user@example.com", "newnick");

      expect(result).toBe(true);
      // Should be just the INSERT from upsertIdentity
      expect(sqlCallLog).toHaveLength(1);
      expect(sqlCallLog[0].query).toContain("INSERT INTO user_identities");
      expect(sqlCallLog[0].query).toContain("ON CONFLICT");
    });
  });

  describe("getNickname", () => {
    it("returns nickname when identity has one", async () => {
      enqueueResponse([{ nickname: "myname" }]);

      const repo = new PostgresUserIdentityRepository();
      const result = await repo.getNickname("user@example.com");

      expect(result).toBe("myname");
    });

    it("returns null when identity has no nickname", async () => {
      enqueueResponse([{ nickname: null }]);

      const repo = new PostgresUserIdentityRepository();
      const result = await repo.getNickname("user@example.com");

      expect(result).toBeNull();
    });

    it("returns null when no identity exists", async () => {
      enqueueResponse([]);

      const repo = new PostgresUserIdentityRepository();
      const result = await repo.getNickname("nobody@example.com");

      expect(result).toBeNull();
    });
  });

  describe("row mapping", () => {
    it("correctly maps snake_case DB columns to camelCase TS fields", async () => {
      const now = new Date();
      const row = makeIdentityRow({
        id: "uid_map",
        email: "map@example.com",
        nickname: "mapped_nick",
        display_name: "Mapped Display",
        created_at: now,
        updated_at: now,
      });
      enqueueResponse([row]);

      const repo = new PostgresUserIdentityRepository();
      const result = await repo.getByEmail("map@example.com");

      expect(result).not.toBeNull();
      expect(result!.id).toBe("uid_map");
      expect(result!.email).toBe("map@example.com");
      expect(result!.nickname).toBe("mapped_nick");
      expect(result!.displayName).toBe("Mapped Display");
      expect(result!.createdAt).toBe(now.getTime());
      expect(result!.updatedAt).toBe(now.getTime());
    });
  });
});
