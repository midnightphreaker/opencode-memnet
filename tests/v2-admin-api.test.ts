import { describe, expect, it } from "bun:test";
import { WebServer } from "../src/services/web-server.js";

function makeAuthService() {
  const keys: any[] = [];
  const banks: any[] = [];
  return {
    authenticateBearer: async (key: string) =>
      key === "admin"
        ? { kind: "admin" }
        : key === "user"
          ? {
              kind: "user-api-key",
              apiKeyId: "key-1",
              apiKeyName: "opencode",
              apiKeyDescription: "OpenCode agent memory access",
            }
          : null,
    createUserApiKey: async (args: any) => {
      const apiKey = {
        id: "key-1",
        name: args.name,
        description: args.description,
        createdAt: 1,
        updatedAt: 1,
        lastUsedAt: null,
        revokedAt: null,
      };
      keys.push(apiKey);
      return { apiKey, value: "omnu_created-secret" };
    },
    listUserApiKeys: async () => keys,
    listMemoryBanks: async () => banks,
  };
}

describe("v2 admin routes", () => {
  it("creates user API keys with admin auth and reveals value once", async () => {
    const server = new WebServer(
      { port: 0, host: "127.0.0.1", enabled: false },
      makeAuthService() as any
    ) as any;

    const response = await server._handleRequest(
      new Request("http://localhost/api/admin/api-keys", {
        method: "POST",
        headers: { Authorization: "Bearer admin" },
        body: JSON.stringify({
          name: "opencode",
          description: "OpenCode agent memory access",
        }),
      })
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.data.value).toBe("omnu_created-secret");
    expect(json.data.apiKey.name).toBe("opencode");
  });

  it("forbids admin routes for user API keys", async () => {
    const server = new WebServer(
      { port: 0, host: "127.0.0.1", enabled: false },
      makeAuthService() as any
    ) as any;

    const response = await server._handleRequest(
      new Request("http://localhost/api/admin/api-keys", {
        method: "GET",
        headers: { Authorization: "Bearer user" },
      })
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Admin key required",
    });
  });
});
