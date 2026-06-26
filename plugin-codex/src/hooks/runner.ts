#!/usr/bin/env node
import { loadConfig, type CodexMemnetConfig } from "../config";
import { getClientId } from "../identity";
import { RemoteMemoryClient, type MemoryBankSummary } from "../http-client";
import { selectMemoryBank } from "../../../shared/memory-bank";
import { getTags, type TagInfo } from "../tags";
import { logHookDiagnostic } from "./logger";
import { parseHookPayload, type ParsedHookPayload } from "./payload";
import { parseTranscriptFile, type ParsedTranscript } from "./transcript";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type HookEvent = "SessionStart" | "UserPromptSubmit" | "Stop" | "PreCompact" | "PostCompact";
type HookOutput = {
  hookSpecificOutput: {
    hookEventName: "SessionStart" | "UserPromptSubmit";
    additionalContext: string;
  };
};

export interface RunHookOptions {
  cwd?: string;
  clientId?: string;
  fetcher?: Fetcher;
  loadConfig?: (cwd: string) => CodexMemnetConfig;
}

export type RunHookResult =
  | { success: true; action: "context"; output: HookOutput }
  | { success: true; action: "captured" }
  | { success: true; action: "connected" }
  | {
      success: true;
      action: "skipped";
      reason:
        | "missing-config"
        | "connect-failed"
        | "capture-disabled"
        | "stop-hook-active"
        | "missing-transcript"
        | "transcript-unusable"
        | "context-empty"
        | "context-failed"
        | "capture-failed"
        | "missing-memory-bank"
        | "unsupported-event";
    };

interface HookRuntime {
  payload: ParsedHookPayload;
  event?: HookEvent;
  cwd: string;
  config: CodexMemnetConfig;
  clientId: string;
  http: RemoteMemoryClient;
  tags: TagInfo;
  memoryBank: MemoryBankSummary;
}

export async function runHook(input: string, options: RunHookOptions = {}): Promise<RunHookResult> {
  const payload = parseHookPayload(input);
  const cwd = payload.cwd ?? options.cwd ?? process.cwd();
  const config = options.loadConfig ? options.loadConfig(cwd) : loadConfig(cwd);

  if (!config.serverUrl || !config.apiKey) {
    logHookDiagnostic(payload.event ?? "unknown", { reason: "missing-config" });
    return { success: true, action: "skipped", reason: "missing-config" };
  }

  const event = normalizeEvent(payload.event);
  if (!event) {
    logHookDiagnostic(payload.event ?? "unknown", { reason: "unsupported-event" });
    return { success: true, action: "skipped", reason: "unsupported-event" };
  }

  const clientId = options.clientId ?? getClientId();
  const http = new RemoteMemoryClient({
    baseUrl: config.serverUrl,
    apiKey: config.apiKey,
    clientId,
    timeoutMs: config.timeoutMs,
    fetcher: options.fetcher,
  });
  const tags = getTags(cwd);

  const connect = await http.clientConnect({
    metadata: buildHookClientMetadata(tags),
    includeStats: false,
  });
  if (!connect.success) {
    logHookDiagnostic(event, { reason: "connect-failed", error: connect.error });
    return { success: true, action: "skipped", reason: "connect-failed" };
  }

  const memoryBanks = connect.data?.memoryBanks ?? [];
  const memoryBank = selectMemoryBank(memoryBanks, config.memoryBankId);
  if (!memoryBank && config.memoryBankId && memoryBanks.length > 0) {
    logHookDiagnostic(event, { reason: "configured-memory-bank-unavailable" });
    return { success: true, action: "skipped", reason: "missing-memory-bank" };
  }
  if (!memoryBank && event !== "PostCompact") {
    logHookDiagnostic(event, { reason: "missing-memory-bank" });
    return { success: true, action: "skipped", reason: "missing-memory-bank" };
  }
  if (!memoryBank) {
    return { success: true, action: "connected" };
  }

  const runtime: HookRuntime = {
    payload,
    event,
    cwd,
    config,
    clientId,
    http,
    tags,
    memoryBank,
  };

  switch (event) {
    case "SessionStart":
    case "UserPromptSubmit":
      return injectContext(runtime, event);
    case "Stop":
      return captureFromTranscript(runtime, { skipActiveStop: true });
    case "PreCompact":
      return captureFromTranscript(runtime, { skipActiveStop: false });
    case "PostCompact":
      return { success: true, action: "connected" };
  }
}

