export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface RemoteMemoryClientOptions {
  baseUrl: string;
  apiKey: string;
  clientId: string;
  timeoutMs?: number;
  fetcher?: Fetcher;
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type QueryValue = string | number | boolean | null | undefined;
type QueryParams = Record<string, QueryValue>;

export interface MemoryQueryParams {
  tag?: string;
  pageSize?: number;
  profileId?: string;
  repoId?: string;
  scope?: "project" | "all-projects";
}

export interface SearchMemoryParams extends MemoryQueryParams {
  q: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const AUTO_CAPTURE_TIMEOUT_MS = 180_000;

export class RemoteMemoryClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly clientId: string;
  private readonly timeoutMs: number;
  private readonly fetcher: Fetcher;

  constructor(options: RemoteMemoryClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.clientId = options.clientId;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetcher = options.fetcher ?? fetch;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: QueryParams,
    options: { timeoutMs?: number } = {},
  ): Promise<ApiResponse<T>> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }

    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.fetcher(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "X-Client-ID": this.clientId,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      const json = await parseApiResponse<T>(response);
      if (!response.ok) {
        return {
          success: false,
          error: this.sanitizeError(json.error ?? `HTTP ${response.status}`),
        };
      }

      if (!json.success && json.error) {
        return { ...json, error: this.sanitizeError(json.error) };
      }
      return json;
    } catch (error) {
      const message =
        error instanceof Error && error.name === "AbortError"
          ? `Request timed out after ${timeoutMs}ms`
          : error instanceof Error
            ? error.message
            : String(error);
      return { success: false, error: this.sanitizeError(message) };
    } finally {
      clearTimeout(timeout);
    }
  }

  private sanitizeError(message: string): string {
    if (!this.apiKey) {
      return message;
    }
    return message.split(this.apiKey).join("[redacted]");
  }

  clientConnect(metadata: Record<string, unknown>, params: { profileId?: string } = {}) {
    return this.request<{
      firstTime: boolean;
      daysSinceLastSeen: number | null;
      welcomeBack: boolean;
      stats: { totalMemories: number; memoriesToday: number; totalPrompts: number } | null;
      principal?: { kind: "admin" } | { kind: "profile"; profileId: string; displayName?: string };
      enrollment?: { profileId: string; apiKey: string };
    }>("POST", "/api/client/connect", {
      clientId: this.clientId,
      profileId: params.profileId,
      metadata,
    });
  }

  getClientStats() {
    return this.request<{
      firstSeen: number;
      lastSeen: number;
      totalMemories: number;
      memoriesToday: number;
      totalPrompts: number;
    }>("GET", "/api/client/stats", undefined, { clientId: this.clientId });
  }

  getContext(params: {
    sessionID?: string;
    projectTag: string;
    profileId?: string;
    repoId?: string;
    maxMemories?: number;
    excludeCurrentSession?: boolean;
    maxAgeDays?: number | null;
  }) {
    return this.request<{ context: string; memories: unknown[]; profileInjected: boolean }>(
      "POST",
      "/api/context/inject",
      params,
    );
  }

  addMemory(body: {
    content: string;
    containerTag: string;
    type?: string;
    tags?: string[];
    profileId?: string;
    repoId?: string;
    [key: string]: unknown;
  }) {
    return this.request<{ id: string }>("POST", "/api/memories", body);
  }

  deleteMemory(memoryId: string) {
    return this.request<void>("DELETE", `/api/memories/${encodeURIComponent(memoryId)}`);
  }

  listMemories(params: MemoryQueryParams): Promise<ApiResponse<unknown>>;
  listMemories(
    tag: string,
    pageSize?: number,
    scope?: "project" | "all-projects",
    params?: { profileId?: string; repoId?: string },
  ): Promise<ApiResponse<unknown>>;
  listMemories(
    tagOrParams: string | MemoryQueryParams,
    pageSize = 20,
    scope: "project" | "all-projects" = "project",
    params: { profileId?: string; repoId?: string } = {},
  ) {
    const query =
      typeof tagOrParams === "string"
        ? buildMemoryQuery({ tag: tagOrParams, pageSize, scope, ...params })
        : buildMemoryQuery(tagOrParams);
    return this.request("GET", "/api/memories", undefined, query);
  }

  searchMemories(params: SearchMemoryParams): Promise<ApiResponse<unknown>>;
  searchMemories(
    q: string,
    tag: string,
    pageSize?: number,
    scope?: "project" | "all-projects",
    params?: { profileId?: string; repoId?: string },
  ): Promise<ApiResponse<unknown>>;
  searchMemories(
    qOrParams: string | SearchMemoryParams,
    tag?: string,
    pageSize = 20,
    scope: "project" | "all-projects" = "project",
    params: { profileId?: string; repoId?: string } = {},
  ) {
    const query =
      typeof qOrParams === "string"
        ? buildMemoryQuery({ q: qOrParams, tag, pageSize, scope, ...params })
        : buildMemoryQuery(qOrParams);
    return this.request("GET", "/api/search", undefined, query);
  }

  getUserProfile(profileId?: string) {
    return this.request("GET", "/api/user-profile", undefined, profileId ? { profileId } : undefined);
  }

  autoCapture(body: {
    sessionID: string;
    projectTag: string;
    profileId?: string;
    repoId?: string;
    projectMetadata?: Record<string, unknown>;
    conversationMessages?: unknown[];
    userPrompt?: string;
    promptMessageId?: string;
    [key: string]: unknown;
  }) {
    return this.request<{ captured: boolean; memoryId?: string }>(
      "POST",
      "/api/auto-capture",
      body,
      undefined,
      { timeoutMs: AUTO_CAPTURE_TIMEOUT_MS },
    );
  }
}

function buildMemoryQuery(params: MemoryQueryParams & { q?: string }): QueryParams {
  const allProjects = params.scope === "all-projects";
  return {
    q: params.q,
    tag: allProjects ? undefined : params.tag,
    pageSize: params.pageSize,
    profileId: params.profileId,
    repoId: allProjects ? undefined : params.repoId,
  };
}

async function parseApiResponse<T>(response: Response): Promise<ApiResponse<T>> {
  try {
    return (await response.json()) as ApiResponse<T>;
  } catch {
    return { success: false, error: "Invalid JSON response" };
  }
}
