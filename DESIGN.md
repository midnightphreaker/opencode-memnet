# opencode-memnet Server-Client Architecture — Design Document

## v1.0

---

## 1. Architecture Overview

### 1.1 High-Level Split

```
┌─────────────────────────────────────────────────┐
│                   opencode-memnet                  │
├──────────────────────┬──────────────────────────┤
│       CLIENT         │         SERVER           │
│  (OpenCode Plugin)   │  (Standalone Bun HTTP)   │
├──────────────────────┼──────────────────────────┤
│ src/index.ts         │ src/server.ts            │
│ src/config.ts        │ src/server-config.ts     │
│ src/services/        │ src/services/            │
│   remote-client.ts   │   api-handlers.ts        │
│   context.ts         │   auto-capture.ts        │
│   tags.ts            │   user-memory-learning.ts│
│   privacy.ts         │   embedding.ts           │
│   logger.ts          │   storage/               │
│   language-detector  │   ai/                    │
│                      │   web-server.ts          │
│                      │   auth.ts  (NEW)         │
│                      │   logger.ts              │
├──────────────────────┼──────────────────────────┤
│ Depends on:          │ Depends on:              │
│ @opencode-ai/plugin  │ postgres (pg driver)     │
│ @opencode-ai/sdk     │ pgvector                 │
│ (no DB, no embed,    │ OpenAI-compat embed API  │
│  no AI provider)     │ OpenAI-compat chat API   │
│                      │ zod                      │
│                      │ franc-min, iso-639-3     │
└──────────────────────┴──────────────────────────┘
```

### 1.2 Communication

All client→server communication is synchronous REST over HTTP/1.1 using Bun's native `fetch`. No WebSocket, no streaming, no gRPC.

```
Client Plugin                    Server
     │                              │
     │── POST /api/context/inject ──→
     │←── { context, memories } ────│
     │                              │
     │── POST /api/auto-capture ───→
     │←── { captured, memoryId } ───│
     │                              │
     │── GET /api/memories ────────→
     │←── { items, total, ... } ────│
     │                              │
     │── POST /api/memories ───────→
     │←── { id } ───────────────────│
     │                              │
     All requests include:
     Authorization: Bearer <apiKey>
```

### 1.3 Process Model

- **Server**: One long-lived Bun process. Owns the Postgres pool, embedding service singleton, AI provider instances, and the WebUI static file server.
- **Client**: Runs inside OpenCode's process as a standard plugin. Lightweight — imports only `@opencode-ai/plugin`, `@opencode-ai/sdk`, and local utility modules (`context.ts`, `privacy.ts`, `tags.ts`, `logger.ts`, `language-detector.ts`).

---

## 2. Server Architecture

### 2.1 Entry Point: `src/server.ts`

```typescript
// src/server.ts — Standalone server entry point
import { startServer } from "./services/web-server.js";
import { initServerConfig } from "./server-config.js";
import { initializeStorage } from "./services/storage/factory.js";
import { embeddingService } from "./services/embedding.js";
import { log } from "./services/logger.js";

const config = initServerConfig();

// Validate required config
if (!config.postgres.url) {
  console.error("FATAL: POSTGRES_URL is required");
  process.exit(1);
}
if (!config.serverApiKey) {
  console.error("FATAL: SERVER_API_KEY is required");
  process.exit(1);
}

// Initialize storage (runs migrations)
const repos = await initializeStorage();
log("Storage initialized (migrations complete)");

// Warm up embedding service
await embeddingService.warmup();
log("Embedding service ready");

// Start HTTP server
const server = await startServer({
  port: config.port,
  host: config.host,
  apiKey: config.serverApiKey,
  allowedOrigin: config.webServerAllowedOrigin,
});

log(`Server listening on http://${config.host}:${config.port}`);

