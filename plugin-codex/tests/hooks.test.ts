import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeConfig } from "../src/config";
import { parseHookPayload } from "../src/hooks/payload";
import { runHook } from "../src/hooks/runner";
import { parseTranscript } from "../src/hooks/transcript";

interface RecordedRequest {
  url: URL;
  method: string;
  headers: Headers;
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
      capture: { enabled: options.captureEnabled ?? true },
    })
  );
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

function memoryBank() {
  return {
    id: "bank-1",
    apiKeyId: "key-1",
    name: "project",
    description: "Work done on project repo",
    shortcut: "opencode>project",
    createdAt: "2026-06-26T00:00:00.000Z",
    updatedAt: "2026-06-26T00:00:00.000Z",
  };
}

function createRecorder(options: { memoryBanks?: ReturnType<typeof memoryBank>[] } = {}) {
  const requests: RecordedRequest[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const pathname = new URL(request.url).pathname;
    requests.push({
      url: new URL(request.url),
      method: request.method,
      headers: request.headers,
      body: request.body ? await request.json() : undefined,
    });
    if (pathname === "/api/client/connect") {
      return Response.json({ success: true, data: connectData(options.memoryBanks) });
    }
    if (pathname === "/api/context/inject") {
      return Response.json({
        success: true,
        data: {
          context: "Existing project memory",
          memories: [{ id: "mem-1" }],
          profileInjected: false,
        },
      });
    }
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
      headers: request.headers,
      body: request.body ? await request.json() : undefined,
    });
    if (new URL(request.url).pathname === failPath) {
      return Response.json({ success: false, error: "server rejected" });
    }
    if (new URL(request.url).pathname === "/api/client/connect") {
      return Response.json({ success: true, data: connectData() });
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
    expect(parseHookPayload(JSON.stringify({ hook_event_name: "SessionStart" }))).toMatchObject({
      event: "SessionStart",
      hookEventName: "SessionStart",
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

  test("extracts official Codex hook fields", () => {
    const payload = parseHookPayload(
      JSON.stringify({
        hook_event_name: "Stop",
        session_id: "session-1",
        transcript_path: "/tmp/transcript.jsonl",
        turn_id: "turn-1",
        source: "compact",
        trigger: "manual",
        last_assistant_message: "done",
        stop_hook_active: true,
      })
    );

    expect(payload).toMatchObject({
      event: "Stop",
      hookEventName: "Stop",
      sessionID: "session-1",
      transcriptPath: "/tmp/transcript.jsonl",
      turnID: "turn-1",
      source: "compact",
      trigger: "manual",
      lastAssistantMessage: "done",
      stopHookActive: true,
    });
  });
});

describe("parseTranscript", () => {
  test("extracts user and assistant text and tool call summaries", () => {
    const transcript = [
      JSON.stringify({
        session_id: "session-1",
        message: {
          role: "user",
          id: "prompt-1",
          parts: [{ type: "text", text: "Build this <private>secret</private>" }],
        },
      }),
      JSON.stringify({
        message: { role: "assistant", parts: [{ type: "reasoning", encrypted: "abc" }] },
      }),
      JSON.stringify({
        message: { role: "assistant", parts: [{ type: "text", text: "Implemented it" }] },
      }),
      JSON.stringify({
        message: {
          role: "assistant",
          parts: [
            {
              type: "tool",
              tool: "Bash",
              state: {
                input: { command: "bun test <private>secret-arg</private>" },
                output: "ignored",
              },
            },
          ],
        },
      }),
      JSON.stringify({
        message: { role: "tool", parts: [{ type: "text", text: "tool output ignored" }] },
      }),
    ].join("\n");

    const result = parseTranscript(transcript);

    expect(result.sessionID).toBe("session-1");
    expect(result.latestUserPrompt).toBe("Build this");
    expect(result.promptMessageId).toBe("prompt-1");
    expect(result.hasAssistantActivity).toBe(true);
    expect(result.messages).toEqual([
      { role: "user", id: "prompt-1", parts: [{ type: "text", text: "Build this" }] },
      { role: "assistant", id: undefined, parts: [{ type: "text", text: "Implemented it" }] },
      {
        role: "assistant",
        id: undefined,
        parts: [{ type: "tool", tool: "Bash", state: { input: { command: "bun test " } } }],
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("secret-arg");
    expect(JSON.stringify(result)).not.toContain("tool output ignored");
    expect(JSON.stringify(result)).not.toContain("encrypted");
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

      expect(result).toEqual({ success: true, action: "skipped", reason: "missing-config" });
      expect(calls).toBe(0);
    } finally {
      cleanup(cwd);
    }
  });

  test("SessionStart connects and returns additional context", async () => {
    const cwd = tempProject();
    writeProjectConfig(cwd);
    const { requests, fetcher } = createRecorder();

    try {
      const result = await runHook(
        JSON.stringify({
          hook_event_name: "SessionStart",
          session_id: "session-1",
        }),
        { cwd, clientId: "client-1", fetcher }
      );

      expect(result).toEqual({
        success: true,
        action: "context",
        output: {
          hookSpecificOutput: {
            hookEventName: "SessionStart",
            additionalContext: "Existing project memory",
          },
        },
      });
      expect(requests.map((request) => request.url.pathname)).toEqual([
        "/api/client/connect",
        "/api/context/inject",
      ]);

      expect(requests[0].body).toMatchObject({
        clientId: "client-1",
        includeStats: false,
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
      expect(JSON.stringify(requests[0].body)).not.toContain("profileId");

      const body = requests[1].body as Record<string, unknown>;
      const repoId = body.repoId;
      expect(requests[1].headers.get("X-Memory-Bank-ID")).toBe("bank-1");
      expect(body).toMatchObject({
        sessionID: "session-1",
        projectTag: expect.any(String),
        repoId: expect.any(String),
        maxMemories: 5,
        excludeCurrentSession: true,
        maxAgeDays: null,
      });
      expect(repoId).toMatch(/^repo_/);
      expect(JSON.stringify(body)).not.toContain("profileId");
    } finally {
      cleanup(cwd);
    }
  });

  test("no-bank startup skips context and capture with missing-memory-bank", async () => {
    const cwd = tempProject();
    writeProjectConfig(cwd);
    const transcriptPath = join(cwd, "transcript.jsonl");
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({
          session_id: "session-1",
          message: {
            role: "user",
            id: "prompt-1",
            parts: [{ type: "text", text: "remember this" }],
          },
        }),
        JSON.stringify({ message: { role: "assistant", parts: [{ type: "text", text: "Done" }] } }),
      ].join("\n")
    );
    const { requests, fetcher } = createRecorder({ memoryBanks: [] });

    try {
      const sessionStart = await runHook(
        JSON.stringify({
          hook_event_name: "SessionStart",
          session_id: "session-1",
        }),
        { cwd, clientId: "client-1", fetcher }
      );
      const stop = await runHook(
        JSON.stringify({
          hook_event_name: "Stop",
          session_id: "session-1",
          transcript_path: transcriptPath,
        }),
        { cwd, clientId: "client-1", fetcher }
      );

      expect(sessionStart).toEqual({
        success: true,
        action: "skipped",
        reason: "missing-memory-bank",
      });
      expect(stop).toEqual({ success: true, action: "skipped", reason: "missing-memory-bank" });
      expect(requests.map((request) => request.url.pathname)).toEqual([
        "/api/client/connect",
        "/api/client/connect",
      ]);
      expect(requests[0].body).toMatchObject({ includeStats: false });
      expect(requests[1].body).toMatchObject({ includeStats: false });
      expect(JSON.stringify(sessionStart)).not.toContain("test-api-key");
      expect(JSON.stringify(stop)).not.toContain("test-api-key");
    } finally {
      cleanup(cwd);
    }
  });

  test("UserPromptSubmit injects context and does not write raw prompt memories", async () => {
    const cwd = tempProject();
    writeProjectConfig(cwd);
    const { requests, fetcher } = createRecorder();

    try {
      const result = await runHook(
        JSON.stringify({
          hook_event_name: "UserPromptSubmit",
          session_id: "session-1",
          prompt: "keep <private>secret-token</private> visible",
        }),
        { cwd, clientId: "client-1", fetcher }
      );

      expect(result.action).toBe("context");
      expect(requests.map((request) => request.url.pathname)).toEqual([
        "/api/client/connect",
        "/api/context/inject",
      ]);
      expect(JSON.stringify(requests)).not.toContain("secret-token");
      expect(requests.some((request) => request.url.pathname === "/api/memories")).toBe(false);
    } finally {
      cleanup(cwd);
    }
  });

  test("fully private prompts do not leak content and do not write memories", async () => {
    const cwd = tempProject();
    writeProjectConfig(cwd);
    const { requests, fetcher } = createRecorder();

    try {
      const result = await runHook(
        JSON.stringify({
          hook_event_name: "UserPromptSubmit",
          prompt: "<private>secret-token</private>",
        }),
        { cwd, clientId: "client-1", fetcher }
      );

      expect(result.action).toBe("context");
      expect(requests.map((request) => request.url.pathname)).toEqual([
        "/api/client/connect",
        "/api/context/inject",
      ]);
      expect(JSON.stringify(requests)).not.toContain("secret-token");
      expect(requests.some((request) => request.url.pathname === "/api/memories")).toBe(false);
    } finally {
      cleanup(cwd);
    }
  });

  test("Stop with transcript calls auto-capture", async () => {
    const cwd = tempProject();
    writeProjectConfig(cwd);
    const transcriptPath = join(cwd, "transcript.jsonl");
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({
          session_id: "session-1",
          message: {
            role: "user",
            id: "prompt-1",
            parts: [{ type: "text", text: "remember this" }],
          },
        }),
        JSON.stringify({ message: { role: "assistant", parts: [{ type: "text", text: "Done" }] } }),
      ].join("\n")
    );
    const { requests, fetcher } = createRecorder();

    try {
      const result = await runHook(
        JSON.stringify({
          hook_event_name: "Stop",
          session_id: "session-1",
          transcript_path: transcriptPath,
        }),
        { cwd, clientId: "client-1", fetcher }
      );

      expect(result).toEqual({ success: true, action: "captured" });
      expect(requests.map((request) => request.url.pathname)).toEqual([
        "/api/client/connect",
        "/api/auto-capture",
      ]);
      expect(requests[1].body).toMatchObject({
        sessionID: "session-1",
        projectTag: expect.any(String),
        repoId: expect.any(String),
        conversationMessages: [
          { role: "user", parts: [{ type: "text", text: "remember this" }] },
          { role: "assistant", parts: [{ type: "text", text: "Done" }] },
        ],
        userPrompt: "remember this",
        promptMessageId: "prompt-1",
      });
      expect(requests[1].headers.get("X-Memory-Bank-ID")).toBe("bank-1");
      expect(JSON.stringify(requests[1].body)).not.toContain("profileId");
    } finally {
      cleanup(cwd);
    }
  });

  test("Stop with active stop hook skips capture", async () => {
    const cwd = tempProject();
    writeProjectConfig(cwd);
    const { requests, fetcher } = createRecorder();

    try {
      const result = await runHook(
        JSON.stringify({ hook_event_name: "Stop", stop_hook_active: true }),
        {
          cwd,
          clientId: "client-1",
          fetcher,
        }
      );

      expect(result).toEqual({ success: true, action: "skipped", reason: "stop-hook-active" });
      expect(requests.map((request) => request.url.pathname)).toEqual(["/api/client/connect"]);
    } finally {
      cleanup(cwd);
    }
  });

  test("PreCompact with transcript calls auto-capture", async () => {
    const cwd = tempProject();
    writeProjectConfig(cwd);
    const transcriptPath = join(cwd, "transcript.jsonl");
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({
          session_id: "session-1",
          message: {
            role: "user",
            id: "prompt-1",
            parts: [{ type: "text", text: "compact this" }],
          },
        }),
        JSON.stringify({
          message: {
            role: "assistant",
            parts: [
              {
                type: "tool",
                tool: "apply_patch",
                state: { input: { command: "*** Begin Patch" } },
              },
            ],
          },
        }),
      ].join("\n")
    );
    const { requests, fetcher } = createRecorder();

    try {
      const result = await runHook(
        JSON.stringify({
          hook_event_name: "PreCompact",
          session_id: "session-1",
          transcript_path: transcriptPath,
          trigger: "auto",
        }),
        { cwd, clientId: "client-1", fetcher }
      );

      expect(result).toEqual({ success: true, action: "captured" });
      expect(requests.map((request) => request.url.pathname)).toEqual([
        "/api/client/connect",
        "/api/auto-capture",
      ]);
    } finally {
      cleanup(cwd);
    }
  });

  test("PostCompact connects and returns no hook output", async () => {
    const cwd = tempProject();
    writeProjectConfig(cwd);
    const { requests, fetcher } = createRecorder();

    try {
      const result = await runHook(
        JSON.stringify({ hook_event_name: "PostCompact", trigger: "manual" }),
        {
          cwd,
          clientId: "client-1",
          fetcher,
        }
      );

      expect(result).toEqual({ success: true, action: "connected" });
      expect(requests.map((request) => request.url.pathname)).toEqual(["/api/client/connect"]);
    } finally {
      cleanup(cwd);
    }
  });

  test("capture disabled still connects but does not auto-capture", async () => {
    const cwd = tempProject();
    writeProjectConfig(cwd, { captureEnabled: false });
    const { requests, fetcher } = createRecorder();

    try {
      const result = await runHook(
        JSON.stringify({ hook_event_name: "Stop", transcript_path: join(cwd, "missing.jsonl") }),
        {
          cwd,
          clientId: "client-1",
          fetcher,
        }
      );

      expect(result).toEqual({ success: true, action: "skipped", reason: "capture-disabled" });
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
      const result = await runHook(JSON.stringify({ hook_event_name: "SessionStart" }), {
        cwd,
        clientId: "client-1",
        fetcher,
      });

      expect(result).toEqual({ success: true, action: "skipped", reason: "connect-failed" });
      expect(requests.map((request) => request.url.pathname)).toEqual(["/api/client/connect"]);
    } finally {
      cleanup(cwd);
    }
  });

  test("failed context HTTP call is non-blocking after connect succeeds", async () => {
    const cwd = tempProject();
    writeProjectConfig(cwd);
    const { requests, fetcher } = createFailingRecorder("/api/context/inject");

    try {
      const result = await runHook(
        JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "remember this" }),
        {
          cwd,
          clientId: "client-1",
          fetcher,
        }
      );

      expect(result).toEqual({ success: true, action: "skipped", reason: "context-failed" });
      expect(requests.map((request) => request.url.pathname)).toEqual([
        "/api/client/connect",
        "/api/context/inject",
      ]);
    } finally {
      cleanup(cwd);
    }
  });
});
