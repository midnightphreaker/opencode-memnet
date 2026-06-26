import { describe, expect, it } from "bun:test";
import { WebServer } from "../src/services/web-server.js";

function makeAuthService() {
  const banks = [
    {
      id: "bank-1",
      apiKeyId: "key-1",
      apiKeyName: "opencode",
      name: "vllm-setup",
      description: "Work done on vllm-setup repo",
      shortcut: "opencode>vllm-setup",
      createdAt: 1,
      updatedAt: 1,
    },
  ];
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
    listMemoryBanksForApiKey: async (apiKeyId: string) =>
      banks.filter((bank) => bank.apiKeyId === apiKeyId),
    createMemoryBankForApiKey: async (args: any) => ({
      id: "bank-2",
      apiKeyId: args.apiKeyId,
      apiKeyName: "opencode",
      name: args.name,
      description: args.description,
      shortcut: `opencode>${args.name}`,
      createdAt: 2,
      updatedAt: 2,
    }),
    updateUserApiKey: async (args: any) => ({
      id: args.id,
      name: args.name ?? "opencode",
      description: args.description ?? "OpenCode agent memory access",
      createdAt: 1,
      updatedAt: 3,
      lastUsedAt: null,
      revokedAt: null,
    }),
    revokeUserApiKey: async () => true,
    updateMemoryBank: async (args: any) => ({
      id: args.id,
      apiKeyId: "key-1",
      apiKeyName: "opencode",
      name: args.name ?? "vllm-setup",
      description: args.description ?? "Work done on vllm-setup repo",
      shortcut: `opencode>${args.name ?? "vllm-setup"}`,
      createdAt: 1,
      updatedAt: 3,
    }),
    deleteMemoryBank: async (id: string) => id !== "non-empty-bank",
  };
}

async function route(method: string, path: string, bearer: string, body?: unknown) {
  const server = new WebServer(
    { port: 0, host: "127.0.0.1", enabled: false },
    makeAuthService() as any
  ) as any;
  return server._handleRequest(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${bearer}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  );
}

describe("v2 Memory Bank routes", () => {
  it("lists and creates Memory Banks for the authenticated user API key", async () => {
    const listResponse = await route("GET", "/api/memory-banks", "user");
    expect(listResponse.status).toBe(200);
    const listJson = await listResponse.json();
    expect(listJson.data.memoryBanks[0].shortcut).toBe("opencode>vllm-setup");

    const createResponse = await route("POST", "/api/memory-banks", "user", {
      name: "new-project",
      description: "work relating to new-project",
    });
    expect(createResponse.status).toBe(200);
    const createJson = await createResponse.json();
    expect(createJson.data.memoryBank.name).toBe("new-project");
  });

  it("lists and creates Memory Banks through admin nested API key routes", async () => {
    const listResponse = await route("GET", "/api/admin/api-keys/key-1/memory-banks", "admin");
    expect(listResponse.status).toBe(200);

    const createResponse = await route("POST", "/api/admin/api-keys/key-1/memory-banks", "admin", {
      name: "ops",
      description: "Work done on ops repo",
    });
    expect(createResponse.status).toBe(200);
    const json = await createResponse.json();
    expect(json.data.memoryBank.apiKeyId).toBe("key-1");
  });

  it("allows the X-Memory-Bank-ID header in CORS preflight", async () => {
    const response = await route("OPTIONS", "/api/memories", "user");
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("X-Memory-Bank-ID");
  });

  it("updates and revokes user API keys through admin routes", async () => {
    const updateResponse = await route("PATCH", "/api/admin/api-keys/key-1", "admin", {
      name: "codex",
      description: "Codex agent memory access",
    });
    expect(updateResponse.status).toBe(200);
    const updateJson = await updateResponse.json();
    expect(updateJson.data.apiKey.name).toBe("codex");

    const revokeResponse = await route("POST", "/api/admin/api-keys/key-1/revoke", "admin");
    expect(revokeResponse.status).toBe(200);
    const revokeJson = await revokeResponse.json();
    expect(revokeJson.data.revoked).toBe(true);
  });

  it("updates Memory Banks and refuses to delete non-empty banks", async () => {
    const updateResponse = await route("PATCH", "/api/admin/memory-banks/bank-1", "admin", {
      name: "renamed",
      description: "Renamed bank",
    });
    expect(updateResponse.status).toBe(200);
    const updateJson = await updateResponse.json();
    expect(updateJson.data.memoryBank.name).toBe("renamed");

    const deleteResponse = await route("DELETE", "/api/admin/memory-banks/non-empty-bank", "admin");
    expect(deleteResponse.status).toBe(409);
    const deleteJson = await deleteResponse.json();
    expect(deleteJson.error).toContain("not empty");
  });
});
