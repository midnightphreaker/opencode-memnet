import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { ClientRow, ClientRepository } from "../src/services/storage/types.js";

// ── Mock state ─────────────────────────────────────────────────────────
// Controls what setNickname returns in each test.

const mockClientRepo: {
  setNickname: (id: string, nickname: string) => Promise<ClientRow | null>;
} = {
  setNickname: async () => null,
};

const mockClientRepoInstance: ClientRepository = {
  initialize: async () => {},
  close: async () => {},
  upsertClient: async () => ({
    firstTime: true,
    previousLastSeen: null,
    row: {
      id: "test",
      nickname: null,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      clientMetadata: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  }),
  setNickname: async (id, nickname) => mockClientRepo.setNickname(id, nickname),
  getClient: async () => null,
  getClientStats: async () => ({
    client: null,
    totalMemories: 0,
    memoriesToday: 0,
    totalPrompts: 0,
  }),
  getClientsByEmail: async () => [],
  getEmailByClientId: async () => null,
};

// ── Mock modules ───────────────────────────────────────────────────────
// Must be declared before importing the module under test.

const stubRepo = {
  initialize: async () => {},
  close: async () => {},
};

const mockProfileRepo = {
  initialize: async () => {},
  close: async () => {},
  setNickname: async () => true,
};

const mockIdentityRepo = {
  initialize: async () => {},
  close: async () => {},
  upsertIdentity: async () => ({
    id: "uid_mock",
    email: "test@test.com",
    nickname: null,
    displayName: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }),
  getNickname: async () => null,
  getByEmail: async () => null,
  getById: async () => null,
  setNickname: async () => true,
};

mock.module("../src/services/storage/factory.js", () => ({
  createMemoryRepository: () => stubRepo,
  createUserPromptRepository: () => stubRepo,
  createUserProfileRepository: () => mockProfileRepo,
  createClientRepository: () => mockClientRepoInstance,
  createUserIdentityRepository: () => mockIdentityRepo,
  createTagRegistry: () => ({
    ...stubRepo,
    backfillFromExistingTags: async () => ({ processed: 0, created: 0, linked: 0, aliases: 0 }),
    getAllCanonicalTags: async () => [],
  }),
}));

mock.module("../src/services/logger.js", () => ({
  log: () => {},
  logInfo: () => {},
  logDebug: () => {},
  logError: () => {},
}));

mock.module("../src/server-config.js", () => ({
  getServerConfig: () => ({ port: 0, host: "localhost" }),
  initServerConfig: () => ({ port: 0, host: "localhost" }),
  parseDurationString: () => 0,
}));

mock.module("../src/config.js", () => ({
  CONFIG: {
    postgres: {
      url: "postgres://mock:mock@localhost:5432/mock",
      ssl: false,
      maxConnections: 5,
      idleTimeoutSeconds: 30,
      connectTimeoutSeconds: 10,
      vectorType: "vector" as const,
      hnswEfSearch: 128,
      hnswEfConstruction: 256,
    },
    embeddingApiUrl: "http://mock",
    embeddingModel: "mock-model",
    embeddingApiKey: "mock-key",
    embeddingDimension: 384,
    maxMemoriesPerScope: 100,
    similarityThreshold: 0.5,
  },
  initConfig: () => {},
  isConfigured: () => true,
}));

mock.module("../src/services/embedding.js", () => ({
  embeddingService: {
    embed: async () => new Float32Array(384),
    embedTags: async () => new Float32Array(384),
  },
}));

// Import after mocking — use dynamic import wrapped in a deferred init
let _handleSetClientNickname: typeof import("../src/services/api-handlers.js").handleSetClientNickname;

async function getHandler() {
  if (!_handleSetClientNickname) {
    const mod = await import("../src/services/api-handlers.js");
    _handleSetClientNickname = mod.handleSetClientNickname;
  }
  return _handleSetClientNickname;
}

// ── Helpers ────────────────────────────────────────────────────────────

function makeClientRow(overrides?: Partial<ClientRow>): ClientRow {
  return {
    id: "client-1",
    nickname: "TestUser",
    firstSeen: 1700000000000,
    lastSeen: 1700000000000,
    clientMetadata: {},
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("Client Nickname", () => {
  describe("handleSetClientNickname", () => {
    it("should require clientId and nickname", async () => {
      const handleSetClientNickname = await getHandler();
      const result = await handleSetClientNickname({ clientId: "", nickname: "" });
      expect(result.success).toBe(false);
      expect(result.error).toBe("clientId and nickname are required");
    });

    it("should return error when clientId is empty", async () => {
      const handleSetClientNickname = await getHandler();
      const result = await handleSetClientNickname({ clientId: "", nickname: "MyNick" });
      expect(result.success).toBe(false);
      expect(result.error).toBe("clientId and nickname are required");
    });

    it("should return error when nickname is empty", async () => {
      const handleSetClientNickname = await getHandler();
      const result = await handleSetClientNickname({ clientId: "client-1", nickname: "" });
      expect(result.success).toBe(false);
      expect(result.error).toBe("clientId and nickname are required");
    });

    it("should set nickname successfully", async () => {
      const handleSetClientNickname = await getHandler();
      const returnedRow = makeClientRow({ nickname: "NewNick" });
      mockClientRepo.setNickname = async () => returnedRow;

      const result = await handleSetClientNickname({
        clientId: "client-1",
        nickname: "NewNick",
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ nickname: "NewNick" });
    });

    it("should return error for missing client (setNickname returns null)", async () => {
      const handleSetClientNickname = await getHandler();
      mockClientRepo.setNickname = async () => null;

      const result = await handleSetClientNickname({
        clientId: "nonexistent",
        nickname: "Ghost",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Client not found — connect first");
    });

    it("should propagate unexpected errors", async () => {
      const handleSetClientNickname = await getHandler();
      mockClientRepo.setNickname = async () => {
        throw new Error("DB connection lost");
      };

      const result = await handleSetClientNickname({
        clientId: "client-1",
        nickname: "Oops",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Internal server error");
    });
  });
});