// Graceful shutdown
const shutdown = async () => {
  log("Shutting down...");
  await server.stop();
  const { closeStorage } = await import("./services/storage/factory.js");
  await closeStorage();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
```

**Key changes from current `src/index.ts`:**

- No `PluginInput` dependency — pure Bun HTTP process.
- `initServerConfig()` replaces `initConfig(directory)` — reads from env vars, not file paths.
- `initializeStorage()` called synchronously at startup (not lazily on first use).
- `embeddingService.warmup()` called at startup.
- No plugin hooks, no `ctx.client`, no TUI toasts, no idle timeout.
- No `webServer.isServerOwner()` / port takeover logic — server owns the port unconditionally.

### 2.2 Component Layout

```
src/server.ts                         Entry: init config, storage, embeddings, start HTTP
  ├── src/server-config.ts            Server configuration (env vars + file fallback)
  ├── src/services/web-server.ts      Bun HTTP router (MODIFIED: add auth)
  │     ├── src/services/auth.ts      NEW: API key validation middleware
  │     └── src/services/api-handlers.ts  Request handlers (UNCHANGED logic)
  │           ├── src/services/embedding.ts      Embedding service (UNCHANGED)
  │           ├── src/services/storage/factory.ts  Repository singletons (UNCHANGED)
  │           ├── src/services/auto-capture.ts     Auto-capture pipeline (MOVED)
  │           ├── src/services/user-memory-learning.ts  Profile learning (MOVED)
  │           └── src/services/ai/                 AI provider (UNCHANGED)
  ├── src/web/                         Static files: index.html, app.js, styles.css, i18n.js
  └── src/services/logger.ts           Logging utility (UNCHANGED)
```

**Note**: `auto-capture.ts` and `user-memory-learning.ts` are currently called from `src/index.ts` (the plugin). They will be adapted to work as server-side handlers, accepting HTTP request bodies instead of `PluginInput` objects. The core AI/embedding logic within them stays identical.

### 2.3 Server Configuration: `src/server-config.ts`

New file. Loads config from environment variables, with an optional JSON/JSONC file as fallback.

```typescript
// src/server-config.ts
export interface ServerConfig {
  // Network
  port: number; // SERVER_PORT, default 4747
  host: string; // SERVER_HOST, default "0.0.0.0"
  serverApiKey: string; // SERVER_API_KEY (required)

  // Postgres
  postgres: {
    url: string;
    ssl: boolean | "require";
    maxConnections: number;
    idleTimeoutSeconds: number;
    connectTimeoutSeconds: number;
    vectorType: "vector" | "halfvec";
    hnswEfSearch: number;
    hnswEfConstruction: number;
  };

  // Embedding
  embeddingModel: string;
  embeddingApiUrl: string;
  embeddingApiKey: string;
  embeddingDimensions: number;
  embeddingMaxTokens: { content: number; tags: number; query: number; migration: number };
  embeddingTruncationSide: {
    content: "left" | "right";
    tags: "left" | "right";
    query: "left" | "right";
    migration: "left" | "right";
  };

  // Memory/Search
  similarityThreshold: number;
  maxMemories: number;
  injectProfile: boolean;

  // AI Provider (auto-capture & profile learning)
  memoryProvider: "openai-chat";
  memoryModel?: string;
  memoryApiUrl?: string;
  memoryApiKey?: string;
  memoryTemperature?: number | false;
  memoryExtraParams?: Record<string, unknown>;
  opencodeProvider?: string;
  opencodeModel?: string;
  autoCaptureMaxIterations: number;
  autoCaptureIterationTimeout: number;
  autoCaptureLanguage: string;
  aiSessionRetentionDays: number;

  // User Profile Learning
  userProfileAnalysisInterval: number;
  userProfileMaxPreferences: number;
  userProfileMaxPatterns: number;
  userProfileMaxWorkflows: number;
  userProfileConfidenceDecayDays: number;
  userProfileChangelogRetentionCount: number;

  // Web
  webServerAllowedOrigin: string;
}

export function initServerConfig(): ServerConfig {
  const env = process.env;

  return {
    port: parseInt(env.SERVER_PORT || "4747"),
    host: env.SERVER_HOST || "0.0.0.0",
    serverApiKey: env.SERVER_API_KEY || "",

    postgres: {
      url: env.POSTGRES_URL || "",
      ssl: env.POSTGRES_SSL === "false" ? false : (env.POSTGRES_SSL as "require") || "require",
      maxConnections: parseInt(env.POSTGRES_MAX_CONNECTIONS || "10"),
      idleTimeoutSeconds: parseInt(env.POSTGRES_IDLE_TIMEOUT_SECONDS || "30"),
      connectTimeoutSeconds: parseInt(env.POSTGRES_CONNECT_TIMEOUT_SECONDS || "10"),
      vectorType: (env.POSTGRES_VECTOR_TYPE as "vector" | "halfvec") || "vector",
      hnswEfSearch: parseInt(env.POSTGRES_HNSW_EF_SEARCH || "128"),
      hnswEfConstruction: parseInt(env.POSTGRES_HNSW_EF_CONSTRUCTION || "256"),
    },

    embeddingModel: env.EMBEDDING_MODEL || "",
    embeddingApiUrl: env.EMBEDDING_API_URL || "",
    embeddingApiKey: env.EMBEDDING_API_KEY || env.OPENAI_API_KEY || "",
    embeddingDimensions: parseInt(env.EMBEDDING_DIMENSIONS || "0") || 1024,
    embeddingMaxTokens: {
      content: parseInt(env.EMBEDDING_MAX_TOKENS_CONTENT || "2048"),
      tags: parseInt(env.EMBEDDING_MAX_TOKENS_TAGS || "256"),
      query: parseInt(env.EMBEDDING_MAX_TOKENS_QUERY || "512"),
      migration: parseInt(env.EMBEDDING_MAX_TOKENS_MIGRATION || "2048"),
    },
    embeddingTruncationSide: {
      content: (env.EMBEDDING_TRUNCATION_CONTENT as "left" | "right") || "right",
      tags: (env.EMBEDDING_TRUNCATION_TAGS as "left" | "right") || "right",
      query: (env.EMBEDDING_TRUNCATION_QUERY as "left" | "right") || "right",
      migration: (env.EMBEDDING_TRUNCATION_MIGRATION as "left" | "right") || "right",
    },

    similarityThreshold: parseFloat(env.SIMILARITY_THRESHOLD || "0.6"),
    maxMemories: parseInt(env.MAX_MEMORIES || "10"),
    injectProfile: env.INJECT_PROFILE !== "false",

    memoryProvider: "openai-chat",
    memoryModel: env.MEMORY_MODEL,
    memoryApiUrl: env.MEMORY_API_URL,
    memoryApiKey: env.MEMORY_API_KEY,
    memoryTemperature:
      env.MEMORY_TEMPERATURE === "false"
        ? false
        : env.MEMORY_TEMPERATURE
          ? parseFloat(env.MEMORY_TEMPERATURE)
          : 0.3,
    opencodeProvider: env.OPENCODE_PROVIDER,
    opencodeModel: env.OPENCODE_MODEL,
    autoCaptureMaxIterations: parseInt(env.AUTO_CAPTURE_MAX_ITERATIONS || "5"),
    autoCaptureIterationTimeout: parseInt(env.AUTO_CAPTURE_ITERATION_TIMEOUT || "30000"),
    autoCaptureLanguage: env.AUTO_CAPTURE_LANGUAGE || "auto",
    aiSessionRetentionDays: parseInt(env.AI_SESSION_RETENTION_DAYS || "7"),

    userProfileAnalysisInterval: parseInt(env.USER_PROFILE_ANALYSIS_INTERVAL || "10"),
    userProfileMaxPreferences: parseInt(env.USER_PROFILE_MAX_PREFERENCES || "20"),
    userProfileMaxPatterns: parseInt(env.USER_PROFILE_MAX_PATTERNS || "15"),
    userProfileMaxWorkflows: parseInt(env.USER_PROFILE_MAX_WORKFLOWS || "10"),
    userProfileConfidenceDecayDays: parseInt(env.USER_PROFILE_CONFIDENCE_DECAY_DAYS || "30"),
    userProfileChangelogRetentionCount: parseInt(env.USER_PROFILE_CHANGELOG_RETENTION || "5"),

    webServerAllowedOrigin: env.WEB_SERVER_ALLOWED_ORIGIN || "*",
  };
}
```

### 2.4 Auth Middleware: `src/services/auth.ts`

New file. Extracted from the request handling loop in `web-server.ts`.

```typescript
// src/services/auth.ts

export class AuthMiddleware {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error("API key must be provided");
    }
    this.apiKey = apiKey;
  }

  /**
   * Returns null if the request is authenticated.
   * Returns a 401 Response if not.
   */
  authenticate(req: Request): Response | null {
    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing Authorization header" }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Invalid Authorization format. Use: Bearer <key>",
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    const providedKey = parts[1];
    if (providedKey !== this.apiKey) {
      return new Response(JSON.stringify({ success: false, error: "Invalid API key" }), {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    return null; // authenticated
  }
}
```

**Integration into `web-server.ts`:**

- `WebServer` constructor accepts `apiKey: string`.
- `handleRequest()` calls `this.auth.authenticate(req)` for all paths matching `/api/*` except `/api/health`.
- CORS preflight (`OPTIONS`) skips auth (SRV-016).
- Static file routes (`/`, `/index.html`, `/app.js`, etc.) skip auth.

### 2.5 `web-server.ts` Modifications

**Constructor change:**

```typescript
// Before:
constructor(config: WebServerConfig) {
  this.config = config;
  this.allowedOrigin = config.allowedOrigin ?? "*";
}

// After:
constructor(config: WebServerConfig, apiKey: string) {
  this.config = config;
  this.allowedOrigin = config.allowedOrigin ?? "*";
  this.auth = new AuthMiddleware(apiKey);
}
```

**Request handler addition — inserted at the top of `handleRequest()` after CORS:**

```typescript
private async handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // CORS preflight (no auth)
  if (req.method === "OPTIONS") {
    return this.corsPreflightResponse();
  }

  // Auth check for API routes (except health)
  if (path.startsWith("/api/") && path !== "/api/health") {
    const authError = this.auth.authenticate(req);
    if (authError) return authError;
  }

  // ... existing route handling ...
}
```

**Removed behaviors:**

- Port takeover (health check loop, `isServerOwner()`, `attemptTakeover()`)
- `startHealthCheckLoop()` / `stopHealthCheckLoop()`
- `onTakeoverCallback`
- All code paths that assume multiple processes competing for the port

The `startWebServer()` exported function signature changes:

```typescript
// Before:
export async function startWebServer(config: WebServerConfig): Promise<WebServer>;

// After:
export async function startWebServer(config: WebServerConfig, apiKey: string): Promise<WebServer>;
```

### 2.6 API Endpoint Catalog

#### 2.6.1 Preserved Endpoints (No Logic Changes)

| Method   | Path                            | Handler                         | Auth | Changes |
| -------- | ------------------------------- | ------------------------------- | ---- | ------- |
| `GET`    | `/api/tags`                     | `handleListTags`                | Yes  | None    |
| `GET`    | `/api/memories`                 | `handleListMemories`            | Yes  | None    |
| `POST`   | `/api/memories`                 | `handleAddMemory`               | Yes  | None    |
| `PUT`    | `/api/memories/:id`             | `handleUpdateMemory`            | Yes  | None    |
| `DELETE` | `/api/memories/:id`             | `handleDeleteMemory`            | Yes  | None    |
| `POST`   | `/api/memories/bulk-delete`     | `handleBulkDelete`              | Yes  | None    |
| `GET`    | `/api/search`                   | `handleSearch`                  | Yes  | None    |
| `GET`    | `/api/stats`                    | `handleStats`                   | Yes  | None    |
| `POST`   | `/api/memories/:id/pin`         | `handlePinMemory`               | Yes  | None    |
| `POST`   | `/api/memories/:id/unpin`       | `handleUnpinMemory`             | Yes  | None    |
| `GET`    | `/api/migration/tags/detect`    | `handleDetectTagMigration`      | Yes  | None    |
| `POST`   | `/api/migration/tags/run-batch` | `handleRunTagMigrationBatch`    | Yes  | None    |
| `GET`    | `/api/migration/tags/progress`  | `handleGetTagMigrationProgress` | Yes  | None    |
| `DELETE` | `/api/prompts/:id`              | `handleDeletePrompt`            | Yes  | None    |
| `POST`   | `/api/prompts/bulk-delete`      | `handleBulkDeletePrompts`       | Yes  | None    |
| `GET`    | `/api/user-profile`             | `handleGetUserProfile`          | Yes  | None    |
| `GET`    | `/api/user-profile/changelog`   | `handleGetProfileChangelog`     | Yes  | None    |
| `GET`    | `/api/user-profile/snapshot`    | `handleGetProfileSnapshot`      | Yes  | None    |
| `POST`   | `/api/user-profile/refresh`     | `handleRefreshProfile`          | Yes  | None    |

#### 2.6.2 New Endpoints

| Method | Path                      | Handler                  | Auth | Purpose                                                   |
| ------ | ------------------------- | ------------------------ | ---- | --------------------------------------------------------- |
| `GET`  | `/api/health`             | `handleHealth`           | No   | Server health / readiness check                           |
| `POST` | `/api/context/inject`     | `handleContextInject`    | Yes  | Fetch formatted memory+profile context for chat injection |
| `POST` | `/api/auto-capture`       | `handleAutoCapture`      | Yes  | Trigger auto-capture pipeline from conversation data      |
| `POST` | `/api/user-profile/learn` | `handleUserProfileLearn` | Yes  | Trigger profile learning from prompts                     |

#### 2.6.3 New Handler Specifications

**`GET /api/health`** — `handleHealth()`

Returns server readiness status. Called by Docker health checks, client startup warmup, and load balancers.

```typescript
// src/services/health-handler.ts (NEW)
import { embeddingService } from "./embedding.js";

let _dbConnected = false;
let _startTime = Date.now();

export function setDbConnected(value: boolean): void {
  _dbConnected = value;
}

export function handleHealth(): {
  status: string;
  version: string;
  dbConnected: boolean;
  embeddingReady: boolean;
  uptime: number;
} {
  return {
    status: _dbConnected && embeddingService.isWarmedUp ? "ok" : "degraded",
    version: "2.14.3",
    dbConnected: _dbConnected,
    embeddingReady: embeddingService.isWarmedUp,
    uptime: Date.now() - _startTime,
  };
}
```

**`POST /api/context/inject`** — `handleContextInject(body)`

New handler in `src/services/api-handlers.ts`. Builds the same `[MEMORY]` block that the current `chat.message` hook produces.

```typescript
// src/services/api-handlers.ts — ADD:
export async function handleContextInject(data: {
  sessionID?: string;
  projectTag: string;
  userId?: string;
  maxMemories?: number;
  excludeCurrentSession?: boolean;
  maxAgeDays?: number | null;
}): Promise<
  ApiResponse<{
    context: string;
    memories: Array<{ id: string; summary: string; createdAt: string; similarity: number }>;
    profileInjected: boolean;
  }>
> {
  await ensureInit();
  await embeddingService.warmup();

  const { projectTag, userId } = data;
  const maxMemories = data.maxMemories ?? CONFIG.chatMessage?.maxMemories ?? 3;
  const excludeCurrentSession = data.excludeCurrentSession ?? true;
  const maxAgeDays = data.maxAgeDays ?? null;

  // List memories
  const { scope, hash } = extractScopeFromTag(projectTag);
  const rows = await memoryRepo.list({
    scope: scope as MemoryScopeKind,
    scopeHash: hash,
    containerTag: projectTag,
    limit: maxMemories * 2,
  });

  let memories = rows.map((r) => ({
    id: r.id,
    summary: r.content,
    createdAt: safeToISOString(r.createdAt),
    similarity: 1.0, // listed, not searched — no similarity score
  }));

  // Filter: exclude current session
  if (excludeCurrentSession && data.sessionID) {
    memories = memories.filter((m: any) => m.metadata?.sessionID !== data.sessionID);
  }

  // Filter: max age
  if (maxAgeDays != null && maxAgeDays > 0) {
    const cutoffDate = Date.now() - maxAgeDays * 86400000;
    memories = memories.filter((m: any) => new Date(m.createdAt).getTime() > cutoffDate);
  }

  // Limit
  memories = memories.slice(0, maxMemories);

  // Format context (same logic as context.ts)
  const parts: string[] = ["[MEMORY]"];

  // Inject profile if requested
  let profileInjected = false;
  if (CONFIG.injectProfile && userId) {
    const profile = await profileRepo.getActiveProfile(userId);
    if (profile) {
      try {
        const profileData = JSON.parse(profile.profileData);
        const preferences = profileData?.preferences ?? [];
        const patterns = profileData?.patterns ?? [];
        const workflows = profileData?.workflows ?? [];

        if (preferences.length > 0) {
          parts.push("\nUser Preferences:");
          preferences
            .sort((a: any, b: any) => b.confidence - a.confidence)
            .slice(0, 5)
            .forEach((pref: any) => {
              parts.push(`- [${pref.category}] ${pref.description}`);
            });
        }
        // ... patterns, workflows (same as context.ts:83-100)
        profileInjected = true;
      } catch {
        /* skip corrupt profile */
      }
    }
  }

  if (memories.length > 0) {
    parts.push("\nProject Knowledge:");
    memories.forEach((m) => {
      parts.push(`- ${m.summary}`);
    });
  }

  const context = parts.length > 1 ? parts.join("\n") : "";

  return { success: true, data: { context, memories, profileInjected } };
}
```

**`POST /api/auto-capture`** — `handleAutoCapture(body)`

New handler. Accepts pre-fetched conversation data and runs the AI pipeline server-side. This is the server-side entry point for what is currently `performAutoCapture()` in `src/services/auto-capture.ts`.

```typescript
// src/services/api-handlers.ts — ADD:
export async function handleAutoCapture(data: {
  sessionID: string;
  projectTag: string;
  projectMetadata: {
    displayName?: string;
    userName?: string;
    userEmail?: string;
    projectPath?: string;
    projectName?: string;
    gitRepoUrl?: string;
  };
  conversationMessages: Array<{
    role: string;
    parts: Array<{ type: string; text?: string; tool?: string; state?: any }>;
  }>;
  userPrompt: string;
  promptMessageId: string;
}): Promise<ApiResponse<{ captured: boolean; memoryId?: string }>> {
  await ensureInit();
  await embeddingService.warmup();

  // Same extraction logic as extractAIContent() in auto-capture.ts
  const { textResponses, toolCalls } = extractAIContent(data.conversationMessages);

  if (textResponses.length === 0 && toolCalls.length === 0) {
    return { success: true, data: { captured: false } };
  }

  // Get latest memory for context
  const latestMemory = await getLatestProjectMemory(data.projectTag);

  // Build context
  const context = buildMarkdownContext(data.userPrompt, textResponses, toolCalls, latestMemory);

  // Generate summary via AI
  const summaryResult = await generateSummary(context, data.sessionID, data.userPrompt);

  if (!summaryResult || summaryResult.type === "skip") {
    return { success: true, data: { captured: false } };
  }

  // Create embedding and store
  const embeddingInput =
    summaryResult.tags.length > 0
      ? `${summaryResult.summary}\nTags: ${summaryResult.tags.join(", ")}`
      : summaryResult.summary;

  const vector = await embeddingService.embedWithTimeout(embeddingInput, { kind: "content" });
  let tagsVector: Float32Array | undefined = undefined;
  if (summaryResult.tags.length > 0) {
    tagsVector = await embeddingService.embedWithTimeout(summaryResult.tags.join(", "), {
      kind: "tags",
    });
  }

  const id = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  const now = Date.now();

  await memoryRepo.insert({
    id,
    content: summaryResult.summary,
    vector,
    tagsVector,
    containerTag: data.projectTag,
    tags: summaryResult.tags.length > 0 ? summaryResult.tags.join(",") : undefined,
    type: summaryResult.type as any,
    createdAt: now,
    updatedAt: now,
    metadata: JSON.stringify({
      source: "auto-capture",
      sessionID: data.sessionID,
      promptId: data.promptMessageId,
      captureTimestamp: now,
    }),
    displayName: data.projectMetadata.displayName,
    userName: data.projectMetadata.userName,
    userEmail: data.projectMetadata.userEmail,
    projectPath: data.projectMetadata.projectPath,
    projectName: data.projectMetadata.projectName,
    gitRepoUrl: data.projectMetadata.gitRepoUrl,
  });

  return { success: true, data: { captured: true, memoryId: id } };
}
```

**`POST /api/user-profile/learn`** — `handleUserProfileLearn(body)`

New handler. Accepts prompts and runs profile learning server-side.

```typescript
// src/services/api-handlers.ts — ADD:
export async function handleUserProfileLearn(data: {
  userId: string;
  displayName: string;
  userName: string;
  userEmail: string;
  prompts: Array<{ id: string; content: string }>;
  existingProfile?: any;
}): Promise<ApiResponse<{ updated: boolean }>> {
  await ensureInit();

  // Build analysis context (same as buildUserAnalysisContext in user-memory-learning.ts)
  const context = buildUserAnalysisContext(data.prompts, data.existingProfile || null);

  // Call AI provider
  const updatedProfileData = await analyzeUserProfile(context, data.existingProfile || null);

  if (!updatedProfileData) {
    return { success: true, data: { updated: false } };
  }

  if (data.existingProfile) {
    let profileData = JSON.parse(data.existingProfile.profileData);
    const changeSummary = generateChangeSummary(profileData, updatedProfileData);
    await profileRepo.updateProfile(
      data.existingProfile.id,
      updatedProfileData,
      data.prompts.length,
      changeSummary
    );
  } else {
    await profileRepo.createProfile(
      data.userId,
      data.displayName,
      data.userName,
      data.userEmail,
      updatedProfileData,
      data.prompts.length
    );
  }

  return { success: true, data: { updated: true } };
}
```

### 2.7 Dependency Extraction: What Stays Server-Side

The following modules move entirely to the server and are **removed from the client's import graph**:

| Module                                         | Server           | Client | Notes                                               |
| ---------------------------------------------- | ---------------- | ------ | --------------------------------------------------- |
| `src/services/embedding.ts`                    | ✓                | ✗      | Remote API call, but client never calls it directly |
| `src/services/client.ts` (`LocalMemoryClient`) | ✓ (legacy)       | ✗      | Replaced by `RemoteMemoryClient`                    |
| `src/services/storage/` (all)                  | ✓                | ✗      | Postgres driver, migrations, repositories           |
| `src/services/ai/` (all)                       | ✓                | ✗      | AI provider, tool schemas, validators               |
| `src/services/auto-capture.ts`                 | ✓                | ✗      | Pipeline logic moves to server handler              |
| `src/services/user-memory-learning.ts`         | ✓                | ✗      | Pipeline logic moves to server handler              |
| `src/services/web-server.ts`                   | ✓ (modified)     | ✗      | Now server-only                                     |
| `src/services/jsonc.ts`                        | ✓                | ✓      | Both need JSONC parsing (config files)              |
| `src/services/secret-resolver.ts`              | ✓                | ✓      | Both may resolve `env://` and `file://` secrets     |
| `src/services/logger.ts`                       | ✓                | ✓      | Both log                                            |
| `src/services/context.ts`                      | ✓ (logic inline) | ✓      | Client keeps for local formatting if needed         |
| `src/services/tags.ts`                         | ✗                | ✓      | Client-only: reads git config from local filesystem |
| `src/services/privacy.ts`                      | ✗                | ✓      | Client-only: strips private content before sending  |
| `src/services/language-detector.ts`            | ✓                | ✓      | Both may detect language                            |
| `src/web/`                                     | ✓                | ✗      | Static files served by server                       |

