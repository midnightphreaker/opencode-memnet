import { describe, expect, it } from "bun:test";
import { AuthMiddleware } from "../src/services/auth.js";

function requestWithBearer(key?: string): Request {
  const headers = new Headers();
  if (key !== undefined) headers.set("Authorization", `Bearer ${key}`);
  return new Request("http://localhost/api/memories", { headers });
}

describe("v2 AuthMiddleware", () => {
  it("authenticates SERVER_API_KEY as admin", async () => {
    const auth = new AuthMiddleware({
      authenticateBearer: async (key: string) =>
        key === "admin-secret" ? { kind: "admin" } : null,
    } as any);

    const result = await auth.authenticate(requestWithBearer("admin-secret"));

    expect(result instanceof Response).toBe(false);
    expect(result).toEqual({ principal: { kind: "admin" } });
  });

  it("authenticates user API keys as user principals", async () => {
    const auth = new AuthMiddleware({
      authenticateBearer: async (key: string) =>
        key === "user-secret"
          ? {
              kind: "user-api-key",
              apiKeyId: "key-1",
              apiKeyName: "opencode",
              apiKeyDescription: "OpenCode agent memory access",
            }
          : null,
    } as any);

    const result = await auth.authenticate(requestWithBearer("user-secret"));

    expect(result instanceof Response).toBe(false);
    expect(result).toEqual({
      principal: {
        kind: "user-api-key",
        apiKeyId: "key-1",
        apiKeyName: "opencode",
        apiKeyDescription: "OpenCode agent memory access",
      },
    });
  });

  it("rejects missing and invalid bearer tokens", async () => {
    const auth = new AuthMiddleware({ authenticateBearer: async () => null } as any);

    const missing = await auth.authenticate(requestWithBearer(undefined));
    expect(missing).toBeInstanceOf(Response);
    expect((missing as Response).status).toBe(401);

    const invalid = await auth.authenticate(requestWithBearer("wrong"));
    expect(invalid).toBeInstanceOf(Response);
    expect((invalid as Response).status).toBe(401);
  });
});
