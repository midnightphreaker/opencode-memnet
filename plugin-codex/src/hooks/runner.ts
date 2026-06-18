#!/usr/bin/env node
import { loadConfig, type CodexMemnetConfig } from "../config";
import { getClientId } from "../identity";
import { RemoteMemoryClient } from "../http-client";
import { isFullyPrivate, stripPrivateContent } from "../privacy";
import { getTags, type TagInfo } from "../tags";
import { parseHookPayload } from "./payload";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface RunHookOptions {
  cwd?: string;
  clientId?: string;
  fetcher?: Fetcher;
  loadConfig?: (cwd: string) => CodexMemnetConfig;
}

export type RunHookResult =
  | { success: true; captured: true }
  | {
      success: true;
      captured: false;
      reason:
        | "missing-config"
        | "connect-failed"
        | "capture-disabled"
        | "missing-prompt"
        | "private-prompt"
        | "empty-prompt"
        | "memory-write-failed";
    };

export async function runHook(input: string, options: RunHookOptions = {}): Promise<RunHookResult> {
  const payload = parseHookPayload(input);
  const cwd = payload.cwd ?? options.cwd ?? process.cwd();
  const config = options.loadConfig ? options.loadConfig(cwd) : loadConfig(cwd);

  if (!config.serverUrl || !config.apiKey) {
    return { success: true, captured: false, reason: "missing-config" };
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

  const connect = await http.clientConnect(buildHookClientMetadata(tags), {
    profileId: config.profileId ?? tags.profileId,
  });
  if (!connect.success) {
    return { success: true, captured: false, reason: "connect-failed" };
  }

  if (!config.capture.enabled) {
    return { success: true, captured: false, reason: "capture-disabled" };
  }
  if (!payload.prompt) {
    return { success: true, captured: false, reason: "missing-prompt" };
  }
  if (isFullyPrivate(payload.prompt)) {
    return { success: true, captured: false, reason: "private-prompt" };
  }

  const content = stripPrivateContent(payload.prompt);
  if (!content.trim()) {
    return { success: true, captured: false, reason: "empty-prompt" };
  }

  const write = await http.addMemory({
    content,
    containerTag: tags.projectTag,
    type: "codex-hook",
    source: "codex-hook",
    hookEvent: payload.event,
    sessionID: payload.sessionID,
    projectTag: tags.projectTag,
    profileId: config.profileId ?? tags.profileId,
    repoId: tags.repoId,
    ...projectMetadata(tags),
  });

  if (!write.success) {
    return { success: true, captured: false, reason: "memory-write-failed" };
  }

  return { success: true, captured: true };
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
  await runHook(input);
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
    console.error(`[opencode-memnet-codex-hook] ${sanitizeDiagnostic(error)}`);
    process.exit(0);
  });
}
