import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WebServer } from "../src/services/web-server.js";

const read = (path: string) => readFileSync(join(import.meta.dir, "..", path), "utf-8");
type AuthHelper = {
  authenticateApiRequest(req: Request, path: string): Promise<unknown>;
};

function authService() {
  return {
    authenticateBearer: async (key: string) => (key === "admin-secret" ? { kind: "admin" } : null),
  };
}

describe("v2 auth route enforcement", () => {
  const webServer = read("src/services/web-server.ts");
  const server = read("src/server.ts");

  it("passes AuthService into the web server", () => {
    expect(server).toContain("new AuthService");
    expect(server).toContain("createUserApiKeyRepository()");
    expect(server).toContain("createMemoryBankRepository()");
    expect(webServer).toContain("constructor(config: WebServerConfig, authService: AuthService)");
  });

  it("removes route-kind auth branching and legacy fallback", () => {
    const legacyGeneratedProfileMessage = ["Generated", "profile", "key", "lookup", "failed"].join(
      " "
    );
    expect(webServer).not.toContain("RouteKind");
    expect(webServer).not.toContain("CLIENT_AUTH_ROUTES");
    expect(webServer).not.toContain("createProfileApiKeyRepository");
    expect(webServer).not.toContain(legacyGeneratedProfileMessage);
  });

  it("keeps the request principal from auth and passes it to scoped routes", () => {
    expect(webServer).toContain("const authContext = await this.authenticateApiRequest(req, path)");
    expect(webServer).toContain("const principal = authContext.principal");
  });

  it("enforces v2 bearer auth on API routes", async () => {
    const server = new WebServer(
      { port: 0, host: "127.0.0.1", enabled: false },
      authService() as any
    ) as unknown as AuthHelper;

    const missing = await server.authenticateApiRequest(
      new Request("http://localhost/api/memories"),
      "/api/memories"
    );
    expect(missing).toBeInstanceOf(Response);
    expect((missing as Response).status).toBe(401);

    const invalid = await server.authenticateApiRequest(
      new Request("http://localhost/api/memories", {
        headers: { Authorization: "Bearer wrong" },
      }),
      "/api/memories"
    );
    expect(invalid).toBeInstanceOf(Response);
    expect((invalid as Response).status).toBe(401);

    const valid = await server.authenticateApiRequest(
      new Request("http://localhost/api/memories", {
        headers: { Authorization: "Bearer admin-secret" },
      }),
      "/api/memories"
    );
    expect(valid).toEqual({ principal: { kind: "admin" } });
  });
});
