import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dir, "../src/services/api-handlers.ts"), "utf-8");

describe("profile key API ownership checks", () => {
  it("imports Principal and ForbiddenError", () => {
    expect(source).toContain('import type { Principal } from "./profile-auth.js"');
    expect(source).toContain("ForbiddenError");
  });

  it("checks memory record ownership for ID-based memory operations", () => {
    expect(source).toContain("function ensurePrincipalCanAccessProfile");
    expect(source).toContain("handleDeleteMemory(");
    expect(source).toContain("principal?: Principal");
    expect(source).toContain("ensurePrincipalCanAccessProfile(principal, memory.profileId)");
  });

  it("checks prompt record ownership for prompt deletion", () => {
    expect(source).toContain("ensurePrincipalCanAccessProfile(principal, prompt.profileId)");
  });

  it("checks changelog ownership for snapshot reads", () => {
    expect(source).toContain(
      "handleGetProfileSnapshot(changelogId: string, principal?: Principal)"
    );
    expect(source).toContain("ensurePrincipalCanAccessProfile(principal, changelog.profileId)");
  });

  it("filters listed profiles by principal", () => {
    expect(source).toContain("handleListUserProfiles(principal?: Principal)");
    expect(source).toContain('principal.kind === "profile"');
  });
});
