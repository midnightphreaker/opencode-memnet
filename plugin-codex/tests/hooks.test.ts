import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeConfig } from "../src/config";
import { parseHookPayload } from "../src/hooks/payload";
import { runHook } from "../src/hooks/runner";

interface RecordedRequest {
  url: URL;
  method: string;
  body?: unknown;
}

function tempProject() {
  const cwd = mkdtempSync(join(tmpdir(), "codex-hook-"));
  return cwd;
}

function cleanup(cwd: string) {
  rmSync(cwd, { recursive: true, force: true });
}

function writeProjectConfig(cwd: string, options: { captureEnabled?: boolean } = {}) {
  mkdirSync(join(cwd, ".codex"), { recursive: true });
  writeFileSync(
    join(cwd, ".codex", "opencode-memnet.jsonc"),
    JSON.stringify({
      serverUrl: "http://server.test",
      apiKey: "test-api-key",
      profileId: "profile-1",
      capture: { enabled: options.captureEnabled ?? true },
    })
  );
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

function createFailingRecorder(failPath: string) {
  const requests: RecordedRequest[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push({
      url: new URL(request.url),
      method: request.method,
      body: request.body ? await request.json() : undefined,
    });
    if (new URL(request.url).pathname === failPath) {
      return Response.json({ success: false, error: "server rejected" });
    }
    return Response.json({ success: true, data: { ok: true } });
  };
  return { requests, fetcher };
}

describe("parseHookPayload", () => {
  test("tolerates empty stdin", () => {
    expect(parseHookPayload("")).toEqual({});
  });

  test("extracts prompt and session id from common shapes", () => {
    const payload = parseHookPayload(JSON.stringify({ session_id: "s1", prompt: "hello" }));

    expect(payload.sessionID).toBe("s1");
    expect(payload.prompt).toBe("hello");
  });

  test("tolerates malformed JSON", () => {
    expect(parseHookPayload("{not json")).toEqual({});
  });

  test("extracts common hook event and cwd names", () => {
    expect(parseHookPayload(JSON.stringify({ event: "SessionStart" }))).toMatchObject({
      event: "SessionStart",
    });
    expect(parseHookPayload(JSON.stringify({ hook_event: "UserPromptSubmit" })).event).toBe(
      "UserPromptSubmit"
    );
    expect(
      parseHookPayload(JSON.stringify({ type: "Stop", working_directory: "/work" }))
    ).toMatchObject({
      event: "Stop",
      cwd: "/work",
    });
  });

  test("extracts nested session and prompt shapes", () => {
    const payload = parseHookPayload(
      JSON.stringify({
        session: { id: "nested-session" },
        user_prompt: "remember this",
      })
    );

    expect(payload.sessionID).toBe("nested-session");
    expect(payload.prompt).toBe("remember this");
  });
});

describe("runHook", () => {
  test("missing config returns without fetching", async () => {
    const cwd = tempProject();
    let calls = 0;

    try {
      const result = await runHook(JSON.stringify({ prompt: "hello" }), {
        cwd,
        clientId: "client-1",
        fetcher: async () => {
          calls += 1;
          return Response.json({ success: true });
        },
        loadConfig: () => mergeConfig({}, {}, {}),
      });

      expect(result).toEqual({ success: true, captured: false, reason: "missing-config" });
      expect(calls).toBe(0);
    } finally {
      cleanup(cwd);
    }
  });

  test("connects and captures prompt with stripped private blocks and strict scope", async () => {
    const cwd = tempProject();
    writeProjectConfig(cwd);
    const { requests, fetcher } = createRecorder();

    try {
      const result = await runHook(
        JSON.stringify({
          hook_event: "UserPromptSubmit",
          session_id: "session-1",
          prompt: "keep <private>secret-token</private> visible",
        }),
        { cwd, clientId: "client-1", fetcher }
      );

      expect(result).toEqual({ success: true, captured: true });
      expect(requests.map((request) => request.url.pathname)).toEqual([
        "/api/client/connect",
        "/api/memories",
      ]);

      expect(requests[0].body).toMatchObject({
        clientId: "client-1",
        profileId: "profile-1",
        metadata: {
          client: "codex",
          runtime: "codex-cli",
          projectTag: expect.any(String),
          repoId: expect.any(String),
          projectName: expect.any(String),
        },
      });

      const connectMetadata = (requests[0].body as { metadata: Record<string, unknown> }).metadata;
      expect("cwd" in connectMetadata).toBe(false);
      expect("projectPath" in connectMetadata).toBe(false);
      expect("userEmail" in connectMetadata).toBe(false);
      expect("userName" in connectMetadata).toBe(false);

      const body = requests[1].body as Record<string, unknown>;
      const containerTag = body.containerTag;
      const repoId = body.repoId;
      expect(body).toMatchObject({
        content: "keep  visible",
        containerTag: expect.any(String),
        type: "codex-hook",
        source: "codex-hook",
        hookEvent: "UserPromptSubmit",
        sessionID: "session-1",
        profileId: "profile-1",
        repoId: expect.any(String),
        projectTag: expect.any(String),
        projectName: expect.any(String),
      });
      expect(repoId).toMatch(/^repo_/);
      expect(repoId).not.toBe(containerTag);
      expect(body.gitRepoUrl === undefined || typeof body.gitRepoUrl === "string").toBe(true);
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect("userId" in body).toBe(false);
      expect("userEmail" in body).toBe(false);
      expect("userName" in body).toBe(false);
      expect("projectPath" in body).toBe(false);
    } finally {
      cleanup(cwd);
    }
  });

  test("fully private prompts connect but skip memory capture", async () => {
    const cwd = tempProject();
    writeProjectConfig(cwd);
    const { requests, fetcher } = createRecorder();

    try {
      const result = await runHook(JSON.stringify({ prompt: "<private>secret-token</private>" }), {
        cwd,
        clientId: "client-1",
        fetcher,
      });

      expect(result).toEqual({ success: true, captured: false, reason: "private-prompt" });
      expect(requests).toHaveLength(1);
      expect(requests[0].url.pathname).toBe("/api/client/connect");
      expect(JSON.stringify(requests[0].body)).not.toContain("secret-token");
    } finally {
      cleanup(cwd);
    }
  });

  test("capture disabled still connects but does not write memory", async () => {
    const cwd = tempProject();
    writeProjectConfig(cwd, { captureEnabled: false });
    const { requests, fetcher } = createRecorder();

    try {
      const result = await runHook(JSON.stringify({ prompt: "remember this" }), {
        cwd,
        clientId: "client-1",
        fetcher,
      });

      expect(result).toEqual({ success: true, captured: false, reason: "capture-disabled" });
      expect(requests).toHaveLength(1);
      expect(requests[0].url.pathname).toBe("/api/client/connect");
    } finally {
      cleanup(cwd);
    }
  });

  test("connect failure is non-blocking and skips memory write", async () => {
    const cwd = tempProject();
    writeProjectConfig(cwd);
    const { requests, fetcher } = createFailingRecorder("/api/client/connect");

    try {
      const result = await runHook(JSON.stringify({ prompt: "remember this" }), {
        cwd,
        clientId: "client-1",
        fetcher,
      });

      expect(result).toEqual({ success: true, captured: false, reason: "connect-failed" });
      expect(requests.map((request) => request.url.pathname)).toEqual(["/api/client/connect"]);
    } finally {
      cleanup(cwd);
    }
  });

  test("memory write failure is non-blocking after connect succeeds", async () => {
    const cwd = tempProject();
    writeProjectConfig(cwd);
    const { requests, fetcher } = createFailingRecorder("/api/memories");

    try {
      const result = await runHook(JSON.stringify({ prompt: "remember this" }), {
        cwd,
        clientId: "client-1",
        fetcher,
      });

      expect(result).toEqual({ success: true, captured: false, reason: "memory-write-failed" });
      expect(requests.map((request) => request.url.pathname)).toEqual([
        "/api/client/connect",
        "/api/memories",
      ]);
    } finally {
      cleanup(cwd);
    }
  });
});
