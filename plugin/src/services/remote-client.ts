// plugin/src/services/remote-client.ts
import { CLIENT_CONFIG } from "../../../shared/client-config.js";
import { log, logDebug, logWarn } from "../../../shared/logger.js";

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_AUTO_CAPTURE_TIMEOUT = 180_000;

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

interface RequestOptions {
  timeoutMs?: number;
  logTimeoutAsDebug?: boolean;
}

export class RemoteMemoryClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly clientId: string;
  private readonly timeout: number;

  constructor(baseUrl: string, apiKey: string, clientId: string, timeout?: number) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.clientId = clientId;
    this.timeout = timeout ?? DEFAULT_TIMEOUT;
    logDebug(`RemoteMemoryClient created`, {
      baseUrl: this.baseUrl,
      timeout: this.timeout,
      hasApiKey: !!this.apiKey,
      clientId: this.clientId,
    });
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | undefined>,
    options: RequestOptions = {}
  ): Promise<ApiResponse<T>> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) url.searchParams.set(k, v);
      }
    }

    const timeoutMs = options.timeoutMs ?? this.timeout;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      logDebug(`→ ${method} ${path}`, {
        url: url.toString(),
        query: query
          ? Object.fromEntries(Object.entries(query).filter(([_, v]) => v !== undefined))
          : undefined,
        hasBody: !!body,
        bodyPreview: body ? JSON.stringify(body).slice(0, 200) : undefined,
      });
      const startTime = performance.now();

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Client-ID": this.clientId,
        "X-Opencode-Memnet-Client": "plugin",
      };
      if (this.apiKey) {
        headers.Authorization = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(url.toString(), {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const elapsed = Math.round(performance.now() - startTime);
      const json = (await response.json()) as ApiResponse<T>;

      if (!response.ok) {
        logWarn(`✗ ${method} ${path} ${response.status} ${elapsed}ms`, {
          status: response.status,
          error: json.error,
          body: json,
        });
        return {
          success: false,
          error: json.error || `HTTP ${response.status}`,
        };
      }

      logDebug(`← ${method} ${path} ${response.status} ${elapsed}ms`, {
        success: json.success,
        dataKeys: json.data ? Object.keys(json.data) : [],
      });
      return json;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isAbort =
        error instanceof Error &&
        (error.name === "AbortError" ||
          message.toLowerCase().includes("aborted") ||
          message.toLowerCase().includes("abort"));
      const logFn = isAbort && options.logTimeoutAsDebug ? logDebug : logWarn;
      logFn(`RemoteMemoryClient: request failed`, {
        method,
        path,
        url: url.toString(),
        error: isAbort ? `Request timed out after ${timeoutMs}ms` : message,
      });
      return {
        success: false,
        error: isAbort ? `Request timed out after ${timeoutMs}ms` : message,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ─── Context Injection ──────────────────────────────────

  async getContext(params: {
    sessionID?: string;
    projectTag: string;
    profileId: string;
    repoId: string;
    maxMemories?: number;
    excludeCurrentSession?: boolean;
    maxAgeDays?: number | null;
  }): Promise<ApiResponse<{ context: string; memories: any[]; profileInjected: boolean }>> {
    return this.request("POST", "/api/context/inject", params);
  }

  // ─── Auto-Capture ───────────────────────────────────────

  async autoCapture(params: {
    sessionID: string;
    projectTag: string;
    profileId: string;
    repoId: string;
    projectMetadata: Record<string, unknown>;
    conversationMessages: any[];
    userPrompt: string;
    promptMessageId: string;
  }): Promise<ApiResponse<{ captured: boolean; memoryId?: string }>> {
    return this.request("POST", "/api/auto-capture", params, undefined, {
      timeoutMs: DEFAULT_AUTO_CAPTURE_TIMEOUT,
      logTimeoutAsDebug: true,
    });
  }

  // ─── Memory Search ──────────────────────────────────────

  async searchMemories(
    query: string,
    containerTag: string,
    scope: string = "project",
    params?: { profileId?: string; repoId?: string }
  ): Promise<{
    success: boolean;
    error?: string;
    results: any[];
    total: number;
    timing: number;
  }> {
    const res = await this.request("GET", "/api/search", undefined, {
      q: query,
      tag: scope === "all-projects" ? undefined : containerTag,
      profileId: params?.profileId,
      repoId: scope === "all-projects" ? undefined : params?.repoId,
      pageSize: "20",
    });
    if (!res.success) return { success: false, error: res.error, results: [], total: 0, timing: 0 };
    const items = (res.data as any)?.items ?? [];
    const memItems = items
      .filter((i: any) => i.type === "memory")
      .map((i: any) => ({
        id: i.id,
        memory: i.content,
        similarity: i.similarity ?? 0,
        tags: i.tags,
        metadata: i.metadata,
      }));
    return { success: true, results: memItems, total: memItems.length, timing: 0 };
  }

  // ─── Memory CRUD ────────────────────────────────────────

  async addMemory(
    content: string,
    containerTag: string,
    metadata?: Record<string, unknown>
  ): Promise<ApiResponse<{ id: string }>> {
    return this.request("POST", "/api/memories", {
      content,
      containerTag,
      type: metadata?.type,
      tags: metadata?.tags,
      profileId: metadata?.profileId,
      repoId: metadata?.repoId,
      localProjectPath: metadata?.localProjectPath,
      gitRepoUrl: metadata?.gitRepoUrl,
      repoNickname: metadata?.repoNickname,
    });
  }

  async deleteMemory(memoryId: string): Promise<ApiResponse<void>> {
    return this.request("DELETE", `/api/memories/${memoryId}`);
  }

  async listMemories(
    containerTag: string,
    limit: number = 20,
    scope: string = "project",
    params?: { profileId?: string; repoId?: string }
  ): Promise<{ success: boolean; error?: string; memories: any[]; pagination: any }> {
    const res = await this.request("GET", "/api/memories", undefined, {
      tag: scope === "all-projects" ? undefined : containerTag,
      profileId: params?.profileId,
      repoId: scope === "all-projects" ? undefined : params?.repoId,
      pageSize: String(limit),
    });
    if (!res.success) return { success: false, error: res.error, memories: [], pagination: {} };
    const items = (res.data as any)?.items ?? [];
    const memories = items
      .filter((i: any) => i.type === "memory")
      .map((i: any) => ({
        id: i.id,
        summary: i.content,
        createdAt: i.createdAt,
        metadata: i.metadata,
        profileId: i.profileId,
        repoId: i.repoId,
        localProjectPath: i.localProjectPath,
        gitRepoUrl: i.gitRepoUrl,
        repoNickname: i.repoNickname,
      }));
    const data = res.data as any;
    return {
      success: true,
      memories,
      pagination: {
        currentPage: data?.page ?? 1,
        totalItems: data?.total ?? memories.length,
        totalPages: data?.totalPages ?? 1,
      },
    };
  }

  async searchMemoriesBySessionID(
    sessionID: string,
    containerTag: string,
    limit: number = 10,
    params?: { profileId?: string; repoId?: string }
  ): Promise<{ success: boolean; error?: string; results: any[]; total: number; timing: number }> {
    const res = await this.request("GET", "/api/search", undefined, {
      q: sessionID,
      tag: containerTag,
      profileId: params?.profileId,
      repoId: params?.repoId,
      pageSize: String(limit),
    });
    if (!res.success) return { success: false, error: res.error, results: [], total: 0, timing: 0 };
    const items = (res.data as any)?.items ?? [];
    const results = items
      .filter((i: any) => i.type === "memory")
      .map((i: any) => ({
        id: i.id,
        memory: i.content,
        similarity: i.similarity ?? 0,
        tags: i.tags,
        metadata: i.metadata,
        profileId: i.profileId,
        repoId: i.repoId,
        localProjectPath: i.localProjectPath,
        gitRepoUrl: i.gitRepoUrl,
        repoNickname: i.repoNickname,
        createdAt: i.createdAt,
      }));
    return { success: true, results, total: results.length, timing: 0 };
  }

  // ─── User Profile ───────────────────────────────────────

  async getUserProfile(profileId?: string): Promise<ApiResponse<any>> {
    const query: Record<string, string> = {};
    if (profileId) query.profileId = profileId;
    return this.request("GET", "/api/user-profile", undefined, query);
  }

  // ─── Client Identity ──────────────────────────────────

  async clientConnect(
    clientId: string,
    metadata: Record<string, unknown>
  ): Promise<
    ApiResponse<{
      firstTime: boolean;
      daysSinceLastSeen: number | null;
      welcomeBack: boolean;
      stats: { totalMemories: number; memoriesToday: number; totalPrompts: number } | null;
      principal: { kind: "admin" } | { kind: "profile"; profileId: string; displayName?: string };
    }>
  > {
    return this.request("POST", "/api/client/connect", { clientId, metadata });
  }
  async getClientStats(clientId: string): Promise<
    ApiResponse<{
      firstSeen: number;
      lastSeen: number;
      totalMemories: number;
      memoriesToday: number;
      totalPrompts: number;
    }>
  > {
    return this.request("GET", `/api/client/stats`, undefined, { clientId });
  }
}

// Module-level singleton
let _client: RemoteMemoryClient | null = null;

export function getRemoteClient(clientId?: string): RemoteMemoryClient {
  if (_client) return _client;
  if (!clientId) throw new Error("clientId required for first RemoteMemoryClient initialization");
  _client = new RemoteMemoryClient(CLIENT_CONFIG.serverUrl, CLIENT_CONFIG.apiKey, clientId);
  return _client;
}
