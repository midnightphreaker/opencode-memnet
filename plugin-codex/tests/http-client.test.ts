import { describe, expect, test } from "bun:test";
import { RemoteMemoryClient } from "../src/http-client";

describe("RemoteMemoryClient", () => {
  test("sends auth and client headers to client connect", async () => {
    const requests: Request[] = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return Response.json({
        success: true,
        data: {
          firstTime: true,
          welcomeBack: false,
          daysSinceLastSeen: null,
          stats: null,
        },
      });
    };

    const client = new RemoteMemoryClient({
      baseUrl: "http://server.test/",
      apiKey: "secret",
      clientId: "client-123",
      fetcher,
    });

    await client.clientConnect({ client: "codex" });

    expect(requests).toHaveLength(1);
    expect(requests[0].headers.get("Content-Type")).toBe("application/json");
    expect(requests[0].headers.get("Authorization")).toBe("Bearer secret");
    expect(requests[0].headers.get("X-Client-ID")).toBe("client-123");
    expect(new URL(requests[0].url).pathname).toBe("/api/client/connect");
  });

  test("does not expose unsupported client nickname route", () => {
    const client = new RemoteMemoryClient({
      baseUrl: "http://server.test",
      apiKey: "secret",
      clientId: "client-123",
      fetcher: async () => Response.json({ success: true }),
    });

    expect("setClientNickname" in client).toBe(false);
  });

  test("builds memory query strings without undefined values", async () => {
    const requests: Request[] = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return Response.json({ success: true, data: { items: [] } });
    };
    const client = new RemoteMemoryClient({
      baseUrl: "http://server.test///",
      apiKey: "secret",
      clientId: "client-123",
      fetcher,
    });

    await client.listMemories({
      tag: "project-tag",
      pageSize: 10,
      profileId: "profile-1",
      repoId: undefined,
    });

    const url = new URL(requests[0].url);
    expect(url.origin).toBe("http://server.test");
    expect(url.pathname).toBe("/api/memories");
    expect(url.searchParams.get("tag")).toBe("project-tag");
    expect(url.searchParams.get("pageSize")).toBe("10");
    expect(url.searchParams.get("profileId")).toBe("profile-1");
    expect(url.searchParams.has("repoId")).toBe(false);
  });

  test("sanitizes HTTP errors and DELETE memory ids", async () => {
    const requests: Request[] = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return Response.json({ success: false, error: "server rejected request" }, { status: 500 });
    };
    const client = new RemoteMemoryClient({
      baseUrl: "http://server.test",
      apiKey: "secret-api-key",
      clientId: "client-123",
      fetcher,
    });

    const result = await client.deleteMemory("mem_123_abc");

    expect(new URL(requests[0].url).pathname).toBe("/api/memories/mem_123_abc");
    expect(result).toEqual({ success: false, error: "server rejected request" });
    expect(result.error).not.toContain("secret-api-key");
  });

  test("returns sanitized failure for malformed JSON responses", async () => {
    const client = new RemoteMemoryClient({
      baseUrl: "http://server.test",
      apiKey: "secret-api-key",
      clientId: "client-123",
      fetcher: async () =>
        new Response("not json secret-api-key", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });

    const result = await client.getClientStats();

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid JSON response");
    expect(result.error).not.toContain("secret-api-key");
  });

  test("returns timeout failure when the request aborts", async () => {
    const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    const client = new RemoteMemoryClient({
      baseUrl: "http://server.test",
      apiKey: "secret",
      clientId: "client-123",
      timeoutMs: 1,
      fetcher,
    });

    const result = await client.getClientStats();

    expect(result).toEqual({ success: false, error: "Request timed out after 1ms" });
  });
});
