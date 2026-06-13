import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("prompt repository strict scope", () => {
  const source = readFileSync(
    join(import.meta.dir, "../src/services/storage/postgres/prompt-repository.ts"),
    "utf-8"
  );

  it("does not filter prompts by legacy project path", () => {
    expect(source).not.toMatch(/\bproject_path\b/);
    expect(source).toContain("profile_id");
    expect(source).toContain("repo_id");
    expect(source).toContain("local_project_path");
  });
});

describe("api handler strict identity", () => {
  const source = readFileSync(join(import.meta.dir, "../src/services/api-handlers.ts"), "utf-8");

  it("does not accept userEmail or projectPath as filter inputs", () => {
    expect(source).not.toContain('url.searchParams.get("userEmail")');
    expect(source).not.toContain("getTags(process.cwd())");
    expect(source).not.toContain("projectPath ?? undefined");
  });

  it("requires profileId and repoId for project memory operations", () => {
    expect(source).toContain("profileId");
    expect(source).toContain("repoId");
  });
});
