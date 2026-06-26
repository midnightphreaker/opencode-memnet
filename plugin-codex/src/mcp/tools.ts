import { RemoteMemoryClient, type ApiResponse, type MemoryBankSummary } from "../http-client";
import type { CodexMemnetConfig } from "../config";
import { assertConfigured } from "../config";
import { buildClientMetadata } from "../identity";
import { isFullyPrivate, stripPrivateContent } from "../privacy";
import { getTags, type TagInfo } from "../tags";
import { selectMemoryBank, suggestMemoryBank } from "../../../shared/memory-bank";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface HandlerContext {
  cwd: string;
  config: CodexMemnetConfig;
  clientId: string;
  fetcher?: Fetcher;
}

type ToolFailure = { success: false; error: string };
type ToolResult<T = unknown> = ApiResponse<T> | ToolFailure;
type ProjectScope = { repoId: string };
type CaptureArgs = {
  summary?: string;
  sessionID?: string;
  conversationMessages?: unknown[];
  userPrompt?: string;
  promptMessageId?: string;
};
type ActiveMemoryBankContext = {
  http: RemoteMemoryClient;
  tags: TagInfo;
  memoryBank: MemoryBankSummary;
};

const NO_ACTIVE_MEMORY_BANK = "No active Memory Bank. Create one before using memory operations.";
const CONFIGURED_MEMORY_BANK_UNAVAILABLE =
  "Configured Memory Bank is not available for this API key.";
const ACTIVE_MEMORY_BANK_CACHE_TTL_MS = 30_000;

function fail(error: string): ToolFailure {
  return { success: false, error };
}

