import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(import.meta.dir, "..", path), "utf-8");

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
});
