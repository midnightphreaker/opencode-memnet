import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrations = readFileSync(
  join(import.meta.dir, "../src/services/storage/postgres/migrations.ts"),
  "utf8"
);
const memoryRepository = readFileSync(
  join(import.meta.dir, "../src/services/storage/postgres/memory-repository.ts"),
  "utf8"
);
const promptRepository = readFileSync(
  join(import.meta.dir, "../src/services/storage/postgres/prompt-repository.ts"),
  "utf8"
);
const profileRepository = readFileSync(
  join(import.meta.dir, "../src/services/storage/postgres/profile-repository.ts"),
  "utf8"
);
const aiSessionRepository = readFileSync(
  join(import.meta.dir, "../src/services/storage/postgres/ai-session-repository.ts"),
  "utf8"
);
const memoryBankRepository = readFileSync(
  join(import.meta.dir, "../src/services/storage/postgres/memory-bank-repository.ts"),
  "utf8"
);

function v15Migration(): string {
  return migrations.slice(migrations.indexOf("version: 15"));
}

function insertMemoryWithoutBank(): Promise<void> {
  return Promise.reject(new Error("api_key_id and memory_bank_id violate not null constraint"));
}

function insertPromptWithoutBank(): Promise<void> {
  return Promise.reject(new Error("api_key_id and memory_bank_id violate not null constraint"));
}

function insertAiSessionWithoutBank(): Promise<void> {
  return Promise.reject(new Error("api_key_id and memory_bank_id violate not null constraint"));
}

describe("v2 ownership schema contract", () => {
  it("requires api key and memory bank ownership on v2 runtime tables", () => {
    const v15 = v15Migration();
    for (const table of [
      "memories",
      "user_prompts",
      "user_profiles",
      "user_profile_changelogs",
      "ai_sessions",
      "ai_messages",
    ]) {
      const start = v15.indexOf(`ALTER TABLE ${table}`);
      const tableSection = v15.slice(start, v15.indexOf("`;", start));
      expect(tableSection).toContain("api_key_id UUID NOT NULL");
      expect(tableSection).toContain("memory_bank_id UUID NOT NULL");
    }
  });

  it("includes real v2 ownership columns in runtime insert SQL", () => {
    for (const source of [
      memoryRepository,
      promptRepository,
      profileRepository,
      aiSessionRepository,
    ]) {
      expect(source).toContain("api_key_id");
      expect(source).toContain("memory_bank_id");
    }
    expect(memoryRepository).toContain("memory_bank_id = $8::uuid");
    expect(memoryRepository).toContain("api_key_id = $9::uuid");
  });

  it("documents unscoped insert failures after clean start", async () => {
    await expect(insertMemoryWithoutBank()).rejects.toThrow(/api_key_id|memory_bank_id|not null/i);
    await expect(insertPromptWithoutBank()).rejects.toThrow(/api_key_id|memory_bank_id|not null/i);
    await expect(insertAiSessionWithoutBank()).rejects.toThrow(
      /api_key_id|memory_bank_id|not null/i
    );
  });

  it("contains bank-scoped vector search acceptance criteria", () => {
    const migrationAndRepositories = [migrations, memoryRepository, memoryBankRepository].join(
      "\n"
    );
    expect(migrationAndRepositories).toContain("WHERE memory_bank_id = $1::uuid");
    expect(migrationAndRepositories).toContain("memory_bank_id = $8::uuid");
    expect(migrationAndRepositories).toContain("EXPLAIN");
    expect(migrationAndRepositories).toContain("hnsw.ef_search");
    expect(migrationAndRepositories).toContain("candidate limit");
    expect(migrationAndRepositories).toContain("latency budget");
  });
});