---

## 3. Client Architecture

### 3.1 Entry Point: `src/index.ts` (Simplified)

The client plugin retains the same export signature (`OpenCodeMemPlugin`) and hook structure, but the implementation is drastically simplified. All memory operations delegate to `RemoteMemoryClient`, and all heavy logic (AI, embedding, DB) is removed.

```typescript
// src/index.ts — Simplified client plugin (Phase 2+)
import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import type { Part } from "@opencode-ai/sdk";
import { tool } from "@opencode-ai/plugin";

import { remoteMemoryClient } from "./services/remote-client.js";
import { getTags } from "./services/tags.js";
import { stripPrivateContent, isFullyPrivate } from "./services/privacy.js";

import { isConfigured, CLIENT_CONFIG, initClientConfig } from "./config.js";
import { log } from "./services/logger.js";

export const OpenCodeMemPlugin: Plugin = async (ctx: PluginInput) => {
  const { directory } = ctx;
  initClientConfig(directory);

  if (!isConfigured()) {
    log("Client plugin not configured — check serverUrl and apiKey.");
    return {};
  }

  const tags = await getTags(directory);
  let idleTimeout: Timer | null = null;

  return {
    "chat.message": async (input, output) => {
      if (!isConfigured() || !CLIENT_CONFIG.chatMessage.enabled) return;

      try {
        const textParts = output.parts.filter(
          (p): p is Part & { type: "text"; text: string } => p.type === "text"
        );
        if (textParts.length === 0) return;
        const userMessage = textParts.map((p) => p.text).join("\n");
        if (!userMessage.trim()) return;

        // Fetch context from server
        const ctxResult = await remoteMemoryClient.getContext({
          sessionID: input.sessionID,
          projectTag: tags.project.tag,
          userId: tags.user.userEmail || undefined,
          maxMemories: CLIENT_CONFIG.chatMessage.maxMemories,
          excludeCurrentSession: CLIENT_CONFIG.chatMessage.excludeCurrentSession,
          maxAgeDays: CLIENT_CONFIG.chatMessage.maxAgeDays,
        });

        if (ctxResult.success && ctxResult.data?.context) {
          const contextPart: Part = {
            id: `prt-memory-context-${Date.now()}`,
            sessionID: input.sessionID,
            messageID: output.message.id,
            type: "text",
            text: ctxResult.data.context,
            synthetic: true,
          } as any;
          output.parts.unshift(contextPart);
        }
      } catch (error) {
        log("chat.message: ERROR", { error: String(error) });
        // Graceful degradation: no context injected, but message proceeds
        if (ctx.client?.tui && CLIENT_CONFIG.showErrorToasts) {
          await ctx.client.tui
            .showToast({
              body: {
                title: "Memory System Error",
                message: String(error),
                variant: "error",
                duration: 5000,
              },
            })
            .catch(() => {});
        }
      }
    },

    tool: {
      memory: tool({
        description: `Manage and query project memory. Use 'search' with technical keywords, 'add' to store knowledge.`,
        args: {
          mode: tool.schema.enum(["add", "search", "profile", "list", "forget", "help"]).optional(),
          content: tool.schema.string().optional(),
          query: tool.schema.string().optional(),
          tags: tool.schema.string().optional(),
          type: tool.schema.string().optional(),
          memoryId: tool.schema.string().optional(),
          limit: tool.schema.number().optional(),
          scope: tool.schema.enum(["project", "all-projects"]).optional(),
        },
        async execute(args, toolCtx) {
          if (!isConfigured()) {
            return JSON.stringify({ success: false, error: "Memory system not configured." });
          }

          const mode = args.mode || "help";

          try {
            switch (mode) {
              case "help":
                return JSON.stringify({
                  success: true,
                  message: "Memory System Usage Guide",
                  commands: [
                    {
                      command: "add",
                      description: "Store new memory",
                      args: ["content", "type?", "tags?"],
                    },
                    {
                      command: "search",
                      description: "Search memories via keywords",
                      args: ["query"],
                    },
                    {
                      command: "profile",
                      description: "View or write user profile",
                      args: ["content?"],
                    },
                    { command: "list", description: "List recent memories", args: ["limit?"] },
                    { command: "forget", description: "Remove memory", args: ["memoryId"] },
                  ],
                });

              case "add":
                if (!args.content)
                  return JSON.stringify({ success: false, error: "content required" });
                const sanitized = stripPrivateContent(args.content);
                if (isFullyPrivate(args.content))
                  return JSON.stringify({ success: false, error: "Private content blocked" });
                const result = await remoteMemoryClient.addMemory(sanitized, tags.project.tag, {
                  type: args.type as any,
                  tags: args.tags
                    ? args.tags.split(",").map((t) => t.trim().toLowerCase())
                    : undefined,
                  displayName: tags.project.displayName,
                  userName: tags.project.userName,
                  userEmail: tags.project.userEmail,
                  projectPath: tags.project.projectPath,
                  projectName: tags.project.projectName,
                  gitRepoUrl: tags.project.gitRepoUrl,
                });
                return JSON.stringify({
                  success: result.success,
                  message: "Memory added",
                  id: result.id,
                });

              case "search":
                if (!args.query) return JSON.stringify({ success: false, error: "query required" });
                const searchRes = await remoteMemoryClient.searchMemories(
                  args.query,
                  tags.project.tag,
                  args.scope ?? CLIENT_CONFIG.memory.defaultScope
                );
                return JSON.stringify({
                  success: searchRes.success,
                  query: args.query,
                  count: searchRes.results?.length ?? 0,
                  results: (searchRes.results ?? []).slice(0, args.limit || 10).map((r) => ({
                    id: r.id,
                    content: r.memory || r.chunk,
                    similarity: Math.round(r.similarity * 100),
                  })),
                });

              case "profile": {
                // Read profile from server
                const profileRes = await remoteMemoryClient.getUserProfile(
                  tags.user.userEmail || undefined
                );
                return JSON.stringify({ success: true, profile: profileRes.data ?? null });
              }

              case "list":
                const listRes = await remoteMemoryClient.listMemories(
                  tags.project.tag,
                  args.limit || 20,
                  args.scope ?? CLIENT_CONFIG.memory.defaultScope
                );
                return JSON.stringify({
                  success: listRes.success,
                  count: listRes.memories?.length ?? 0,
                  memories:
                    listRes.memories?.map((m) => ({
                      id: m.id,
                      content: m.summary,
                      createdAt: m.createdAt,
                    })) ?? [],
                });

              case "forget":
                if (!args.memoryId)
                  return JSON.stringify({ success: false, error: "memoryId required" });
                const delRes = await remoteMemoryClient.deleteMemory(args.memoryId);
                return JSON.stringify({ success: delRes.success, message: "Memory removed" });

              default:
                return JSON.stringify({ success: false, error: `Unknown mode: ${mode}` });
            }
          } catch (error) {
            return JSON.stringify({ success: false, error: String(error) });
          }
        },
      }),
    },

    event: async (input: { event: { type: string; properties?: any } }) => {
      const event = input.event;

      if (event.type === "session.idle") {
        if (!isConfigured() || !CLIENT_CONFIG.autoCaptureEnabled) return;
        const sessionID = event.properties?.sessionID;
        if (!sessionID) return;

        if (idleTimeout) clearTimeout(idleTimeout);
        idleTimeout = setTimeout(async () => {
          try {
            // Fetch conversation history
            const messagesResponse = await ctx.client.session.messages({
              path: { id: sessionID },
            });
            const messages = messagesResponse.data || [];

            // Get the last user prompt
            const userMessages = messages.filter((m) => m.info.role === "user");
            const lastUserMsg = userMessages[userMessages.length - 1];
            if (!lastUserMsg) return;

            const userPrompt = lastUserMsg.parts
              .filter((p: any) => p.type === "text")
              .map((p: any) => p.text)
              .join("\n");

            // Send to server for auto-capture
            const captureResult = await remoteMemoryClient.autoCapture({
              sessionID,
              projectTag: tags.project.tag,
              projectMetadata: {
                displayName: tags.project.displayName,
                userName: tags.project.userName,
                userEmail: tags.project.userEmail,
                projectPath: tags.project.projectPath,
                projectName: tags.project.projectName,
                gitRepoUrl: tags.project.gitRepoUrl,
              },
              conversationMessages: messages.map((m: any) => ({
                role: m.info.role,
                parts: m.parts,
              })),
              userPrompt,
              promptMessageId: lastUserMsg.info.id,
            });

            if (
              captureResult.success &&
              captureResult.data?.captured &&
              CLIENT_CONFIG.showAutoCaptureToasts
            ) {
              await ctx.client?.tui
                .showToast({
                  body: {
                    title: "Memory Captured",
                    message: "Project memory saved from conversation",
                    variant: "success",
                    duration: 3000,
                  },
                })
                .catch(() => {});
            }
          } catch (error) {
            log("Idle auto-capture error", { error: String(error) });
          } finally {
            idleTimeout = null;
          }
        }, 10000);
      }

      if (event.type === "session.compacted") {
        if (!isConfigured()) return;
        const sessionID = event.properties?.sessionID;
        if (!sessionID) return;

        try {
          const memoriesResult = await remoteMemoryClient.searchMemoriesBySessionID(
            sessionID,
            tags.project.tag,
            10
          );

          if (!memoriesResult.success || memoriesResult.results.length === 0) return;

          const memoryContext = formatMemoriesForCompaction(memoriesResult.results);

          await ctx.client.session.prompt({
            path: { id: sessionID },
            body: {
              parts: [{ id: `prt-compaction-${Date.now()}`, type: "text", text: memoryContext }],
              noReply: true,
            },
          });
        } catch (error) {
          log("Compaction handler error", { error: String(error) });
        }
      }
    },
  };
};
```

