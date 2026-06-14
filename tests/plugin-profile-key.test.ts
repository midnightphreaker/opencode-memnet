import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const indexRemote = readFileSync(join(import.meta.dir, "../plugin/src/index-remote.ts"), "utf-8");
const remoteClient = readFileSync(
  join(import.meta.dir, "../plugin/src/services/remote-client.ts"),
  "utf-8"
);
const clientConfig = readFileSync(join(import.meta.dir, "../shared/client-config.ts"), "utf-8");
const apiHandlers = readFileSync(join(import.meta.dir, "../src/services/api-handlers.ts"), "utf-8");

describe("plugin profile key support", () => {
  it("keeps profileId optional in client config", () => {
    expect(clientConfig).toContain("profileId?: string");
  });

  it("uses clientConnect principal as effective profile for profile keys", () => {
    expect(indexRemote).toContain("let effectiveProfileId = CLIENT_CONFIG.profileId");
    expect(indexRemote).toContain('connectionInfo.principal?.kind === "profile"');
    expect(indexRemote).toContain("effectiveProfileId = connectionInfo.principal.profileId");
  });

  it("falls back to default only for admin principals", () => {
    expect(indexRemote).toContain('connectionInfo.principal?.kind !== "profile"');
    expect(indexRemote).toContain('effectiveProfileId = effectiveProfileId ?? "default"');
  });

  it("types clientConnect principal metadata", () => {
    expect(remoteClient).toContain(
      'principal: { kind: "admin" } | { kind: "profile"; profileId: string; displayName?: string }'
    );
  });

  it("returns principal metadata from client connect", () => {
    expect(apiHandlers).toContain('principal: Principal = { kind: "admin" }');
    expect(apiHandlers).toContain("principal: principalResponse(effectivePrincipal)");
  });
});
