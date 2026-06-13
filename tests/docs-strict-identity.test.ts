import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("strict identity documentation", () => {
  it("documents clean-start profile and repo identity", () => {
    const readme = readFileSync(join(import.meta.dir, "../README.md"), "utf-8");

    expect(readme).toContain("PROFILE_KEYS_FILE");
    expect(readme).toContain("clean-start");
    expect(readme).toContain("profile_id");
    expect(readme).toContain("repo_id");
    expect(readme).not.toContain("client nickname");
  });
});
