import { describe, expect, it } from "bun:test";
import {
  normalizeGitRepoUrl,
  requireProfileScope,
  requireProjectScope,
} from "../src/services/identity-scope.js";

describe("strict identity scope", () => {
  it("normalizes common git remote URL forms to the same identity", () => {
    expect(normalizeGitRepoUrl("git@github.com:Owner/Repo.git")).toBe(
      "https://github.com/owner/repo"
    );
    expect(normalizeGitRepoUrl("https://github.com/Owner/Repo.git/")).toBe(
      "https://github.com/owner/repo"
    );
  });

  it("requires profile scope", () => {
    expect(requireProfileScope({ profileId: "phrkr" })).toEqual({ profileId: "phrkr" });
    expect(() => requireProfileScope({ profileId: "" })).toThrow("profileId is required");
  });

  it("requires project scope", () => {
    expect(requireProjectScope({ profileId: "phrkr", repoId: "repo_abc" })).toEqual({
      profileId: "phrkr",
      repoId: "repo_abc",
    });
    expect(() => requireProjectScope({ profileId: "phrkr", repoId: "" })).toThrow(
      "repoId is required"
    );
  });
});
