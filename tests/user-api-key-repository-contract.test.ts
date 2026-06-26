import { describe, expect, it, mock } from "bun:test";

const executed: { strings: string; values: unknown[] }[] = [];

function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  executed.push({ strings: strings.join("?"), values });
  const query = strings.join("?");
  if (query.includes("RETURNING id")) {
    return Promise.resolve([
      {
        id: values[0],
        name: values[1],
        description: values[2],
        api_key_hash: values[3],
        created_at: new Date("2026-06-26T00:00:00.000Z"),
        updated_at: new Date("2026-06-26T00:00:00.000Z"),
        last_used_at: null,
        revoked_at: null,
      },
    ]);
  }
  if (query.includes("SELECT id, name, description, api_key_hash")) {
    return Promise.resolve([
      {
        id: "key-1",
        name: "opencode",
        description: "OpenCode agent memory access",
        api_key_hash: values[0],
        created_at: new Date("2026-06-26T00:00:00.000Z"),
        updated_at: new Date("2026-06-26T00:00:00.000Z"),
        last_used_at: null,
        revoked_at: null,
      },
    ]);
  }
  return Promise.resolve([]);
}

mock.module("../src/services/storage/postgres/client.js", () => ({
  getPostgresClient: () => sql,
}));

const { PostgresUserApiKeyRepository, hashUserApiKey } =
  await import("../src/services/storage/postgres/user-api-key-repository.js?contract");

describe("PostgresUserApiKeyRepository", () => {
  it("stores only the hashed user API key value", async () => {
    executed.length = 0;
    const repo = new PostgresUserApiKeyRepository();
    const row = await repo.create({
      id: "key-1",
      name: "opencode",
      description: "OpenCode agent memory access",
      apiKeyValue: "omnu_secret-value",
    });

    expect(row.name).toBe("opencode");
    expect(JSON.stringify(executed)).not.toContain("omnu_secret-value");
    expect(executed[0]!.values).toContain(hashUserApiKey("omnu_secret-value"));
  });

  it("finds non-revoked keys by hash", async () => {
    executed.length = 0;
    const repo = new PostgresUserApiKeyRepository();
    const row = await repo.findByApiKey("omnu_secret-value");

    expect(row).toEqual({
      id: "key-1",
      name: "opencode",
      description: "OpenCode agent memory access",
      apiKeyHash: hashUserApiKey("omnu_secret-value"),
      createdAt: new Date("2026-06-26T00:00:00.000Z").getTime(),
      updatedAt: new Date("2026-06-26T00:00:00.000Z").getTime(),
      lastUsedAt: null,
      revokedAt: null,
    });
    expect(executed[0]!.strings).toContain("revoked_at IS NULL");
  });
});
