import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(import.meta.dir, "..", path), "utf-8");
const legacyNewUserKey = ["NEWUSER", "API", "KEY"].join("_");
const legacyProfileKeysFile = ["PROFILE", "KEYS", "FILE"].join("_");

describe("v2 auth and docker documentation", () => {
  it("documents required server key, clean-start backup, and Memory Banks", () => {
    const readme = read("README.md");
    const env = read(".env.example");

    expect(readme).toContain("SERVER_API_KEY is required");
    expect(readme).toContain("pg_dump");
    expect(readme).toContain("pg_restore --list");
    expect(readme).toContain("There is no v1-to-v2 upgrade");
    expect(readme).toContain("shown once");
    expect(readme).toContain("<api-key-name>><memory-bank-name>");
    expect(env).toContain("SERVER_API_KEY=");
    expect(env).not.toContain(legacyNewUserKey);
    expect(env).not.toContain(legacyProfileKeysFile);
  });

  it("passes only SERVER_API_KEY for compose server auth", () => {
    const compose = read("docker-compose.yml");
    const externalCompose = read("docker-compose.external-db.yml");

    expect(compose).toContain("SERVER_API_KEY: ${SERVER_API_KEY:-}");
    expect(externalCompose).toContain("SERVER_API_KEY: ${SERVER_API_KEY:-}");
    expect(compose).not.toContain(legacyNewUserKey);
    expect(compose).not.toContain(legacyProfileKeysFile);
    expect(externalCompose).not.toContain(legacyNewUserKey);
    expect(externalCompose).not.toContain(legacyProfileKeysFile);
  });
});