### 3.2 RemoteMemoryClient: `src/services/remote-client.ts`

New file. An HTTP client class that mirrors `LocalMemoryClient`'s interface but delegates to the server API.

```typescript
// src/services/remote-client.ts (NEW)
import { CLIENT_CONFIG } from "../config.js";
import { log } from "./logger.js";

const DEFAULT_TIMEOUT = 30_000; // 30 seconds

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

interface MemoryResult {
  id: string;
  memory?: string;
  chunk?: string;
  similarity: number;
  tags?: string[];
  metadata?: any;
  containerTag?: string;
  displayName?: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
  projectName?: string;
  gitRepoUrl?: string;
  createdAt?: any;
}

export class RemoteMemoryClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeout: number;

  constructor(baseUrl: string, apiKey: string, timeout?: number) {
    this.baseUrl = baseUrl.replace(/\/$/, ""); // strip trailing slash
    this.apiKey = apiKey;
    this.timeout = timeout ?? DEFAULT_TIMEOUT;
  }

  // ─── HTTP Helper ────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string>
  ): Promise<ApiResponse<T>> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      Object.entries(query).forEach(([k, v]) => {
        if (v !== undefined) url.searchParams.set(k, v);
      });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url.toString(), {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const json = (await response.json()) as ApiResponse<T>;

      if (!response.ok) {
        return {
          success: false,
          error: json.error || `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      return json;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("RemoteMemoryClient: request failed", { method, path, error: message });
      return { success: false, error: message };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ─── Context Injection ──────────────────────────────────

  async getContext(params: {
    sessionID?: string;
    projectTag: string;
    userId?: string;
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
    projectMetadata: Record<string, unknown>;
    conversationMessages: any[];
    userPrompt: string;
    promptMessageId: string;
  }): Promise<ApiResponse<{ captured: boolean; memoryId?: string }>> {
    return this.request("POST", "/api/auto-capture", params);
  }

  // ─── Memory CRUD ────────────────────────────────────────

  async searchMemories(
    query: string,
    containerTag: string,
    scope: string = "project"
  ): Promise<ApiResponse<{ results: MemoryResult[]; total: number; timing: number }>> {
    // Uses GET /api/search with query params
    return this.request("GET", "/api/search", undefined, {
      q: query,
      tag: containerTag,
      pageSize: String(CLIENT_CONFIG.memory?.defaultScope === "all-projects" ? 50 : 10),
    }).then((res) => {
      if (!res.success)
        return { success: false, error: res.error, results: [], total: 0, timing: 0 };
      const items = (res.data as any)?.items ?? [];
      return {
        success: true,
        results: items
          .filter((i: any) => i.type === "memory")
          .map((i: any) => ({
            id: i.id,
            memory: i.content,
            similarity: i.similarity ?? 0,
            tags: i.tags,
            metadata: i.metadata,
          })),
        total: items.length,
        timing: 0,
      };
    });
  }

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
      displayName: metadata?.displayName,
      userName: metadata?.userName,
      userEmail: metadata?.userEmail,
      projectPath: metadata?.projectPath,
      projectName: metadata?.projectName,
      gitRepoUrl: metadata?.gitRepoUrl,
    });
  }

  async deleteMemory(memoryId: string): Promise<ApiResponse<void>> {
    return this.request("DELETE", `/api/memories/${memoryId}`);
  }

  async listMemories(
    containerTag: string,
    limit: number = 20,
    scope: string = "project"
  ): Promise<ApiResponse<{ memories: any[]; pagination: any }>> {
    return this.request("GET", "/api/memories", undefined, {
      tag: containerTag,
      pageSize: String(limit),
    }).then((res) => {
      if (!res.success) return { success: false, error: res.error, memories: [], pagination: {} };
      const items = (res.data as any)?.items ?? [];
      return {
        success: true,
        memories: items
          .filter((i: any) => i.type === "memory")
          .map((i: any) => ({
            id: i.id,
            summary: i.content,
            createdAt: i.createdAt,
            metadata: i.metadata,
            displayName: i.displayName,
            userName: i.userName,
            userEmail: i.userEmail,
            projectPath: i.projectPath,
            projectName: i.projectName,
            gitRepoUrl: i.gitRepoUrl,
          })),
        pagination: {
          currentPage: res.data.page,
          totalItems: res.data.total,
          totalPages: res.data.totalPages,
        },
      };
    });
  }

  async searchMemoriesBySessionID(
    sessionID: string,
    containerTag: string,
    limit: number = 10
  ): Promise<ApiResponse<{ results: MemoryResult[]; total: number }>> {
    // Server-side: search by metadata.sessionID in postgres
    return this.request("GET", "/api/search", undefined, {
      q: sessionID, // full-text search on session ID in metadata
      tag: containerTag,
      pageSize: String(limit),
    }).then((res) => {
      if (!res.success) return { success: false, error: res.error, results: [], total: 0 };
      const items = (res.data as any)?.items ?? [];
      return {
        success: true,
        results: items
          .filter((i: any) => i.type === "memory")
          .map((i: any) => ({
            id: i.id,
            memory: i.content,
            similarity: i.similarity ?? 0,
            tags: i.tags,
            metadata: i.metadata,
            displayName: i.displayName,
            userName: i.userName,
            userEmail: i.userEmail,
            projectPath: i.projectPath,
            projectName: i.projectName,
            gitRepoUrl: i.gitRepoUrl,
            createdAt: i.createdAt,
          })),
        total: items.length,
      };
    });
  }

  async getUserProfile(userId?: string): Promise<ApiResponse<any>> {
    const query: Record<string, string> = {};
    if (userId) query.userId = userId;
    return this.request("GET", "/api/user-profile", undefined, query);
  }

  async health(): Promise<{ ok: boolean; status: string }> {
    try {
      const res = await this.request("GET", "/api/health");
      return { ok: res.success, status: res.data?.status ?? "unknown" };
    } catch {
      return { ok: false, status: "unreachable" };
    }
  }
}

