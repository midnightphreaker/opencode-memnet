import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(import.meta.dir, "..", path), "utf-8");

describe("auth and docker documentation", () => {
  it("documents API-key-required auth without auth-disabled modes", () => {
    const readme = read("README.md");
    const env = read(".env.example");

    expect(readme).toContain("SERVER_API_KEY");
    expect(readme).toContain("admin/all-profiles");
    expect(readme).not.toContain("DISABLE_WEBUI_AUTH");
    expect(readme).not.toContain("DISABLE_CLIENT_AUTH");
    expect(env).not.toContain("DISABLE_WEBUI_AUTH");
    expect(env).not.toContain("DISABLE_CLIENT_AUTH");
  });

  it("uses a compose-safe localhost bind address", () => {
    const readme = read("README.md");
    const env = read(".env.example");
    const compose = read("docker-compose.yml");
    const externalCompose = read("docker-compose.external-db.yml");

    expect(readme).toContain("`EXTERNAL_HOST`");
    expect(readme).toContain("`127.0.0.1`");
    expect(env).toContain("EXTERNAL_HOST=127.0.0.1");
    expect(compose).toContain("${EXTERNAL_HOST:-127.0.0.1}");
    expect(externalCompose).toContain("${EXTERNAL_HOST:-127.0.0.1}");
    expect(compose).not.toContain("${EXTERNAL_HOST:-localhost}");
    expect(externalCompose).not.toContain("${EXTERNAL_HOST:-localhost}");
  });

  it("documents and mounts profile-key secrets for docker", () => {
    const readme = read("README.md");
    const env = read(".env.example");
    const compose = read("docker-compose.yml");
    const externalCompose = read("docker-compose.external-db.yml");

    expect(readme).toContain("./secrets/opencode-memnet-profile-keys.jsonc");
    expect(readme).toContain("PROFILE_KEYS_FILE=/run/secrets/opencode-memnet-profile-keys.jsonc");
    expect(env).toContain("PROFILE_KEYS_FILE=/run/secrets/opencode-memnet-profile-keys.jsonc");
    expect(compose).toContain("./secrets:/run/secrets:ro");
    expect(externalCompose).toContain("./secrets:/run/secrets:ro");
  });
});
