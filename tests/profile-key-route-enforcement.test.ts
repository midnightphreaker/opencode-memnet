import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WebServer } from "../src/services/web-server.js";

const read = (path: string) => readFileSync(join(import.meta.dir, "..", path), "utf-8");
type AuthHelper = {
  authenticateApiRequest(req: Request, path: string): unknown;
};

describe("profile key route enforcement", () => {
  const webServer = read("src/services/web-server.ts");
  const server = read("src/server.ts");

  it("passes configured profiles into the web server", () => {
    expect(server).toContain("configuredProfiles: config.configuredProfiles");
    expect(webServer).toContain("configuredProfiles?: ConfiguredProfile[]");
  });

  it("classifies plugin requests with X-Opencode-Memnet-Client", () => {
    expect(webServer).toContain('"X-Opencode-Memnet-Client"');
    expect(webServer).toContain('=== "plugin"');
    expect(webServer).toContain("CLIENT_AUTH_ROUTES");
  });

  it("keeps the request principal from auth and passes it to scoped routes", () => {
    expect(webServer).toContain("const authContext = this.authenticateApiRequest(req, path)");
    expect(webServer).toContain("const principal = authContext.principal");
  });

  it("enforces profile scope on query and body profile IDs", () => {
    expect(webServer).toContain("requireProfileIdForPrincipal(principal");
    expect(webServer).toContain("applyPrincipalProfileToBody");
  });

  it("filters profile listing by principal", () => {
    expect(webServer).toContain("handleListUserProfiles(principal)");
    expect(webServer).toContain("principalResponse(principal)");
  });

  it("uses principal profile for maintenance job scope", () => {
    expect(webServer).toContain("deriveJobScope(principal)");
    expect(webServer).toContain('principal.kind === "profile"');
  });

  it("does not allow spoofed plugin headers to bypass WebUI auth on shared routes", async () => {
    const server = new WebServer({ port: 0, host: "127.0.0.1", enabled: false }, "admin-secret", {
      disableWebuiAuth: false,
      disableClientAuth: true,
    }) as unknown as AuthHelper;

    const sharedRouteResult = server.authenticateApiRequest(
      new Request("http://localhost/api/memories", {
        headers: { "X-Opencode-Memnet-Client": "plugin" },
      }),
      "/api/memories"
    );
    expect(sharedRouteResult).toBeInstanceOf(Response);
    expect((sharedRouteResult as Response).status).toBe(401);

    const clientConnectResult = server.authenticateApiRequest(
      new Request("http://localhost/api/client/connect", {
        method: "POST",
        headers: { "X-Opencode-Memnet-Client": "plugin" },
      }),
      "/api/client/connect"
    );
    expect(clientConnectResult).toEqual({
      principal: { kind: "admin" },
      authDisabled: true,
    });

    const clientStatsResult = server.authenticateApiRequest(
      new Request("http://localhost/api/client/stats", {
        method: "GET",
        headers: { "X-Opencode-Memnet-Client": "plugin" },
      }),
      "/api/client/stats"
    );
    expect(clientStatsResult).toEqual({
      principal: { kind: "admin" },
      authDisabled: true,
    });

    const badBearerResult = server.authenticateApiRequest(
      new Request("http://localhost/api/client/connect", {
        method: "POST",
        headers: {
          Authorization: "Bearer wrong",
          "X-Opencode-Memnet-Client": "plugin",
        },
      }),
      "/api/client/connect"
    );
    expect(badBearerResult).toBeInstanceOf(Response);
    expect((badBearerResult as Response).status).toBe(401);
  });
});
