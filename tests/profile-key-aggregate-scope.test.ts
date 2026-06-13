import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(import.meta.dir, "..", path), "utf-8");

describe("profile key aggregate scope", () => {
  it("adds profile and repo filters to memory aggregate interfaces", () => {
    const types = read("src/services/storage/types.ts");

    expect(types).toContain("profileId?: string");
    expect(types).toContain("repoId?: string");
    expect(types).toContain("countByType(args?:");
    expect(types).toContain("getDistinctTags(args?:");
    expect(types).toContain("getDistinctTagValues(args?:");
  });

  it("filters postgres aggregate SQL by profile_id and repo_id", () => {
    const repo = read("src/services/storage/postgres/memory-repository.ts");

    expect(repo).toContain("profileIdFilter");
    expect(repo).toContain("repoIdFilter");
    expect(repo).toContain("profile_id = ${profileIdFilter}");
    expect(repo).toContain("repo_id = ${repoIdFilter}");
  });

  it("forwards aggregate filter args through the lazy storage proxy", () => {
    const factory = read("src/services/storage/factory.ts");

    expect(factory).toContain('Parameters<MemoryRepository["countByType"]>[0]');
    expect(factory).toContain('Parameters<MemoryRepository["getDistinctTagValues"]>[0]');
    expect(factory).toContain(".countByType(args)");
    expect(factory).toContain(".getDistinctTagValues(args)");
  });

  it("passes profile scope into tags and stats handlers", () => {
    const handlers = read("src/services/api-handlers.ts");

    expect(handlers).toContain("export async function handleListTags");
    expect(handlers).toContain("profileId?: string");
    expect(handlers).toContain("handleStats(profileId?: string)");
    expect(handlers).toContain("memoryRepo.countByType({ profileId })");
    expect(handlers).toContain("await getProjectScopeFromTag(tag, profileId)");
  });

  it("passes profile principals into the stats handler from the web server", () => {
    const server = read("src/services/web-server.ts");

    expect(server).toContain('path === "/api/stats"');
    expect(server).toContain('principal.kind === "profile" ? principal.profileId : undefined');
    expect(server).toContain("handleStats(profileFilter)");
  });
});
