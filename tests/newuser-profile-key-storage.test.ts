import { describe, expect, it } from "bun:test";
import { migrations } from "../src/services/storage/postgres/migrations.js";

describe("generated profile API key storage contract", () => {
  it("adds a one-key-per-profile hashed storage table", () => {
    const migrationSql = migrations.map((migration) => String(migration.up)).join("\n");

    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS profile_api_keys");
    expect(migrationSql).toContain("profile_id");
    expect(migrationSql).toContain("api_key_hash");
    expect(migrationSql).toContain("UNIQUE");
    expect(migrationSql).not.toContain("api_key TEXT");
  });
});
