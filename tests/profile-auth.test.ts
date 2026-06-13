import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("learned profile storage identity", () => {
  it("stores learned profiles by profile_id only", () => {
    const source = readFileSync(
      join(import.meta.dir, "../src/services/storage/postgres/profile-repository.ts"),
      "utf-8"
    );
    expect(source).toContain("profile_id");
    expect(source).not.toMatch(/\buser_id\b/);
    expect(source).not.toMatch(/\buser_email\b/);
    expect(source).not.toMatch(/\bnickname\b/);
  });
});