// Client singleton
export const remoteMemoryClient = new RemoteMemoryClient(
  CLIENT_CONFIG.serverUrl,
  CLIENT_CONFIG.apiKey
);
```

**Note**: `RemoteMemoryClient` does NOT implement the `MemoryRepository` interface. It implements a simpler contract: the same method names as `LocalMemoryClient`, but using HTTP internally. The response shape is normalized to match what the plugin hooks expect.

### 3.3 Client Configuration: `src/config.ts` (Simplified)

The existing `config.ts` (~694 lines) is reduced to ~100 lines. All DB/embedding/AI config is removed.

```typescript
// src/config.ts — Simplified (Phase 2+)
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { stripJsoncComments } from "./services/jsonc.js";

const CONFIG_DIR = join(homedir(), ".config", "opencode");
const CONFIG_FILES = [
  join(CONFIG_DIR, "opencode-memnet.jsonc"),
  join(CONFIG_DIR, "opencode-memnet.json"),
];

interface ClientConfig {
  serverUrl: string;
  apiKey: string;
  autoCaptureEnabled: boolean;
  showAutoCaptureToasts: boolean;
  showErrorToasts: boolean;
  chatMessage: {
    enabled: boolean;
    maxMemories: number;
    excludeCurrentSession: boolean;
    maxAgeDays?: number;
    injectOn: "first" | "always";
  };
  memory: {
    defaultScope: "project" | "all-projects";
  };
}

