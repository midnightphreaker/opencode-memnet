import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CodexMemnetConfig } from "../src/config";
import { createToolHandlers } from "../src/mcp/tools";

const baseConfig: CodexMemnetConfig = {
  serverUrl: "http://server.test",
  apiKey: "key",
  profileId: "profile-config-1",
  nickname: "Configured Name",
  timeoutMs: 30_000,
  memory: { defaultScope: "project" },
  context: { maxMemories: 5, maxAgeDays: null, excludeCurrentSession: true },
  capture: { enabled: true, includeRawHookPayload: false },
};

interface RecordedRequest {
  url: URL;
  method: string;
  body?: unknown;
}

function createRecorder() {
  const requests: RecordedRequest[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push({
      url: new URL(request.url),
      method: request.method,
      body: request.body ? await request.json() : undefined,
    });
    return Response.json({ success: true, data: { ok: true } });
  };
  return { requests, fetcher };
}

function createHandlers(options: {
  config?: CodexMemnetConfig;
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
} = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "codex-mcp-tools-"));
  const handlers = createToolHandlers({
    cwd,
    config: options.config ?? baseConfig,
    clientId: "client-123",
    fetcher: options.fetcher ?? (async () => Response.json({ success: true, data: { ok: true } })),
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

  test("memory_connect posts configured profileId and minimal metadata", async () => {
    const { requests, fetcher } = createRecorder();
    const { cwd, handlers } = createHandlers({ fetcher });

    try {
      const result = await handlers.memory_connect();

      expect(result.success).toBe(true);
      expect(requests[0].method).toBe("POST");
      expect(requests[0].url.pathname).toBe("/api/client/connect");
      expect(requests[0].body).toMatchObject({
        clientId: "client-123",
        profileId: "profile-config-1",
        metadata: {
          client: "codex",
          runtime: "codex-cli",
          nickname: "Configured Name",
          repoId: expect.any(String),
          projectTag: expect.any(String),
          projectName: expect.any(String),
        },
      });
      const metadata = (requests[0].body as { metadata: Record<string, unknown> }).metadata;
      expect(metadata.gitRepoUrl === undefined || typeof metadata.gitRepoUrl === "string").toBe(true);
      expect("cwd" in metadata).toBe(false);
      expect("projectPath" in metadata).toBe(false);
      expect("userEmail" in metadata).toBe(false);
      expect("userName" in metadata).toBe(false);
    } finally {
      cleanup(cwd);
    }
  });

  test("memory_get_context posts profileId and repoId without userId or query", async () => {
    const { requests, fetcher } = createRecorder();
    const { cwd, handlers } = createHandlers({ fetcher });

    try {
      const result = await handlers.memory_get_context({ sessionID: "session-1", maxMemories: 7 });

      expect(result.success).toBe(true);
      expect(requests[0].method).toBe("POST");
      expect(requests[0].url.pathname).toBe("/api/context/inject");
      expect(requests[0].body).toMatchObject({
        sessionID: "session-1",
        projectTag: expect.any(String),
        profileId: "profile-config-1",
        repoId: expect.any(String),
        maxMemories: 7,
      });
      expect("userId" in (requests[0].body as Record<string, unknown>)).toBe(false);
      expect("query" in (requests[0].body as Record<string, unknown>)).toBe(false);
    } finally {
      cleanup(cwd);
    }
  });

  test("memory_add strips private blocks and sends only allowed project fields", async () => {
    const { requests, fetcher } = createRecorder();
    const { cwd, handlers } = createHandlers({ fetcher });

    try {
      const result = await handlers.memory_add({
        content: "keep <private>secret</private> visible",
        type: "note",
        tags: ["important"],
      });

      expect(result.success).toBe(true);
      expect(requests[0].method).toBe("POST");
      expect(requests[0].url.pathname).toBe("/api/memories");
      const body = requests[0].body as Record<string, unknown>;
      const containerTag = body.containerTag;
      const repoId = body.repoId;
      expect(requests[0].body).toMatchObject({
        content: "keep  visible",
        containerTag: expect.any(String),
        type: "note",
        tags: ["important"],
        profileId: "profile-config-1",
        repoId: expect.any(String),
        projectName: expect.any(String),
      });
      expect(repoId).toMatch(/^repo_/);
      expect(repoId).not.toBe(containerTag);
      expect(body.gitRepoUrl === undefined || typeof body.gitRepoUrl === "string").toBe(true);
      expect("userId" in body).toBe(false);
      expect("userEmail" in body).toBe(false);
      expect("userName" in body).toBe(false);
      expect("projectPath" in body).toBe(false);
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

  test("memory_search and memory_list include configured scope query params", async () => {
    const { requests, fetcher } = createRecorder();
    const { cwd, handlers } = createHandlers({ fetcher });

    try {
      await handlers.memory_search({ query: "identity", limit: 3 });
      await handlers.memory_list({ limit: 4 });

      expect(requests[0].method).toBe("GET");
      expect(requests[0].url.pathname).toBe("/api/search");
      expect(requests[0].url.searchParams.get("q")).toBe("identity");
      expect(requests[0].url.searchParams.get("pageSize")).toBe("3");
      expect(requests[0].url.searchParams.get("profileId")).toBe("profile-config-1");
      expect(requests[0].url.searchParams.get("repoId")).toMatch(/^repo_/);
      expect(requests[0].url.searchParams.has("userId")).toBe(false);

      expect(requests[1].method).toBe("GET");
      expect(requests[1].url.pathname).toBe("/api/memories");
      expect(requests[1].url.searchParams.get("pageSize")).toBe("4");
      expect(requests[1].url.searchParams.get("profileId")).toBe("profile-config-1");
      expect(requests[1].url.searchParams.get("repoId")).toMatch(/^repo_/);
      expect(requests[1].url.searchParams.has("userId")).toBe(false);
    } finally {
      cleanup(cwd);
    }
  });

  test("memory_forget deletes the encoded memory path", async () => {
    const { requests, fetcher } = createRecorder();
    const { cwd, handlers } = createHandlers({ fetcher });

    try {
      const result = await handlers.memory_forget({ memoryId: "memory/1" });

      expect(result.success).toBe(true);
      expect(requests[0].method).toBe("DELETE");
      expect(requests[0].url.pathname).toBe("/api/memories/memory%2F1");
    } finally {
      cleanup(cwd);
    }
  });

  test("memory_profile uses configured profileId query", async () => {
    const { requests, fetcher } = createRecorder();
    const { cwd, handlers } = createHandlers({ fetcher });

    try {
      const result = await handlers.memory_profile();

      expect(result.success).toBe(true);
      expect(requests[0].method).toBe("GET");
      expect(requests[0].url.pathname).toBe("/api/user-profile");
      expect(requests[0].url.searchParams.get("profileId")).toBe("profile-config-1");
    } finally {
      cleanup(cwd);
    }
  });

  test("memory_stats hits client stats", async () => {
    const { requests, fetcher } = createRecorder();
    const { cwd, handlers } = createHandlers({ fetcher });

    try {
      const result = await handlers.memory_stats();

      expect(result.success).toBe(true);
      expect(requests[0].method).toBe("GET");
      expect(requests[0].url.pathname).toBe("/api/client/stats");
      expect(requests[0].url.searchParams.get("clientId")).toBe("client-123");
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

  test("memory_capture fallback stores manual memory with codex-mcp source", async () => {
    const { requests, fetcher } = createRecorder();
    const { cwd, handlers } = createHandlers({ fetcher });

    try {
      const result = await handlers.memory_capture({ summary: "Useful summary", sessionID: "session-1" });

      expect(result.success).toBe(true);
      expect(requests[0].method).toBe("POST");
      expect(requests[0].url.pathname).toBe("/api/memories");
      expect(requests[0].body).toMatchObject({
        content: "Useful summary",
        source: "codex-mcp",
        sessionID: "session-1",
        profileId: "profile-config-1",
        repoId: expect.any(String),
      });
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
      expect(requests[0].method).toBe("POST");
      expect(requests[0].url.pathname).toBe("/api/auto-capture");
      expect(requests[0].body).toMatchObject({
        sessionID: "session-1",
        projectTag: expect.any(String),
        profileId: "profile-config-1",
        repoId: expect.any(String),
        conversationMessages: [{ role: "user", content: "remember this" }],
        userPrompt: "remember this",
        promptMessageId: "prompt-1",
      });
    } finally {
      cleanup(cwd);
    }
  });
});
