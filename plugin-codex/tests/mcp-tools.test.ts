import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CodexMemnetConfig } from "../src/config";
import { createToolHandlers } from "../src/mcp/tools";

const baseConfig: CodexMemnetConfig = {
  serverUrl: "http://server.test",
  apiKey: "secret-api-key",
  nickname: "Configured Name",
  timeoutMs: 30_000,
  memory: { defaultScope: "project" },
  context: { maxMemories: 5, maxAgeDays: null, excludeCurrentSession: true },
  capture: { enabled: true, includeRawHookPayload: false },
};

interface RecordedRequest {
  url: URL;
  method: string;
  headers: Headers;
  body?: unknown;
}

function connectData(memoryBanks = [memoryBank()]) {
  return {
    principal: {
      kind: "user-api-key",
      apiKeyId: "key-1",
      apiKeyName: "opencode",
      apiKeyDescription: "OpenCode agent memory access",
    },
    memoryBanks,
    requiresMemoryBank: memoryBanks.length === 0,
  };
}

function memoryBank(id = "bank-1") {
  return {
    id,
    apiKeyId: "key-1",
    name: id === "bank-1" ? "project" : "other-project",
    description: `Work done on ${id}`,
    shortcut: `opencode>${id}`,
    createdAt: "2026-06-26T00:00:00.000Z",
    updatedAt: "2026-06-26T00:00:00.000Z",
  };
}

function createRecorder(options: { memoryBanks?: ReturnType<typeof memoryBank>[] } = {}) {
  const requests: RecordedRequest[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    requests.push({
      url,
      method: request.method,
      headers: request.headers,
      body: request.body ? await request.json() : undefined,
    });
    if (url.pathname === "/api/client/connect") {
      return Response.json({ success: true, data: connectData(options.memoryBanks) });
    }
    return Response.json({ success: true, data: { ok: true } });
  };
  return { requests, fetcher };
}

function createHandlers(
  options: {
    config?: CodexMemnetConfig;
    fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  } = {}
) {
  const cwd = mkdtempSync(join(tmpdir(), "codex-mcp-tools-"));
  const handlers = createToolHandlers({
    cwd,
    config: options.config ?? baseConfig,
    clientId: "client-123",
    fetcher: options.fetcher ?? (async () => Response.json({ success: true, data: connectData() })),
  });
  return { cwd, handlers };
}

function cleanup(cwd: string) {
  rmSync(cwd, { recursive: true, force: true });
}