async function injectContext(
  runtime: HookRuntime,
  event: "SessionStart" | "UserPromptSubmit"
): Promise<RunHookResult> {
  const response = await runtime.http.getContext(
    {
      sessionID: runtime.payload.sessionID,
      projectTag: runtime.tags.projectTag,
      repoId: runtime.tags.repoId,
      maxMemories: runtime.config.context.maxMemories,
      excludeCurrentSession: runtime.config.context.excludeCurrentSession,
      maxAgeDays: runtime.config.context.maxAgeDays,
    },
    {
      memoryBankId: runtime.memoryBank.id,
    }
  );

  if (!response.success) {
    logHookDiagnostic(event, { reason: "context-failed", error: response.error });
    return { success: true, action: "skipped", reason: "context-failed" };
  }

  const context = response.data?.context?.trim();
  if (!context) {
    return { success: true, action: "skipped", reason: "context-empty" };
  }

  return {
    success: true,
    action: "context",
    output: {
      hookSpecificOutput: {
        hookEventName: event,
        additionalContext: context,
      },
    },
  };
}

async function captureFromTranscript(
  runtime: HookRuntime,
  options: { skipActiveStop: boolean }
): Promise<RunHookResult> {
  if (options.skipActiveStop && runtime.payload.stopHookActive) {
    return { success: true, action: "skipped", reason: "stop-hook-active" };
  }
  if (!runtime.config.capture.enabled) {
    return { success: true, action: "skipped", reason: "capture-disabled" };
  }
  if (!runtime.payload.transcriptPath) {
    return { success: true, action: "skipped", reason: "missing-transcript" };
  }

  let transcript: ParsedTranscript;
  try {
    transcript = parseTranscriptFile(runtime.payload.transcriptPath);
  } catch (error) {
    logHookDiagnostic(runtime.event ?? "unknown", { reason: "missing-transcript", error });
    return { success: true, action: "skipped", reason: "missing-transcript" };
  }

  if (
    !transcript.latestUserPrompt ||
    !transcript.promptMessageId ||
    !transcript.hasAssistantActivity
  ) {
    return { success: true, action: "skipped", reason: "transcript-unusable" };
  }

  const response = await runtime.http.autoCapture(
    {
      sessionID: runtime.payload.sessionID ?? transcript.sessionID ?? "unknown",
      projectTag: runtime.tags.projectTag,
      repoId: runtime.tags.repoId,
      projectMetadata: projectMetadata(runtime.tags),
      conversationMessages: transcript.messages,
      userPrompt: transcript.latestUserPrompt,
      promptMessageId: transcript.promptMessageId,
    },
    {
      memoryBankId: runtime.memoryBank.id,
    }
  );

  if (!response.success) {
    logHookDiagnostic(runtime.event ?? "unknown", {
      reason: "capture-failed",
      error: response.error,
    });
    return { success: true, action: "skipped", reason: "capture-failed" };
  }

  return { success: true, action: "captured" };
}

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function main(): Promise<void> {
  const input = await readStdin();
  const result = await runHook(input);
  if (result.action === "context") {
    process.stdout.write(`${JSON.stringify(result.output)}\n`);
  }
}

function normalizeEvent(value: string | undefined): HookEvent | undefined {
  if (
    value === "SessionStart" ||
    value === "UserPromptSubmit" ||
    value === "Stop" ||
    value === "PreCompact" ||
    value === "PostCompact"
  ) {
    return value;
  }
  return undefined;
}

function buildHookClientMetadata(tags: TagInfo): Record<string, unknown> {
  return {
    client: "codex",
    runtime: "codex-cli",
    repoId: tags.repoId,
    projectTag: tags.projectTag,
    ...projectMetadata(tags),
  };
}

function projectMetadata(tags: TagInfo): { projectName?: unknown; gitRepoUrl?: unknown } {
  return {
    projectName: tags.metadata.projectName,
    gitRepoUrl: tags.metadata.gitRepoUrl,
  };
}

function sanitizeDiagnostic(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value);
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
    .replace(/(api[_-]?key|token|password|secret)=([^&\s]+)/gi, "$1=[redacted]");
}

if (import.meta.main) {
  main().catch((error) => {
    logHookDiagnostic("fatal", { error: sanitizeDiagnostic(error) });
    process.exit(0);
  });
}