function tryConfigured(config: CodexMemnetConfig): ToolFailure | undefined {
  try {
    assertConfigured(config);
    return undefined;
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

function client(ctx: HandlerContext): RemoteMemoryClient | ToolFailure {
  const configError = tryConfigured(ctx.config);
  if (configError) {
    return configError;
  }

  return new RemoteMemoryClient({
    baseUrl: ctx.config.serverUrl,
    apiKey: ctx.config.apiKey,
    clientId: ctx.clientId,
    timeoutMs: ctx.config.timeoutMs,
    fetcher: ctx.fetcher,
  });
}

function projectScope(ctx: HandlerContext, tags: TagInfo): ProjectScope {
  return {
    repoId: tags.repoId,
  };
}

function projectMetadata(tags: TagInfo): { projectName?: unknown; gitRepoUrl?: unknown } {
  return {
    projectName: tags.metadata.projectName,
    gitRepoUrl: tags.metadata.gitRepoUrl,
  };
}

function scopedProjectPayload(ctx: HandlerContext, tags: TagInfo) {
  return {
    ...projectScope(ctx, tags),
    ...projectMetadata(tags),
  };
}

function isFailure(value: RemoteMemoryClient | ToolFailure): value is ToolFailure {
  return "success" in value && value.success === false;
}

function buildConnectBody(ctx: HandlerContext, tags: TagInfo, nickname?: string) {
  return {
    metadata: {
      client: buildClientMetadata(ctx.cwd).client,
      runtime: buildClientMetadata(ctx.cwd).runtime,
      repoId: tags.repoId,
      projectTag: tags.projectTag,
      ...projectMetadata(tags),
      ...(nickname ? { nickname } : {}),
    },
    includeStats: false,
  };
}

async function connectAndSelectMemoryBank(
  ctx: HandlerContext
): Promise<ActiveMemoryBankContext | ToolFailure> {
  const http = client(ctx);
  if (isFailure(http)) {
    return http;
  }

  const tags = getTags(ctx.cwd);
  const connect = await http.clientConnect(buildConnectBody(ctx, tags));
  if (!connect.success) {
    return fail(connect.error ?? "connect failed");
  }

  const memoryBanks = connect.data?.memoryBanks ?? [];
  const memoryBank = selectMemoryBank(memoryBanks, ctx.config.memoryBankId);
  if (!memoryBank) {
    if (ctx.config.memoryBankId && memoryBanks.length > 0) {
      return fail(CONFIGURED_MEMORY_BANK_UNAVAILABLE);
    }
    return fail(NO_ACTIVE_MEMORY_BANK);
  }

  return { http, tags, memoryBank };
}

function isMemoryBankFailure(value: ActiveMemoryBankContext | ToolFailure): value is ToolFailure {
  return "success" in value && value.success === false;
}

export function createToolHandlers(ctx: HandlerContext) {
  let cachedActive: ActiveMemoryBankContext | null = null;
  let cachedActiveExpiresAt = 0;

  async function activeMemoryBank(): Promise<ActiveMemoryBankContext | ToolFailure> {
    const now = Date.now();
    if (cachedActive && cachedActiveExpiresAt > now) {
      return cachedActive;
    }
    const active = await connectAndSelectMemoryBank(ctx);
    if (!isMemoryBankFailure(active)) {
      cachedActive = active;
      cachedActiveExpiresAt = now + ACTIVE_MEMORY_BANK_CACHE_TTL_MS;
    }
    return active;
  }

  return {
    async memory_connect(args: { nickname?: string } = {}): Promise<ToolResult> {
      const http = client(ctx);
      if (isFailure(http)) {
        return http;
      }

      const tags = getTags(ctx.cwd);
      const nickname = args.nickname?.trim() || ctx.config.nickname?.trim();
      const response = await http.clientConnect(buildConnectBody(ctx, tags, nickname));
      if (!response.success) {
        return response;
      }
      const selected = selectMemoryBank(response.data?.memoryBanks ?? [], ctx.config.memoryBankId);
      if (selected) {
        cachedActive = { http, tags, memoryBank: selected };
        cachedActiveExpiresAt = Date.now() + ACTIVE_MEMORY_BANK_CACHE_TTL_MS;
      }
      if (!response.data?.memoryBanks?.length) {
        return {
          ...response,
          data: {
            ...response.data,
            suggestedMemoryBank: suggestMemoryBank(ctx.cwd),
          },
        };
      }
      return response;
    },

    async memory_get_context(
      args: { sessionID?: string; maxMemories?: number } = {}
    ): Promise<ToolResult> {
      const active = await activeMemoryBank();
      if (isMemoryBankFailure(active)) {
        return active;
      }

      return active.http.getContext(
        {
          sessionID: args.sessionID,
          projectTag: active.tags.projectTag,
          ...projectScope(ctx, active.tags),
          maxMemories: args.maxMemories ?? ctx.config.context.maxMemories,
          excludeCurrentSession: ctx.config.context.excludeCurrentSession,
          maxAgeDays: ctx.config.context.maxAgeDays,
        },
        {
          memoryBankId: active.memoryBank.id,
        }
      );
    },

    async memory_add(args: {
      content?: string;
      type?: string;
      tags?: string[];
    }): Promise<ToolResult> {
      if (!args.content || !args.content.trim()) {
        return fail("content required");
      }
      if (isFullyPrivate(args.content)) {
        return fail("Private content blocked");
      }

      const active = await activeMemoryBank();
      if (isMemoryBankFailure(active)) {
        return active;
      }

      return active.http.addMemory(
        {
          content: stripPrivateContent(args.content),
          containerTag: active.tags.projectTag,
          type: args.type,
          tags: args.tags,
          ...scopedProjectPayload(ctx, active.tags),
        },
        {
          memoryBankId: active.memoryBank.id,
        }
      );
    },

    async memory_search(args: { query?: string; limit?: number } = {}): Promise<ToolResult> {
      if (!args.query || !args.query.trim()) {
        return fail("query required");
      }

      const active = await activeMemoryBank();
      if (isMemoryBankFailure(active)) {
        return active;
      }

      return active.http.searchMemories(
        {
          q: args.query,
          tag: active.tags.projectTag,
          pageSize: args.limit ?? 20,
          scope: ctx.config.memory.defaultScope,
          ...projectScope(ctx, active.tags),
        },
        {
          memoryBankId: active.memoryBank.id,
        }
      );
    },

    async memory_list(args: { limit?: number } = {}): Promise<ToolResult> {
      const active = await activeMemoryBank();
      if (isMemoryBankFailure(active)) {
        return active;
      }

      return active.http.listMemories(
        {
          tag: active.tags.projectTag,
          pageSize: args.limit ?? 20,
          scope: ctx.config.memory.defaultScope,
          ...projectScope(ctx, active.tags),
        },
        {
          memoryBankId: active.memoryBank.id,
        }
      );
    },

    async memory_forget(args: { memoryId?: string }): Promise<ToolResult> {
      if (!args.memoryId || !args.memoryId.trim()) {
        return fail("memoryId required");
      }

      const active = await activeMemoryBank();
      if (isMemoryBankFailure(active)) {
        return active;
      }

      return active.http.deleteMemory(args.memoryId, { memoryBankId: active.memoryBank.id });
    },

    async memory_profile(): Promise<ToolResult> {
      const http = client(ctx);
      if (isFailure(http)) {
        return http;
      }

      const tags = getTags(ctx.cwd);
      const response = await http.clientConnect(buildConnectBody(ctx, tags));
      if (!response.success) {
        return response;
      }
      return {
        success: true,
        data: {
          principal: response.data?.principal,
          memoryBanks: response.data?.memoryBanks ?? [],
          activeMemoryBank: selectMemoryBank(
            response.data?.memoryBanks ?? [],
            ctx.config.memoryBankId
          ),
          requiresMemoryBank: response.data?.requiresMemoryBank ?? true,
          ...(response.data?.memoryBanks?.length
            ? {}
            : { suggestedMemoryBank: suggestMemoryBank(ctx.cwd) }),
        },
      };
    },

    async memory_stats(): Promise<ToolResult> {
      const active = await activeMemoryBank();
      if (isMemoryBankFailure(active)) {
        return active;
      }

      return active.http.clientConnect({
        ...buildConnectBody(ctx, active.tags),
        includeStats: true,
        memoryBankId: active.memoryBank.id,
      });
    },

    async memory_set_nickname(_args: { nickname?: string }): Promise<ToolResult> {
      return fail("Nickname updates are not supported by the current server");
    },

    async memory_capture(args: CaptureArgs): Promise<ToolResult> {
      if (args.summary !== undefined && isFullyPrivate(args.summary)) {
        return fail("Private content blocked");
      }
      if (args.userPrompt !== undefined && isFullyPrivate(args.userPrompt)) {
        return fail("Private content blocked");
      }
      const hasAutoCaptureData =
        Boolean(args.sessionID) &&
        Boolean(args.userPrompt?.trim()) &&
        Boolean(args.promptMessageId?.trim()) &&
        Array.isArray(args.conversationMessages);
      if (!hasAutoCaptureData && (!args.summary || !args.summary.trim())) {
        return fail("summary required");
      }
      if (!ctx.config.capture.enabled) {
        return fail("capture disabled");
      }

      const active = await activeMemoryBank();
      if (isMemoryBankFailure(active)) {
        return active;
      }

      if (hasAutoCaptureData) {
        return active.http.autoCapture(
          {
            sessionID: args.sessionID as string,
            projectTag: active.tags.projectTag,
            ...projectScope(ctx, active.tags),
            projectMetadata: projectMetadata(active.tags),
            conversationMessages: args.conversationMessages,
            userPrompt: stripPrivateContent(args.userPrompt as string),
            promptMessageId: args.promptMessageId,
          },
          {
            memoryBankId: active.memoryBank.id,
          }
        );
      }

      return active.http.addMemory(
        {
          content: stripPrivateContent(args.summary as string),
          containerTag: active.tags.projectTag,
          type: "codex-session",
          source: "codex-mcp",
          sessionID: args.sessionID,
          ...scopedProjectPayload(ctx, active.tags),
        },
        {
          memoryBankId: active.memoryBank.id,
        }
      );
    },
  };
}
