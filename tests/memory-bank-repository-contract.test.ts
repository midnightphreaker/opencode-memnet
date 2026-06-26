import { describe, expect, it, mock } from "bun:test";

const executed: { strings: string; values: unknown[] }[] = [];

function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  executed.push({ strings: strings.join("?"), values });
  const query = strings.join("?");
  if (query.includes("RETURNING id")) {
    return Promise.resolve([
      {
        id: values[0],
        api_key_id: values[1],
        name: values[2],
        description: values[3],
        created_at: new Date("2026-06-26T00:00:00.000Z"),
        updated_at: new Date("2026-06-26T00:00:00.000Z"),
      },
    ]);
  }
  if (query.includes("FROM memory_banks")) {
    return Promise.resolve([
      {
        id: "bank-1",
        api_key_id: "key-1",
        api_key_name: "opencode",
        name: "vllm-setup",
        description: "Work done on vllm-setup repo",
        created_at: new Date("2026-06-26T00:00:00.000Z"),
        updated_at: new Date("2026-06-26T00:00:00.000Z"),
      },
    ]);
  }
  if (query.includes("FROM user_api_keys")) {
    return Promise.resolve([{ name: "opencode" }]);
  }
  return Promise.resolve([]);
}

mock.module("../src/services/storage/postgres/client.js", () => ({
  getPostgresClient: () => sql,
}));

const { PostgresMemoryBankRepository } =
  await import("../src/services/storage/postgres/memory-bank-repository.js?contract");

describe("PostgresMemoryBankRepository", () => {
  it("creates banks under a user API key", async () => {
    executed.length = 0;
    const repo = new PostgresMemoryBankRepository();
    const row = await repo.create({
      id: "bank-1",
      apiKeyId: "key-1",
      name: "vllm-setup",
      description: "Work done on vllm-setup repo",
    });

    expect(row.shortcut).toBe("opencode>vllm-setup");
    expect(executed[0]!.strings).toContain("INSERT INTO memory_banks");
    expect(executed[0]!.values).toEqual([
      "bank-1",
      "key-1",
      "vllm-setup",
      "Work done on vllm-setup repo",
    ]);
  });

  it("lists banks for one API key only", async () => {
    executed.length = 0;
    const repo = new PostgresMemoryBankRepository();
    const rows = await repo.listForApiKey("key-1");

    expect(rows[0]!.apiKeyId).toBe("key-1");
    expect(rows[0]!.shortcut).toBe("opencode>vllm-setup");
    expect(executed[0]!.strings).toContain("WHERE b.api_key_id = ?");
  });
});