describe("MCP tool handlers", () => {
  test("missing config returns clear failure without fetch", async () => {
    let calls = 0;
    const { cwd, handlers } = createHandlers({
      config: { ...baseConfig, serverUrl: "" },
      fetcher: async () => {
        calls += 1;
        return Response.json({ success: true });
      },
    });

    try {
      const result = await handlers.memory_stats();

      expect(result.success).toBe(false);
      expect(result.error).toBe("Missing serverUrl");
      expect(calls).toBe(0);
    } finally {
      cleanup(cwd);
    }
  });

  test("memory_connect posts v2 connect body and suggests a bank when none exists", async () => {
    const { requests, fetcher } = createRecorder({ memoryBanks: [] });
    const { cwd, handlers } = createHandlers({ fetcher });

    try {
      const result = await handlers.memory_connect();

      expect(result.success).toBe(true);
      expect(requests[0].method).toBe("POST");
      expect(requests[0].url.pathname).toBe("/api/client/connect");
      expect(requests[0].body).toMatchObject({
        clientId: "client-123",
        includeStats: false,
        metadata: {
          client: "codex",
          runtime: "codex-cli",
          nickname: "Configured Name",
          repoId: expect.any(String),
          projectTag: expect.any(String),
          projectName: expect.any(String),
        },
      });
      expect(JSON.stringify(requests[0].body)).not.toContain("profileId");
      expect(JSON.stringify(result)).toContain("suggestedMemoryBank");
      expect(JSON.stringify(result)).not.toContain(baseConfig.apiKey);
    } finally {
      cleanup(cwd);
    }
  });

  test("memory operations fail with exact message when no bank is active", async () => {
    const { fetcher } = createRecorder({ memoryBanks: [] });
    const { cwd, handlers } = createHandlers({ fetcher });

    try {
      const result = await handlers.memory_search({ query: "identity" });

      expect(result).toEqual({
        success: false,
        error: "No active Memory Bank. Create one before using memory operations.",
      });
      expect(JSON.stringify(result)).not.toContain(baseConfig.apiKey);
    } finally {
      cleanup(cwd);
    }
  });

  test("memory operations use configured Memory Bank when multiple banks are available", async () => {
    const { requests, fetcher } = createRecorder({
      memoryBanks: [memoryBank("bank-1"), memoryBank("bank-2")],
    });
    const { cwd, handlers } = createHandlers({
      fetcher,
      config: { ...baseConfig, memoryBankId: "bank-2" },
    });

    try {
      const result = await handlers.memory_add({ content: "remember configured bank" });

      expect(result.success).toBe(true);
      expect(requests[1].headers.get("X-Memory-Bank-ID")).toBe("bank-2");
    } finally {
      cleanup(cwd);
    }
  });

  test("memory operations fail when configured Memory Bank is unavailable", async () => {
    const { fetcher } = createRecorder({
      memoryBanks: [memoryBank("bank-1")],
    });
    const { cwd, handlers } = createHandlers({
      fetcher,
      config: { ...baseConfig, memoryBankId: "missing-bank" },
    });

    try {
      const result = await handlers.memory_add({ content: "remember configured bank" });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Configured Memory Bank");
    } finally {
      cleanup(cwd);
    }
  });

  test("memory_get_context posts repo scope with Memory Bank header", async () => {
    const { requests, fetcher } = createRecorder();
    const { cwd, handlers } = createHandlers({ fetcher });

    try {
      const result = await handlers.memory_get_context({ sessionID: "session-1", maxMemories: 7 });

      expect(result.success).toBe(true);
      expect(requests.map((request) => request.url.pathname)).toEqual([
        "/api/client/connect",
        "/api/context/inject",
      ]);
      expect(requests[1].headers.get("X-Memory-Bank-ID")).toBe("bank-1");
      expect(requests[1].body).toMatchObject({
        sessionID: "session-1",
        projectTag: expect.any(String),
        repoId: expect.any(String),
        maxMemories: 7,
      });
      expect(JSON.stringify(requests[1].body)).not.toContain("profileId");
      expect("query" in (requests[1].body as Record<string, unknown>)).toBe(false);
    } finally {
      cleanup(cwd);
    }
  });

  test("memory_add strips private blocks and sends Memory Bank header", async () => {
    const { requests, fetcher } = createRecorder();
    const { cwd, handlers } = createHandlers({ fetcher });

    try {
      const result = await handlers.memory_add({
        content: "keep <private>secret</private> visible",
        type: "note",
        tags: ["important"],
      });

      expect(result.success).toBe(true);
      expect(requests[1].url.pathname).toBe("/api/memories");
      expect(requests[1].headers.get("X-Memory-Bank-ID")).toBe("bank-1");
      const body = requests[1].body as Record<string, unknown>;
      expect(body).toMatchObject({
        content: "keep  visible",
        containerTag: expect.any(String),
        type: "note",
        tags: ["important"],
        repoId: expect.any(String),
        projectName: expect.any(String),
      });
      expect(JSON.stringify(body)).not.toContain("profileId");
      expect(JSON.stringify(body)).not.toContain("secret");
    } finally {
      cleanup(cwd);
    }
  });

  test("memory_add rejects fully private content without fetch", async () => {
    let calls = 0;
    const { cwd, handlers } = createHandlers({
      fetcher: async () => {
        calls += 1;
        return Response.json({ success: true });
      },
    });

    try {
      const result = await handlers.memory_add({ content: "<private>secret</private>" });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Private content blocked");
      expect(calls).toBe(0);
    } finally {
      cleanup(cwd);
    }
  });

  test("memory_search and memory_list include bank headers and no profile query", async () => {
    const { requests, fetcher } = createRecorder();
    const { cwd, handlers } = createHandlers({ fetcher });

    try {
      await handlers.memory_search({ query: "identity", limit: 3 });
      await handlers.memory_list({ limit: 4 });

      expect(requests.map((request) => request.url.pathname)).toEqual([
        "/api/client/connect",
        "/api/search",
        "/api/memories",
      ]);
      expect(requests[1].url.pathname).toBe("/api/search");
      expect(requests[1].headers.get("X-Memory-Bank-ID")).toBe("bank-1");
      expect(requests[1].url.searchParams.get("q")).toBe("identity");
      expect(requests[1].url.searchParams.get("pageSize")).toBe("3");
      expect(requests[1].url.searchParams.has("profileId")).toBe(false);

      expect(requests[2].url.pathname).toBe("/api/memories");
      expect(requests[2].headers.get("X-Memory-Bank-ID")).toBe("bank-1");
      expect(requests[2].url.searchParams.get("pageSize")).toBe("4");
      expect(requests[2].url.searchParams.has("profileId")).toBe(false);
    } finally {
      cleanup(cwd);
    }
  });

  test("memory_forget deletes the encoded memory path with bank header", async () => {
    const { requests, fetcher } = createRecorder();
    const { cwd, handlers } = createHandlers({ fetcher });

    try {
      const result = await handlers.memory_forget({ memoryId: "memory/1" });

      expect(result.success).toBe(true);
      expect(requests[1].method).toBe("DELETE");
      expect(requests[1].url.pathname).toBe("/api/memories/memory%2F1");
      expect(requests[1].headers.get("X-Memory-Bank-ID")).toBe("bank-1");
    } finally {
      cleanup(cwd);
    }
  });

  test("memory_profile reports bank state without user profile request", async () => {
    const { requests, fetcher } = createRecorder();
    const { cwd, handlers } = createHandlers({ fetcher });

    try {
      const result = await handlers.memory_profile();

      expect(result.success).toBe(true);
      expect(requests.map((request) => request.url.pathname)).toEqual(["/api/client/connect"]);
      if (result.success) {
        expect(result.data).toMatchObject({
          activeMemoryBank: { id: "bank-1" },
          requiresMemoryBank: false,
        });
      }
    } finally {
      cleanup(cwd);
    }
  });

  test("memory_stats requests scoped stats for the active bank", async () => {
    const { requests, fetcher } = createRecorder();
    const { cwd, handlers } = createHandlers({ fetcher });

    try {
      const result = await handlers.memory_stats();

      expect(result.success).toBe(true);
      expect(requests.map((request) => request.url.pathname)).toEqual([
        "/api/client/connect",
        "/api/client/connect",
      ]);
      expect(requests[1].body).toMatchObject({
        includeStats: true,
        memoryBankId: "bank-1",
      });
    } finally {
      cleanup(cwd);
    }
  });

  test("memory_set_nickname returns unsupported and makes no request", async () => {
    let calls = 0;
    const { cwd, handlers } = createHandlers({
      fetcher: async () => {
        calls += 1;
        return Response.json({ success: true });
      },
    });

    try {
      const result = await handlers.memory_set_nickname({ nickname: "New Name" });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not supported");
      expect(calls).toBe(0);
    } finally {
      cleanup(cwd);
    }
  });

  test("memory_capture fallback stores manual memory with bank header", async () => {
    const { requests, fetcher } = createRecorder();
    const { cwd, handlers } = createHandlers({ fetcher });

    try {
      const result = await handlers.memory_capture({
        summary: "Useful summary",
        sessionID: "session-1",
      });

      expect(result.success).toBe(true);
      expect(requests[1].url.pathname).toBe("/api/memories");
      expect(requests[1].headers.get("X-Memory-Bank-ID")).toBe("bank-1");
      expect(requests[1].body).toMatchObject({
        content: "Useful summary",
        source: "codex-mcp",
        sessionID: "session-1",
        repoId: expect.any(String),
      });
      expect(JSON.stringify(requests[1].body)).not.toContain("profileId");
    } finally {
      cleanup(cwd);
    }
  });

  test("memory_capture uses auto-capture when conversation data is present", async () => {
    const { requests, fetcher } = createRecorder();
    const { cwd, handlers } = createHandlers({ fetcher });

    try {
      const result = await handlers.memory_capture({
        summary: "Summary",
        sessionID: "session-1",
        conversationMessages: [{ role: "user", content: "remember this" }],
        userPrompt: "remember this",
        promptMessageId: "prompt-1",
      });

      expect(result.success).toBe(true);
      expect(requests[1].url.pathname).toBe("/api/auto-capture");
      expect(requests[1].headers.get("X-Memory-Bank-ID")).toBe("bank-1");
      expect(requests[1].body).toMatchObject({
        sessionID: "session-1",
        projectTag: expect.any(String),
        repoId: expect.any(String),
        conversationMessages: [{ role: "user", content: "remember this" }],
        userPrompt: "remember this",
        promptMessageId: "prompt-1",
      });
      expect(JSON.stringify(requests[1].body)).not.toContain("profileId");
    } finally {
      cleanup(cwd);
    }
  });
});
