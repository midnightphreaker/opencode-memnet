import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const app = readFileSync(join(import.meta.dir, "../src/web/app.js"), "utf-8");

describe("WebUI profile key lock", () => {
  it("tracks principal metadata from /api/user-profiles", () => {
    expect(app).toContain("principal: null");
    expect(app).toContain("applyProfilePrincipal");
    expect(app).toContain("data.data.principal");
  });

  it("uses fetchAPI for profile list calls so Authorization is sent", () => {
    expect(app).toContain('fetchAPI("/api/user-profiles")');
    expect(app).not.toContain('fetch("/api/user-profiles"');
  });

  it("locks profile selectors for profile principals", () => {
    expect(app).toContain('state.principal?.kind === "profile"');
    expect(app).toContain("select.disabled = state.profileLocked");
    expect(app).toContain("state.activeProfileId = state.principal.profileId");
  });

  it("prevents profile change handlers from switching profile principals", () => {
    expect(app).toContain("if (state.profileLocked) return;");
  });

  it("loads profile principal metadata before the initial authenticated data load", () => {
    expect(app).toContain("if (state.authKey) await populateProfileDropdown();");
  });

  it("does not support keyless auth-disabled WebUI state", () => {
    expect(app).not.toContain("authDisabled");
    expect(app).not.toContain("(auth disabled)");
    expect(app).not.toContain("Auth disabled");
  });
});
