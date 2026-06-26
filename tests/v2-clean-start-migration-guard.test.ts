import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrations = readFileSync(
  join(import.meta.dir, "../src/services/storage/postgres/migrations.ts"),
  "utf8"
);

describe("migration 15 clean-start guard", () => {
  it("counts v1 data rows before schema changes and throws when rows remain", () => {
    const v15 = migrations.slice(migrations.indexOf("version: 15"));
    expect(v15).toContain("v1DataRowCount");
    expect(v15).toContain("throw new Error");
    expect(v15.indexOf("v1DataRowCount")).toBeLessThan(
      v15.indexOf("CREATE TABLE IF NOT EXISTS user_api_keys")
    );
  });

  it("does not perform the clean-start reset inside the startup migration", () => {
    const v15 = migrations.slice(migrations.indexOf("version: 15"));
    expect(v15).not.toContain("RESTART IDENTITY CASCADE");
    expect(v15).not.toMatch(/\bDROP\s+TABLE\b/i);
  });
});
