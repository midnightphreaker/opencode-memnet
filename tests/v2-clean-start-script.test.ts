import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const script = readFileSync(join(import.meta.dir, "../scripts/v2-clean-start.ts"), "utf8");

describe("v2 clean-start script contract", () => {
  it("creates a timestamped custom-format backup and verifies it", () => {
    expect(script).toContain("backups/opencode-memnet-v1-");
    expect(script).toContain("pg_dump");
    expect(script).toContain("--format=custom");
    expect(script).toContain("pg_restore --list");
  });

  it("removes only the v1 runtime/auth/memory data after backup verification", () => {
    for (const table of [
      "memory_tag_links",
      "memory_tag_aliases",
      "memory_tags",
      "user_profile_changelogs",
      "user_profiles",
      "user_prompts",
      "memories",
      "profile_repo_links",
      "git_repositories",
      "ai_messages",
      "ai_sessions",
      "clients",
      "profile_api_keys",
    ]) {
      expect(script).toContain(table);
    }
    expect(script).toContain("RESTART IDENTITY CASCADE");
  });

  it("does not contain v1 readback or transfer behavior", () => {
    expect(script).not.toMatch(/\bINSERT\s+INTO\s+memories\b/i);
    expect(script).not.toMatch(/\bINSERT\s+INTO\s+user_prompts\b/i);
    expect(script).not.toMatch(/backfill|import.*v1|copy.*v1/i);
  });
});
