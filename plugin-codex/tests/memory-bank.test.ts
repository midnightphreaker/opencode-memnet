import { describe, expect, test } from "bun:test";
import { mergeConfig } from "../src/config";
import { RemoteMemoryClient } from "../src/http-client";

const legacyProfileEnv = ["OPENCODE", "MEMNET", "PROFILE", "ID"].join("_");

describe("Codex v2 Memory Bank contract", () => {
  test("config no longer exposes profileId", () => {
    const config = mergeConfig({}, {}, { [legacyProfileEnv]: "legacy" });
    expect("profileId" in config).toBe(false);
  });

  test("memory requests include X-Memory-Bank-ID", async () => {
    const requests: Request[] = [];
    const client = new RemoteMemoryClient({
      baseUrl: "https://memory.example",
      apiKey: "secret",
      clientId: "codex-client",
      fetcher: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({ success: true, data: { id: "mem-1" } });
      },
    });

    await client.addMemory(
      {
        content: "remember this",
        containerTag: "opencode_project_repo",
        type: "fact",
      },
      { memoryBankId: "bank-1" }
    );

    expect(requests[0]!.headers.get("X-Memory-Bank-ID")).toBe("bank-1");
  });

  test("connect uses ClientConnectResponse without legacy lifecycle fields", async () => {
    const requests: Request[] = [];
    const client = new RemoteMemoryClient({
      baseUrl: "https://memory.example",
      apiKey: "secret",
      clientId: "codex-client",
      fetcher: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({
          success: true,
          data: {
            principal: {
              kind: "user-api-key",
              apiKeyId: "key-1",
              apiKeyName: "opencode",
              apiKeyDescription: "OpenCode agent memory access",
            },
            memoryBanks: [],
            requiresMemoryBank: true,
          },
        });
      },
    });

    const response = await client.clientConnect({ includeStats: false });

    expect(response.data?.requiresMemoryBank).toBe(true);
    expect(JSON.stringify(response)).not.toContain("profileId");
    expect(JSON.stringify(response)).not.toContain("firstTime");
    expect(await requests[0]!.json()).toMatchObject({ includeStats: false });
  });
});
