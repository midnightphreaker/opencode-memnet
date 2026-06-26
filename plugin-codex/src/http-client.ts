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
export type RequestOptions = { timeoutMs?: number; memoryBankId?: string };

export interface MemoryQueryParams {
  tag?: string;
  pageSize?: number;
  repoId?: string;
  scope?: "project" | "all-projects";
}

export interface SearchMemoryParams extends MemoryQueryParams {
  q: string;
}

export interface MemoryBankSummary {
  id: string;
  apiKeyId: string;
  name: string;
  description: string;
  shortcut: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClientConnectResponse {
  principal: {
    kind: "user-api-key";
    apiKeyId: string;
    apiKeyName: string;
    apiKeyDescription: string;
  };
  memoryBanks: MemoryBankSummary[];
  requiresMemoryBank: boolean;
  stats?: {
    memoryBankId: string;
    totalMemories: number;
    memoriesToday: number;
    totalPrompts: number;
  };
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
    options: RequestOptions = {}
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
          ...(options.memoryBankId ? { "X-Memory-Bank-ID": options.memoryBankId } : {}),
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

  clientConnect(
    body: {
      metadata?: Record<string, unknown>;
      includeStats?: boolean;
      memoryBankId?: string;
      [key: string]: unknown;
    } = {}
  ) {
    return this.request<ClientConnectResponse>("POST", "/api/client/connect", {
      clientId: this.clientId,
      ...body,
    });
  }

  getClientStats(options: { memoryBankId?: string } = {}) {
    return this.clientConnect({
      includeStats: true,
      memoryBankId: options.memoryBankId,
    }) as Promise<
      ApiResponse<{
        principal: ClientConnectResponse["principal"];
        memoryBanks: ClientConnectResponse["memoryBanks"];
        requiresMemoryBank: boolean;
        stats?: {
          memoryBankId: string;
          totalMemories: number;
          memoriesToday: number;
          totalPrompts: number;
        };
      }>
    >;
  }

  getContext(
    params: {
      sessionID?: string;
      projectTag: string;
      repoId?: string;
      maxMemories?: number;
      excludeCurrentSession?: boolean;
      maxAgeDays?: number | null;
    },
    options: RequestOptions = {}
  ) {
    return this.request<{ context: string; memories: unknown[]; profileInjected: boolean }>(
      "POST",
      "/api/context/inject",
      params,
      undefined,
      options
    );
  }

  addMemory(
    body: {
      content: string;
      containerTag: string;
      type?: string;
      tags?: string[];
      repoId?: string;
      [key: string]: unknown;
    },
    options: RequestOptions = {}
  ) {
    return this.request<{ id: string }>("POST", "/api/memories", body, undefined, options);
  }

  deleteMemory(memoryId: string, options: RequestOptions = {}) {
    return this.request<void>(
      "DELETE",
      `/api/memories/${encodeURIComponent(memoryId)}`,
      undefined,
      undefined,
      options
    );
  }

  listMemories(params: MemoryQueryParams, options?: RequestOptions): Promise<ApiResponse<unknown>>;
  listMemories(
    tag: string,
    pageSize?: number,
    scope?: "project" | "all-projects",
    params?: { repoId?: string },
    options?: RequestOptions
  ): Promise<ApiResponse<unknown>>;
  listMemories(
    tagOrParams: string | MemoryQueryParams,
    pageSizeOrOptions: number | RequestOptions = 20,
    scope: "project" | "all-projects" = "project",
    params: { repoId?: string } = {},
    options: RequestOptions = {}
  ) {
    const requestOptions =
      typeof tagOrParams === "string"
        ? options
        : isRequestOptions(pageSizeOrOptions)
          ? pageSizeOrOptions
          : {};
    const pageSize = typeof pageSizeOrOptions === "number" ? pageSizeOrOptions : 20;
    const query =
      typeof tagOrParams === "string"
        ? buildMemoryQuery({ tag: tagOrParams, pageSize, scope, ...params })
        : buildMemoryQuery(tagOrParams);
    return this.request("GET", "/api/memories", undefined, query, requestOptions);
  }

  searchMemories(
    params: SearchMemoryParams,
    options?: RequestOptions
  ): Promise<ApiResponse<unknown>>;
  searchMemories(
    q: string,
    tag: string,
    pageSize?: number,
    scope?: "project" | "all-projects",
    params?: { repoId?: string },
    options?: RequestOptions
  ): Promise<ApiResponse<unknown>>;
  searchMemories(
    qOrParams: string | SearchMemoryParams,
    tagOrOptions?: string | RequestOptions,
    pageSize = 20,
    scope: "project" | "all-projects" = "project",
    params: { repoId?: string } = {},
    options: RequestOptions = {}
  ) {
    const requestOptions =
      typeof qOrParams === "string" ? options : isRequestOptions(tagOrOptions) ? tagOrOptions : {};
    const tag = typeof tagOrOptions === "string" ? tagOrOptions : undefined;
    const query =
      typeof qOrParams === "string"
        ? buildMemoryQuery({ q: qOrParams, tag, pageSize, scope, ...params })
        : buildMemoryQuery(qOrParams);
    return this.request("GET", "/api/search", undefined, query, requestOptions);
  }

  getUserProfile(options: RequestOptions = {}) {
    return this.request("GET", "/api/user-profile", undefined, undefined, options);
  }

  autoCapture(
    body: {
      sessionID: string;
      projectTag: string;
      repoId?: string;
      projectMetadata?: Record<string, unknown>;
      conversationMessages?: unknown[];
      userPrompt?: string;
      promptMessageId?: string;
      [key: string]: unknown;
    },
    options: RequestOptions = {}
  ) {
    return this.request<{ captured: boolean; memoryId?: string }>(
      "POST",
      "/api/auto-capture",
      body,
      undefined,
      { timeoutMs: AUTO_CAPTURE_TIMEOUT_MS, memoryBankId: options.memoryBankId }
    );
  }
}

function isRequestOptions(value: unknown): value is RequestOptions {
  return (
    value !== null && typeof value === "object" && ("memoryBankId" in value || "timeoutMs" in value)
  );
}

function buildMemoryQuery(params: MemoryQueryParams & { q?: string }): QueryParams {
  const allProjects = params.scope === "all-projects";
  return {
    q: params.q,
    tag: allProjects ? undefined : params.tag,
    pageSize: params.pageSize,
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
