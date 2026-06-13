import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationsSource = readFileSync(
  join(import.meta.dir, "../../src/services/storage/postgres/migrations.ts"),
  "utf-8"
);

describe("strict clean-start schema", () => {
  it("does not create runtime legacy identity columns or tables", () => {
    expect(migrationsSource).not.toContain("user_identities");
    expect(migrationsSource).not.toMatch(/\bnickname\b/);
    expect(migrationsSource).not.toMatch(/\buser_email\b/);
    expect(migrationsSource).not.toMatch(/\bdisplay_name\b/);
    expect(migrationsSource).not.toMatch(/\buser_name\b/);
    expect(migrationsSource).not.toMatch(/\bproject_path\b/);
  });

  it("creates profile and repository identity tables", () => {
    expect(migrationsSource).toContain("CREATE TABLE IF NOT EXISTS git_repositories");
    expect(migrationsSource).toContain("CREATE TABLE IF NOT EXISTS profile_repo_links");
    expect(migrationsSource).toContain("profile_id");
    expect(migrationsSource).toContain("repo_id");
    expect(migrationsSource).toContain("local_project_path");
  });
});
