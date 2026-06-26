import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sourceFiles = [
  "src/services/storage/postgres/migrations.ts",
  "src/services/storage/postgres/memory-repository.ts",
  "src/services/storage/postgres/prompt-repository.ts",
  "src/services/storage/postgres/profile-repository.ts",
  "src/services/api-handlers.ts",
  "src/services/web-server.ts",
  "scripts/v2-clean-start.ts",
];

function readProjectFile(path: string) {
  return readFileSync(join(import.meta.dir, "..", path), "utf8");
}

describe("v2 clean start has no v1 upgrade path", () => {
  it("keeps reset separate from migration and exposes no v1 transfer path", () => {
    for (const path of sourceFiles) {
      const text = readProjectFile(path);
      expect(text).not.toMatch(/v1.*(import|backfill|compatibility)/i);
      expect(text).not.toMatch(/profile_id\s*=.*api_key_id/i);
      expect(text).not.toMatch(/repo_id\s*=.*memory_bank_id/i);
    }
  });

  it("requires v2 ownership before runtime rows are exposed", () => {
    const handlers = readProjectFile("src/services/api-handlers.ts");
    expect(handlers).toContain("memoryBankId");
    expect(handlers).toContain("apiKeyId");
    expect(handlers).not.toMatch(/WHERE\s+profile_id\s*=/i);
  });
});
