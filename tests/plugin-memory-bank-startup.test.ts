import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const remoteClient = readFileSync(
  join(import.meta.dir, "../plugin/src/services/remote-client.ts"),
  "utf-8"
);
const plugin = readFileSync(join(import.meta.dir, "../plugin/src/index-remote.ts"), "utf-8");
const config = readFileSync(join(import.meta.dir, "../shared/client-config.ts"), "utf-8");

describe("OpenCode plugin v2 Memory Bank startup", () => {
  it("removes profile and NEWUSER enrollment config behavior", () => {
    expect(config).not.toContain("profileId");
    expect(config).not.toContain("rewriteClientApiKeySource");
    expect(remoteClient).not.toContain("enrollment");
  });

  it("stores and sends an active Memory Bank ID", () => {
    expect(plugin).toContain("activeMemoryBank");
    expect(plugin).toContain("requiresMemoryBank");
    expect(remoteClient).toContain("ClientConnectResponse");
    expect(remoteClient).toContain("X-Memory-Bank-ID");
    expect(plugin).toContain("No active Memory Bank");
    expect(plugin).not.toContain("profileId");
  });
});