const DEFAULTS: ClientConfig = {
  serverUrl: "http://localhost:4747",
  apiKey: "",
  autoCaptureEnabled: true,
  showAutoCaptureToasts: true,
  showErrorToasts: true,
  chatMessage: {
    enabled: true,
    maxMemories: 3,
    excludeCurrentSession: true,
    maxAgeDays: undefined,
    injectOn: "first",
  },
  memory: {
    defaultScope: "project",
  },
};

function loadConfigFromPaths(paths: string[]): Partial<ClientConfig> {
  for (const path of paths) {
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, "utf-8");
        const json = stripJsoncComments(content);
        return JSON.parse(json);
      } catch {
        // ignore parse errors
      }
    }
  }
  return {};
}

function buildConfig(fileConfig: Partial<ClientConfig>): ClientConfig {
  return {
    serverUrl: fileConfig.serverUrl ?? DEFAULTS.serverUrl,
    apiKey: fileConfig.apiKey ?? DEFAULTS.apiKey,
    autoCaptureEnabled: fileConfig.autoCaptureEnabled ?? DEFAULTS.autoCaptureEnabled,
    showAutoCaptureToasts: fileConfig.showAutoCaptureToasts ?? DEFAULTS.showAutoCaptureToasts,
    showErrorToasts: fileConfig.showErrorToasts ?? DEFAULTS.showErrorToasts,
    chatMessage: {
      enabled: fileConfig.chatMessage?.enabled ?? DEFAULTS.chatMessage.enabled,
      maxMemories: fileConfig.chatMessage?.maxMemories ?? DEFAULTS.chatMessage.maxMemories,
      excludeCurrentSession:
        fileConfig.chatMessage?.excludeCurrentSession ?? DEFAULTS.chatMessage.excludeCurrentSession,
      maxAgeDays: fileConfig.chatMessage?.maxAgeDays,
      injectOn: fileConfig.chatMessage?.injectOn ?? DEFAULTS.chatMessage.injectOn,
    },
    memory: {
      defaultScope: fileConfig.memory?.defaultScope ?? DEFAULTS.memory.defaultScope,
    },
  };
}

let _fileConfig = loadConfigFromPaths(CONFIG_FILES);
export let CLIENT_CONFIG = buildConfig(_fileConfig);

export function initClientConfig(directory: string): void {
  const projectPaths = [
    join(directory, ".opencode", "opencode-memnet.jsonc"),
    join(directory, ".opencode", "opencode-memnet.json"),
  ];
  const globalConfig = loadConfigFromPaths(CONFIG_FILES);
  const projectConfig = loadConfigFromPaths(projectPaths);
  const merged = { ...globalConfig, ...projectConfig };

  // Merge nested chatMessage if both sources provide it
  if (globalConfig.chatMessage && projectConfig.chatMessage) {
    merged.chatMessage = { ...globalConfig.chatMessage, ...projectConfig.chatMessage };
  }

  CLIENT_CONFIG = buildConfig(merged);
}

export function isConfigured(): boolean {
  return !!CLIENT_CONFIG.serverUrl && !!CLIENT_CONFIG.apiKey;
}
```

**What is removed from `config.ts`:**

- All `embedding*` fields (~15 config keys)
- All `postgres.*` fields (~8 config keys)
- All `memoryProvider`, `memoryModel`, `memoryApiUrl`, `memoryApiKey`, `memoryTemperature`, `memoryExtraParams`
- All `opencodeProvider`, `opencodeModel`
- All `userProfile*` fields (analysis interval, max prefs/patterns/workflows, confidence decay, changelog retention)
- All `webServer*` fields
- All `compaction.*` fields (moved to server or deprecated)
- `aiSessionRetentionDays` (server-only)
- `containerTagPrefix` (server-only)
- `injectProfile` (server-only, controlled by endpoint)
- `maxMemories`, `similarityThreshold` (server-only)
- `embeddingMaxTokens`, `embeddingTruncationSide` (server-only)
- `userEmailOverride`, `userNameOverride` (now handled by server project metadata)
- `autoCaptureMaxIterations`, `autoCaptureIterationTimeout`, `autoCaptureLanguage` (server-only)
- `storagePath` (no local storage)

### 3.4 Error Handling Strategy

The client handles four failure modes:

| Failure Mode             | Detection                                                     | Behavior                                                                                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Server unreachable**   | `fetch()` throws `TypeError` (DNS/connection refused)         | `chat.message`: skip context injection, message proceeds normally. `tool.memory.*`: return `{ success: false, error: "Server unreachable" }` as JSON. `session.idle`: auto-capture silently fails (log only). |
| **Server timeout**       | `AbortController` fires after `this.timeout` ms (default 30s) | Same as unreachable.                                                                                                                                                                                          |
| **Server returns error** | HTTP 4xx/5xx or `success: false` in JSON body                 | Propagate error to caller. Plugin hooks handle gracefully (no crash).                                                                                                                                         |
| **Invalid API key**      | HTTP 401                                                      | Client config validation at startup catches missing key. If key is revoked mid-session, error propagates as above.                                                                                            |

No retry logic. No exponential backoff. No circuit breaker. These are explicitly out of scope per the spec (section 7.3).

### 3.5 What the Client Keeps (By Import)

From the existing `src/services/` directory, the client only imports:

| Module                          | Reason                                                           |
| ------------------------------- | ---------------------------------------------------------------- |
| `services/remote-client.ts`     | HTTP facade (NEW)                                                |
| `services/tags.ts`              | Extract user/project identity from git config (local filesystem) |
| `services/privacy.ts`           | Strip private content before sending to server                   |
| `services/logger.ts`            | In-process logging                                               |
| `services/language-detector.ts` | Detect language for tool description                             |
| `services/jsonc.ts`             | JSONC comment stripping for config files                         |

Everything else (`embedding.ts`, `client.ts`, `storage/`, `ai/`, `auto-capture.ts`, `user-memory-learning.ts`, `web-server.ts`, `api-handlers.ts`) is **removed from the client import graph** but remains in the repository for the server build.

---

## 4. Data Flow Diagrams

### 4.1 Context Injection Flow

```
User types message
        │
        ▼
OpenCode calls chat.message hook
        │
        ▼
[CLIENT] Strip private content from user message
        │
        ▼
[CLIENT] POST /api/context/inject
        │  Body: { sessionID, projectTag, userId, maxMemories, exclude..., maxAge... }
        │
        ▼
[SERVER] handleContextInject()
        │
        ├──► memoryRepo.list(containerTag, limit)
        │      └──► Postgres: SELECT ... FROM memories WHERE container_tag = $1 ORDER BY created_at DESC LIMIT $2
        │
        ├──► (if userId) profileRepo.getActiveProfile(userId)
        │      └──► Postgres: SELECT ... FROM user_profiles WHERE user_id = $1 AND is_active = true
        │
        ├──► Filter memories: excludeCurrentSession, maxAgeDays, limit
        │
        ├──► Format context string: "[MEMORY]\nUser Preferences:\n- ...\nProject Knowledge:\n- ..."
        │
        └──► Return { context, memories[], profileInjected }
        │
        ▼
[CLIENT] Receive context
        │
        ├──► context empty? → skip injection
        │
        └──► context non-empty?
               │
               ▼
        Create synthetic Part { type: "text", text: context, synthetic: true }
               │
               ▼
        output.parts.unshift(contextPart)
               │
               ▼
        OpenCode sends message (with memory context injected) to LLM
```

### 4.2 Auto-Capture Flow

```
OpenCode fires session.idle event
        │
        ▼
[CLIENT] 10-second debounce (clearTimeout + setTimeout)
        │
        ▼
[CLIENT] Fetch full session messages via ctx.client.session.messages()
        │  Returns: messages[], each with role + parts[]
        │
        ▼
[CLIENT] Find last user message in messages[]
        │  userPrompt = lastUserMsg.parts.filter(text).map(t => t.text).join("\n")
        │
        ▼
[CLIENT] POST /api/auto-capture
        │  Body: { sessionID, projectTag, projectMetadata, conversationMessages[], userPrompt, promptMessageId }
        │
        ▼
