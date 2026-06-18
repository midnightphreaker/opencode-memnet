import { RemoteMemoryClient, type ApiResponse } from "../http-client";
import type { CodexMemnetConfig } from "../config";
import { assertConfigured } from "../config";
import { buildClientMetadata } from "../identity";
import { isFullyPrivate, stripPrivateContent } from "../privacy";
import { getTags, type TagInfo } from "../tags";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface HandlerContext {
  cwd: string;
  config: CodexMemnetConfig;
  clientId: string;
  fetcher?: Fetcher;
}

type ToolFailure = { success: false; error: string };
type ToolResult<T = unknown> = ApiResponse<T> | ToolFailure;
type ProjectScope = { profileId?: string; repoId: string };
type CaptureArgs = {
  summary?: string;
  sessionID?: string;
  conversationMessages?: unknown[];
  userPrompt?: string;
  promptMessageId?: string;
};

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
    profileId: ctx.config.profileId ?? tags.profileId,
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

export function createToolHandlers(ctx: HandlerContext) {
  return {
    async memory_connect(args: { nickname?: string } = {}): Promise<ToolResult> {
      const http = client(ctx);
      if (isFailure(http)) {
        return http;
      }

      const tags = getTags(ctx.cwd);
      const nickname = args.nickname?.trim() || ctx.config.nickname?.trim();
      return http.clientConnect(
        {
          client: buildClientMetadata(ctx.cwd).client,
          runtime: buildClientMetadata(ctx.cwd).runtime,
          repoId: tags.repoId,
          projectTag: tags.projectTag,
          ...projectMetadata(tags),
          ...(nickname ? { nickname } : {}),
        },
        { profileId: projectScope(ctx, tags).profileId },
      );
    },

    async memory_get_context(args: { sessionID?: string; maxMemories?: number } = {}): Promise<ToolResult> {
      const http = client(ctx);
      if (isFailure(http)) {
        return http;
      }

      const tags = getTags(ctx.cwd);
      return http.getContext({
        sessionID: args.sessionID,
        projectTag: tags.projectTag,
        ...projectScope(ctx, tags),
        maxMemories: args.maxMemories ?? ctx.config.context.maxMemories,
        excludeCurrentSession: ctx.config.context.excludeCurrentSession,
        maxAgeDays: ctx.config.context.maxAgeDays,
      });
    },

    async memory_add(args: { content?: string; type?: string; tags?: string[] }): Promise<ToolResult> {
      if (!args.content || !args.content.trim()) {
        return fail("content required");
      }
      if (isFullyPrivate(args.content)) {
        return fail("Private content blocked");
      }

      const http = client(ctx);
      if (isFailure(http)) {
        return http;
      }

      const tags = getTags(ctx.cwd);
      return http.addMemory({
        content: stripPrivateContent(args.content),
        containerTag: tags.projectTag,
        type: args.type,
        tags: args.tags,
        ...scopedProjectPayload(ctx, tags),
      });
    },

    async memory_search(args: { query?: string; limit?: number } = {}): Promise<ToolResult> {
      if (!args.query || !args.query.trim()) {
        return fail("query required");
      }

      const http = client(ctx);
      if (isFailure(http)) {
        return http;
      }

      const tags = getTags(ctx.cwd);
      return http.searchMemories({
        q: args.query,
        tag: tags.projectTag,
        pageSize: args.limit ?? 20,
        scope: ctx.config.memory.defaultScope,
        ...projectScope(ctx, tags),
      });
    },

    async memory_list(args: { limit?: number } = {}): Promise<ToolResult> {
      const http = client(ctx);
      if (isFailure(http)) {
        return http;
      }

      const tags = getTags(ctx.cwd);
      return http.listMemories({
        tag: tags.projectTag,
        pageSize: args.limit ?? 20,
        scope: ctx.config.memory.defaultScope,
        ...projectScope(ctx, tags),
      });
    },

    async memory_forget(args: { memoryId?: string }): Promise<ToolResult> {
      if (!args.memoryId || !args.memoryId.trim()) {
        return fail("memoryId required");
      }

      const http = client(ctx);
      if (isFailure(http)) {
        return http;
      }

      return http.deleteMemory(args.memoryId);
    },

    async memory_profile(): Promise<ToolResult> {
      const http = client(ctx);
      if (isFailure(http)) {
        return http;
      }

      const tags = getTags(ctx.cwd);
      return http.getUserProfile(projectScope(ctx, tags).profileId);
    },

    async memory_stats(): Promise<ToolResult> {
      const http = client(ctx);
      if (isFailure(http)) {
        return http;
      }

      return http.getClientStats();
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

      const http = client(ctx);
      if (isFailure(http)) {
        return http;
      }

      const tags = getTags(ctx.cwd);
      if (hasAutoCaptureData) {
        return http.autoCapture({
          sessionID: args.sessionID as string,
          projectTag: tags.projectTag,
          ...projectScope(ctx, tags),
          projectMetadata: projectMetadata(tags),
          conversationMessages: args.conversationMessages,
          userPrompt: stripPrivateContent(args.userPrompt as string),
          promptMessageId: args.promptMessageId,
        });
      }

      return http.addMemory({
        content: stripPrivateContent(args.summary as string),
        containerTag: tags.projectTag,
        type: "codex-session",
        source: "codex-mcp",
        sessionID: args.sessionID,
        ...scopedProjectPayload(ctx, tags),
      });
    },
  };
}
