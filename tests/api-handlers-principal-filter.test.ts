import { describe, expect, it, mock } from "bun:test";

const distinctTagCalls: unknown[] = [];

const memoryRepo = {
  initialize: async () => {},
  getDistinctTags: async (args?: unknown) => {
    distinctTagCalls.push(args);
    return [
      { tag: "repo_project_alpha", profileId: "phrkr", repoId: "repo-a" },
      { tag: "repo_project_beta", profileId: "other", repoId: "repo-b" },
      { tag: "global_project_missing_profile", repoId: "repo-c" },
      { tag: "not_a_scope_tag", profileId: "phrkr", repoId: "repo-a" },
    ];
  },
};

const promptRepo = {
  initialize: async () => {},
};

const profileRepo = {
  initialize: async () => {},
  getAllActiveProfiles: async () => [{ profileId: "phrkr" }, { profileId: "other" }],
};

const clientRepo = {
  initialize: async () => {},
};

const profileApiKeyRepo = {
  initialize: async () => {},
  findProfileByApiKey: async () => null,
  hasKeyForProfile: async () => false,
  createKeyForProfile: async () => true,
  touchLastUsed: async () => {},
};

mock.module("../src/services/storage/factory.js", () => ({
  createMemoryRepository: () => memoryRepo,
  createUserPromptRepository: () => promptRepo,
  createUserProfileRepository: () => profileRepo,
  createClientRepository: () => clientRepo,
  createProfileApiKeyRepository: () => profileApiKeyRepo,
  createTagRegistry: () => ({}),
}));

const { handleListTags, handleListUserProfiles } = await import("../src/services/api-handlers.js");

describe("api handler principal filters", () => {
  it("passes profileId to tag storage and filters returned tags defensively", async () => {
    const result = await handleListTags("phrkr");

    expect(result.success).toBe(true);
    expect(distinctTagCalls.at(-1)).toEqual({ scope: "project", profileId: "phrkr" });
    expect(result.data?.project.map((tag) => tag.tag)).toEqual(["repo_project_alpha"]);
  });

  it("limits user profile listing to the profile principal", async () => {
    const result = await handleListUserProfiles({ kind: "profile", profileId: "phrkr" });

    expect(result).toEqual({
      success: true,
      data: { profiles: [{ profileId: "phrkr" }] },
    });
  });

  it("keeps admin user profile listing unrestricted", async () => {
    const result = await handleListUserProfiles({ kind: "admin" });

    expect(result).toEqual({
      success: true,
      data: { profiles: [{ profileId: "phrkr" }, { profileId: "other" }] },
    });
  });
});