[SERVER] handleAutoCapture()
        │
        ├──► extractAIContent(messages): textResponses[], toolCalls[]
        │
        ├──► getLatestProjectMemory(projectTag)
        │      └──► Postgres: SELECT ... FROM memories WHERE container_tag = $1 ORDER BY created_at DESC LIMIT 1
        │
        ├──► buildMarkdownContext(userPrompt, textResponses, toolCalls, latestMemory)
        │
        ├──► generateSummary(context, sessionID, userPrompt)
        │      │
        │      ├──► (if opencodeProvider configured)
        │      │      └──► generateStructuredOutput(client, provider, model, systemPrompt, userPrompt, schema)
        │      │             └──► OpenAI Chat Completions API with structured output
        │      │
        │      └──► (if memoryProvider configured)
        │             └──► AIProviderFactory → provider.executeToolCall(systemPrompt, userPrompt, toolSchema, sessionID)
        │                    └──► OpenAI Chat Completions API with function calling
        │      │
        │      └──► Returns: { summary, type, tags[] } or null (skip)
        │
        ├──► (if type === "skip") → return { captured: false }
        │
        └──► (otherwise)
               │
               ├──► embeddingService.embedWithTimeout(content, { kind: "content" })
               │      └──► POST {embeddingApiUrl}/embeddings → Float32Array[1024]
               │
               ├──► (if tags) embeddingService.embedWithTimeout(tags.join(", "), { kind: "tags" })
               │
               ├──► memoryRepo.insert({ id, content, vector, tagsVector, containerTag, tags, type, ...metadata })
               │      └──► Postgres: INSERT INTO memories (...) VALUES (...)
               │
               └──► Return { captured: true, memoryId }
        │
        ▼
[CLIENT] Receive response
        │
        ├──► captured: true + CLIENT_CONFIG.showAutoCaptureToasts
        │      └──► ctx.client.tui.showToast("Memory Captured")
        │
        └──► captured: false or error
               └──► silent (no toast)
```

### 4.3 Memory CRUD Flow (Tool Call)

```
User invokes tool.memory add "Fixed login bug"
        │
        ▼
[CLIENT] tool.memory execute("add", { content: "Fixed login bug" })
        │
        ├──► Strip private content
        ├──► Build projectMetadata from tags (git config)
        │
        ▼
[CLIENT] POST /api/memories
        │  Body: { content: "Fixed login bug", containerTag: "opencode_project_a1b2c3", type: "bug-fix", tags: ["auth","login"], displayName, userName, userEmail, ... }
        │
        ▼
[SERVER] handleAddMemory()
        │
        ├──► embeddingService.embedWithTimeout(content + tags, { kind: "content" })
        │      └──► POST {embeddingApiUrl}/embeddings → Float32Array[1024]
        │
        ├──► (if tags) embeddingService.embedWithTimeout(tags.join(", "), { kind: "tags" })
        │
        ├──► memoryRepo.insert(record)
        │      └──► Postgres: INSERT INTO memories (id, content, vector, tags_vector, container_tag, tags, type, ...) VALUES (...)
        │
        └──► Return { success: true, data: { id: "mem_..." } }
        │
        ▼
