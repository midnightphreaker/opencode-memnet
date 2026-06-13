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

  it("documents profile key file schema and enforcement", () => {
    const readme = readFileSync(join(import.meta.dir, "../README.md"), "utf-8");
    const env = readFileSync(join(import.meta.dir, "../.env.example"), "utf-8");

    expect(readme).toContain('"profiles"');
    expect(readme).toContain('"profileId"');
    expect(readme).toContain('"apiKey"');
    expect(readme).toContain("Profile keys are restricted to their configured profileId");
    expect(readme).toContain("SERVER_API_KEY remains the admin/all-profiles key");
    expect(env).toContain("PROFILE_KEYS_FILE=");
    expect(env).toContain("profileId");
    expect(env).toContain("env://NAME");
    expect(env).toContain("file:///path/to/key");
  });
});
