import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("strict cut removes nickname identity APIs", () => {
  it("web server no longer exposes nickname endpoints", () => {
    const source = readFileSync(join(import.meta.dir, "../src/services/web-server.ts"), "utf-8");
    expect(source).not.toContain("/api/client/nickname");
    expect(source).not.toContain("/api/user-profile/nickname");
  });

  it("api handlers no longer export nickname handlers", () => {
    const source = readFileSync(join(import.meta.dir, "../src/services/api-handlers.ts"), "utf-8");
    expect(source).not.toContain("handleSetClientNickname");
    expect(source).not.toContain("handleSetProfileNickname");
  });
});