[CLIENT] Return JSON string to OpenCode tool output
```

---

## 5. Deployment

### 5.1 Dockerfile

```dockerfile
# Dockerfile
FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY src/ ./src/
RUN bunx tsc
RUN mkdir -p dist/web && cp -r src/web/* dist/web/

FROM oven/bun:1-slim
WORKDIR /app
COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/node_modules/ ./node_modules/
COPY package.json ./

EXPOSE 4747
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:4747/api/health').then(r=>r.json()).then(d=>{if(d.status!=='ok')process.exit(1)})"

ENV SERVER_HOST=0.0.0.0
ENV SERVER_PORT=4747

CMD ["bun", "run", "dist/server.js"]
```

### 5.2 Environment Variables (Required)

```bash
# REQUIRED
POSTGRES_URL=postgresql://user:pass@host:5432/dbname
EMBEDDING_API_URL=https://api.openai.com/v1
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_API_KEY=sk-...
SERVER_API_KEY=your-secret-api-key-here

# OPTIONAL (with defaults shown)
SERVER_PORT=4747
SERVER_HOST=0.0.0.0
POSTGRES_SSL=require
POSTGRES_MAX_CONNECTIONS=10
MEMORY_MODEL=gpt-4o-mini
MEMORY_API_URL=https://api.openai.com/v1
MEMORY_API_KEY=sk-...
SIMILARITY_THRESHOLD=0.6
MAX_MEMORIES=10
INJECT_PROFILE=true
AUTO_CAPTURE_LANGUAGE=auto
```

### 5.3 docker-compose.yml (Development)

```yaml
version: "3.8"
services:
  db:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: opencode
      POSTGRES_PASSWORD: opencode
      POSTGRES_DB: opencode_mem
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  server:
    build: .
    ports:
      - "4747:4747"
    environment:
      POSTGRES_URL: postgresql://opencode:opencode@db:5432/opencode_mem
      POSTGRES_SSL: "false"
      EMBEDDING_API_URL: ${EMBEDDING_API_URL}
      EMBEDDING_MODEL: ${EMBEDDING_MODEL}
      EMBEDDING_API_KEY: ${EMBEDDING_API_KEY}
      SERVER_API_KEY: ${SERVER_API_KEY:-dev-key}
      MEMORY_MODEL: ${MEMORY_MODEL:-gpt-4o-mini}
      MEMORY_API_URL: ${MEMORY_API_URL}
      MEMORY_API_KEY: ${MEMORY_API_KEY}
    depends_on:
      - db

volumes:
  pgdata:
```

### 5.4 Health Check

```
GET /api/health → 200 OK

{
  "status": "ok",            // "ok" | "degraded" | "initializing"
  "version": "2.14.3",
  "dbConnected": true,       // Postgres pool alive + migrations complete
  "embeddingReady": true,    // Embedding service warmup complete
  "uptime": 123456           // Milliseconds since server start
}
```

- `"initializing"`: server is starting up, migrations running, or embedding warming.
- `"degraded"`: one of db or embedding is not ready. Server still responds but some endpoints may fail.
- `"ok"`: both db and embedding are ready.

### 5.5 Migration Handling

Database migrations run automatically during `initializeStorage()` at server startup. This is the same behavior as the current plugin (lazy initialization on first use). The difference: startup happens once at process boot, not on first API call.

Migrations live in `src/services/storage/postgres/migrations/` and are unchanged. They remain idempotent (each checks if already applied).

If a migration fails, the server logs the error and exits with code 1. No partial startup.

---

## 6. Migration Path (File-by-File Changes)

### 6.1 Phase 1 — Standalone Server (Week 1-2)

| Action        | File(s)                          | Description                                                                                                                                                                    |
| ------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **CREATE**    | `src/server.ts`                  | Standalone server entry point (see 2.1)                                                                                                                                        |
| **CREATE**    | `src/server-config.ts`           | Environment variable config loader (see 2.3)                                                                                                                                   |
| **CREATE**    | `src/services/auth.ts`           | `AuthMiddleware` class (see 2.4)                                                                                                                                               |
| **CREATE**    | `src/services/health-handler.ts` | `handleHealth()` function (see 2.6.3)                                                                                                                                          |
| **MODIFY**    | `src/services/web-server.ts`     | Add `apiKey` constructor param, inject `AuthMiddleware.authenticate()` into `handleRequest()`, remove takeover/health check loop, remove `isServerOwner()`/`attemptTakeover()` |
| **MODIFY**    | `src/services/web-server.ts`     | Change `startWebServer()` signature to accept `apiKey: string`                                                                                                                 |
| **MODIFY**    | `src/services/api-handlers.ts`   | Add `handleHealth` export                                                                                                                                                      |
| **CREATE**    | `Dockerfile`                     | Multi-stage Bun build (see 5.1)                                                                                                                                                |
| **CREATE**    | `docker-compose.yml`             | Dev environment with PostgreSQL (see 5.3)                                                                                                                                      |
| **MODIFY**    | `package.json`                   | Add `"server"` export pointing to `dist/server.js`, add `"start:server": "bun run src/server.ts"` script                                                                       |
| **NO CHANGE** | All other files                  | Existing plugin code remains untouched                                                                                                                                         |

**Verification**: `bun run src/server.ts` starts and serves on port 4747. Existing plugin continues working. API calls require API key.

### 6.2 Phase 2 — Thin Client Plugin (Week 3-4)

| Action        | File(s)                         | Description                                                                                                                                        |
| ------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CREATE**    | `src/services/remote-client.ts` | `RemoteMemoryClient` class (see 3.2)                                                                                                               |
| **MODIFY**    | `src/index.ts`                  | Replace `LocalMemoryClient` calls with `RemoteMemoryClient`. Remove warmup, web server startup, shutdown handler. Simplify hooks (see 3.1).        |
| **MODIFY**    | `src/config.ts`                 | Strip to client-only config (see 3.3). Keep old config loading for backward compat.                                                                |
| **MODIFY**    | `src/plugin.ts`                 | Add conditional export: if server config present, load old plugin; if client config present, load new thin plugin. (Or use separate entry points.) |
| **NO CHANGE** | Server files                    | Server is already running from Phase 1                                                                                                             |

**Verification**: Both old and new plugins work side-by-side against same Postgres. `chat.message` injection produces identical output.

### 6.3 Phase 3 — Server-Side Auto-Capture and Profile Learning (Week 5-6)

| Action        | File(s)                                | Description                                                                                                                                                                                                                                |
| ------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **MODIFY**    | `src/services/api-handlers.ts`         | Add `handleAutoCapture()`, `handleContextInject()`, `handleUserProfileLearn()` handlers (see 2.6.3)                                                                                                                                        |
| **MODIFY**    | `src/services/web-server.ts`           | Add routes for new endpoints: `POST /api/context/inject`, `POST /api/auto-capture`, `POST /api/user-profile/learn`                                                                                                                         |
| **REFACTOR**  | `src/services/auto-capture.ts`         | Extract reusable functions (`extractAIContent`, `buildMarkdownContext`, `getLatestProjectMemory`, `generateSummary`) so both the plugin path and the server handler can use them. OR duplicate the extraction logic in the server handler. |
| **REFACTOR**  | `src/services/user-memory-learning.ts` | Extract reusable functions (`buildUserAnalysisContext`, `analyzeUserProfile`, `generateChangeSummary`) for server handler use.                                                                                                             |
| **MODIFY**    | `src/index.ts` (client)                | Update `session.idle` handler to call `remoteMemoryClient.autoCapture()`.                                                                                                                                                                  |
| **NO CHANGE** | Storage, embedding, AI                 | Pipelines run the same logic, just triggered by HTTP instead of plugin hooks.                                                                                                                                                              |

### 6.4 Phase 4 — Decommission (Week 7)

| Action                        | File(s)                        | Description                                                                                                                                                                                                                |
| ----------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **REMOVE** from client bundle | `src/services/client.ts`       | `LocalMemoryClient` no longer imported by `src/index.ts`                                                                                                                                                                   |
| **REMOVE** from client bundle | `src/services/embedding.ts`    | No longer imported by client                                                                                                                                                                                               |
| **REMOVE** from client bundle | `src/services/storage/`        | Postgres driver and repositories no longer client deps                                                                                                                                                                     |
| **REMOVE** from client bundle | `src/services/ai/`             | AI provider no longer client dep                                                                                                                                                                                           |
| **REMOVE** from client bundle | `src/services/web-server.ts`   | Web server is server-only                                                                                                                                                                                                  |
| **REMOVE** from client bundle | `src/services/api-handlers.ts` | Handlers are server-only (may be shared if extracted, but client doesn't import)                                                                                                                                           |
| **MODIFY**                    | `package.json`                 | Update `"files"` array if needed. Update `"dependencies"` (remove `postgres`, `zod`, `franc-min`, `iso-639-3` from client deps — keep for server). Consider splitting into separate packages or using conditional exports. |
| **MODIFY**                    | `README.md`                    | Document both deployment modes                                                                                                                                                                                             |
| **KEEP** (as legacy)          | All removed client files       | Remain in repository for the in-process plugin path (not imported by thin client)                                                                                                                                          |

### 6.5 API Versioning

No API versioning is implemented in v1 (explicitly out of scope per spec section 7.5). The server API is a single version. Backward compatibility is maintained by preserving all existing endpoint shapes.

Future versioning strategy (post-v1) could use URL path prefix (`/api/v2/...`) or request headers (`Accept: application/vnd.opencode-memnet.v2+json`).

---

## 7. Error Handling

### 7.1 Server Error Taxonomy

| HTTP Status | Meaning               | When                                                      |
| ----------- | --------------------- | --------------------------------------------------------- |
| `200`       | Success               | `success: true` in body                                   |
| `400`       | Bad request           | Missing required field, invalid parameters                |
| `401`       | Unauthorized          | Missing or invalid API key                                |
| `404`       | Not found             | Memory/prompt/profile ID doesn't exist                    |
| `413`       | Payload too large     | Request body > 10MB                                       |
| `500`       | Internal server error | Unhandled exception, DB failure, embedding API failure    |
| `503`       | Service unavailable   | Server starting up, DB not connected, embedding not ready |

### 7.2 Client Error Handling Pattern

Every `RemoteMemoryClient` method returns `ApiResponse<T>`:

```typescript
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
```

The client plugin checks `success` before accessing `data`. On failure, it returns a JSON error string for tool calls, or gracefully degrades for hooks (skip context injection, skip auto-capture).

### 7.3 Timeout Behavior

- **Client**: Every HTTP request has a 30-second timeout via `AbortController`. If timed out, the `fetch` call throws `AbortError`, caught by the `catch` block in `RemoteMemoryClient.request()`, which returns `{ success: false, error: "The operation was aborted due to timeout" }`.
- **Server**: No per-request timeout enforced at the HTTP level (Bun's default applies). Long operations (auto-capture AI calls) are bounded by the AI provider's own timeout (`AUTO_CAPTURE_ITERATION_TIMEOUT`, default 30s).

---

## 8. Package Structure

### 8.1 Dual Export Strategy

The repository serves two deployment modes from the same codebase:

```json
{
  "exports": {
    ".": {
      "import": "./dist/plugin.js",
      "types": "./dist/index.d.ts"
    },
    "./server": {
      "import": "./dist/server.js",
      "types": "./dist/index.d.ts"
    }
  }
}
```

- `import "opencode-memnet"` → Thin client plugin (`src/index.ts` → `dist/plugin.js`)
- `import "opencode-memnet/server"` → Server entry (`src/server.ts` → `dist/server.js`)

### 8.2 Build Scripts

```json
{
  "scripts": {
    "build": "bunx tsc && mkdir -p dist/web && cp -r src/web/* dist/web/",
    "build:server": "bunx tsc --project tsconfig.server.json && mkdir -p dist/web && cp -r src/web/* dist/web/",
    "dev": "tsc --watch",
    "start:server": "bun run dist/server.js",
    "dev:server": "bun run --watch src/server.ts",
    "typecheck": "tsc --noEmit"
  }
}
```

### 8.3 Dependencies

**Server dependencies** (in addition to shared):

- `postgres` — PostgreSQL client
- `zod` — Schema validation (for structured AI output)
- `franc-min` + `iso-639-3` — Language detection

**Client dependencies** (shared only):

- `@opencode-ai/plugin` — OpenCode plugin SDK
- `@opencode-ai/sdk` — OpenCode types

---

## 9. Risks and Mitigations

| Risk                                  | Impact                                                               | Mitigation                                                                                                                                                             |
| ------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Latency on chat.message**           | User perceives delay before LLM receives message                     | `injectOn: "first"` (default) means only first message in session triggers server call. Server responses target < 200ms (local network).                               |
| **Server dependency**                 | Plugin non-functional if server is down                              | Graceful degradation: no context injection, memory tool returns error, auto-capture silently skips. Plugin never crashes.                                              |
| **Auto-capture payload size**         | Large conversation histories may exceed HTTP body limits             | Server enforces 10MB body limit. Client sends only relevant messages (non-synthetic). For extremely long sessions, truncation strategy may be needed (Phase 3 detail). |
| **Config drift**                      | Server and client configs disagree on behavior (e.g., `maxMemories`) | Client sends its preferences in each request body. Server honors client overrides where applicable.                                                                    |
| **Tag format compatibility**          | Old plugin uses `opencode_project_<hash>`, new client must match     | Tag format is unchanged. Both old and new write to same schema.                                                                                                        |
| **OpenCode SDK dependency on client** | `ctx.client.session.messages()` is needed for auto-capture           | This stays on the client — the client fetches messages and sends them to the server. The server does NOT need the OpenCode SDK.                                        |

---

## 10. Open Questions

1. **Should the server support the OpenCode provider path for auto-capture?** The current code supports `opencodeProvider` + `opencodeModel` for AI calls via the OpenCode SDK. In the server-client split, the server won't have access to `ctx.client` (OpenCode's internal API). Options:
   - **Drop it**: Server only supports `memoryModel`/`memoryApiUrl`/`memoryApiKey` (direct API calls).
   - **Pass OpenCode client data to server**: Unwieldy and breaks separation.
   - **Hybrid**: Client does the AI call via OpenCode SDK, sends the result to the server for storage.

   _Recommendation: Drop OpenCode provider support from the server. The server only calls OpenAI-compatible APIs directly. Users who want to use their OpenCode provider for auto-capture can continue using the in-process plugin._

2. **Should the old and new plugins share the same npm package?** Currently one package. Options:
   - Single package with conditional exports (recommended for Phase 2).
   - Separate packages: `opencode-memnet` (thin client) and `opencode-memnet-server` (server).

   _Recommendation: Single package initially. Split only if dependency conflicts or size becomes an issue._

3. **What happens to the `session.compacted` hook?** It currently injects memory context post-compaction via `ctx.client.session.prompt()`. This is an OpenCode SDK call that must remain client-side. The client fetches memories from the server and injects them locally. No architectural issue.
