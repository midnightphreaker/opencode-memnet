import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Principal } from "../src/services/profile-auth.js";

const generatedKeys = new Map<string, string>();
const clients = new Map<string, { firstSeen: number; lastSeen: number }>();

const profileApiKeyRepo = {
  initialize: async () => {},
  createKeyForProfile: async (profileId: string, apiKey: string) => {
    if (generatedKeys.has(profileId)) return false;
    generatedKeys.set(profileId, apiKey);
    return true;
  },
  findProfileByApiKey: async (apiKey: string) => {
    for (const [profileId, storedKey] of generatedKeys) {
      if (storedKey === apiKey) return { profileId };
    }
    return null;
  },
  hasKeyForProfile: async (profileId: string) => generatedKeys.has(profileId),
  touchLastUsed: async () => {},
};

const clientRepo = {
  initialize: async () => {},
  upsertClient: async (clientId: string) => {
    const existing = clients.get(clientId);
    const now = Date.now();
    clients.set(clientId, { firstSeen: existing?.firstSeen ?? now, lastSeen: now });
    return { firstTime: !existing, previousLastSeen: existing?.lastSeen ?? null, row: {} };
  },
  getClientStats: async () => ({
    totalMemories: 0,
    memoriesToday: 0,
    totalPrompts: 0,
    client: {},
  }),
};

mock.module("../src/server-config.js", () => ({
  getServerConfig: () => ({
    clientWelcomeBackThreshold: 168,
    configuredProfiles: [{ profileId: "static", apiKey: "static-secret" }],
  }),
}));

mock.module("../src/services/storage/factory.js", () => ({
  createMemoryRepository: () => ({ initialize: async () => {} }),
  createUserPromptRepository: () => ({ initialize: async () => {} }),
  createUserProfileRepository: () => ({ initialize: async () => {} }),
  createClientRepository: () => clientRepo,
  createProfileApiKeyRepository: () => profileApiKeyRepo,
  createTagRegistry: () => ({}),
}));

const { handleClientConnect } = await import("../src/services/api-handlers.js?newuser-connect");

beforeEach(() => {
  generatedKeys.clear();
  clients.clear();
});

describe("NEWUSER_API_KEY client enrollment", () => {
  const bootstrapPrincipal: Principal = { kind: "newuser" };

  it("requires profileId when connecting with the bootstrap principal", async () => {
    const result = await handleClientConnect({ clientId: "client-one" }, bootstrapPrincipal);

    expect(result).toEqual({
      success: false,
      error: "profileId is required when using NEWUSER_API_KEY",
    });
  });

  it("creates and returns one generated key for a new profile", async () => {
    const result = await handleClientConnect(
      { clientId: "client-one", profileId: "phrkr" },
      bootstrapPrincipal
    );

    expect(result.success).toBe(true);
    expect(result.data?.principal).toEqual({ kind: "profile", profileId: "phrkr" });
    expect(result.data?.enrollment?.profileId).toBe("phrkr");
    expect(result.data?.enrollment?.apiKey).toBeString();
    expect(result.data?.enrollment?.apiKey).toBe(generatedKeys.get("phrkr"));
  });

  it("denies enrollment when the profile already has a generated or static key", async () => {
    await handleClientConnect({ clientId: "client-one", profileId: "phrkr" }, bootstrapPrincipal);
    const repeat = await handleClientConnect(
      { clientId: "client-two", profileId: "phrkr" },
      bootstrapPrincipal
    );
    const staticProfile = await handleClientConnect(
      { clientId: "client-three", profileId: "static" },
      bootstrapPrincipal
    );

    expect(repeat).toEqual({
      success: false,
      error:
        "Profile already has an API key. Configure the client with that profile key instead of NEWUSER_API_KEY.",
    });
    expect(staticProfile).toEqual(repeat);
  });
});
