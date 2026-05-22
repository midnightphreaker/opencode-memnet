# opencode-mem Server-Client Split — Implementation Guide

## v1.0

This document is the concrete, file-level execution plan. Every step is numbered and verifiable. Run them in order.

---

## 0. Pre-requisites

### 0.1 State Before Starting

| Check                     | Command                                                                               | Expected                        |
| ------------------------- | ------------------------------------------------------------------------------------- | ------------------------------- |
| Working tree clean        | `git status --porcelain`                                                              | empty (or only untracked files) |
| Current plugin builds     | `bun run build`                                                                       | exits 0                         |
| Current plugin typechecks | `bun run typecheck`                                                                   | exits 0                         |
| Postgres available        | `psql -c "SELECT 1"` on your test DB                                                  | exits 0                         |
| Embedding API reachable   | `curl -s $EMBEDDING_API_URL/embeddings -H "Authorization: Bearer $EMBEDDING_API_KEY"` | returns valid response          |
| SPEC.md exists            | `ls SPEC.md`                                                                          | file exists                     |
| DESIGN.md exists          | `ls DESIGN.md`                                                                        | file exists                     |

### 0.2 Create a Feature Branch

```bash
git checkout -b feat/server-client-split
```

### 0.3 Test Database

Set up a test PostgreSQL instance with pgvector. For local development, use the docker-compose from Phase 1 Step 5.

```bash
# Quick local Postgres with pgvector:
docker run -d --name pgvector-test \
  -e POSTGRES_USER=opencode \
  -e POSTGRES_PASSWORD=opencode \
  -e POSTGRES_DB=opencode_mem \
  -p 5432:5432 \
  pgvector/pgvector:pg16
```

Export the connection string:

```bash
export POSTGRES_URL=postgresql://opencode:opencode@localhost:5432/opencode_mem
```

---

## 1. Phase 1 — Standalone Server (Week 1)

**Goal**: A headless Bun process that starts, connects to Postgres, runs migrations, warms up embeddings, and serves the API + WebUI. The existing plugin continues to work unchanged.

**Acceptance criteria**: AC-001 through AC-008 from SPEC.md.

### Step 1.1: Create `src/server-config.ts`

**Action**: CREATE new file.

**File**: `src/server-config.ts`

This file replaces `src/config.ts` for the server. It reads exclusively from environment variables (no file-based config needed, though a JSONC fallback can be added later). The key difference: it has no `initConfig(directory)` method, no project-directory concept, and no OpenCode plugin dependency.

```typescript
// src/server-config.ts
import { resolveSecretValue } from "./services/secret-resolver.js";

export interface ServerConfig {
  port: number;
  host: string;
  serverApiKey: string;
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
  similarityThreshold: number;
  maxMemories: number;
  injectProfile: boolean;
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
  userProfileAnalysisInterval: number;
  userProfileMaxPreferences: number;
  userProfileMaxPatterns: number;
  userProfileMaxWorkflows: number;
  userProfileConfidenceDecayDays: number;
  userProfileChangelogRetentionCount: number;
  webServerAllowedOrigin: string;
}

function getEmbeddingDimensions(model: string): number {
  const dimensionMap: Record<string, number> = {
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
    "text-embedding-ada-002": 1536,
    "embed-english-v3.0": 1024,
    "embed-multilingual-v3.0": 1024,
    "embed-english-light-v3.0": 384,
    "embed-multilingual-light-v3.0": 384,
    "text-embedding-004": 768,
    "text-multilingual-embedding-002": 768,
    "voyage-3": 1024,
    "voyage-3-lite": 512,
    "voyage-code-3": 1024,
  };
  return dimensionMap[model] || 1024;
}

let _config: ServerConfig | null = null;

export function initServerConfig(): ServerConfig {
  if (_config) return _config;

  const env = process.env;

  _config = {
    port: parseInt(env.SERVER_PORT || "4747"),
    host: env.SERVER_HOST || "0.0.0.0",
    serverApiKey: env.SERVER_API_KEY || "",

    postgres: {
      url: resolveSecretValue(env.POSTGRES_URL) || "",
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
    embeddingApiKey: resolveSecretValue(env.EMBEDDING_API_KEY || "") || env.OPENAI_API_KEY || "",
    embeddingDimensions:
      parseInt(env.EMBEDDING_DIMENSIONS || "0") ||
      getEmbeddingDimensions(env.EMBEDDING_MODEL || ""),
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
    memoryModel: env.MEMORY_MODEL || undefined,
    memoryApiUrl: env.MEMORY_API_URL || undefined,
    memoryApiKey: resolveSecretValue(env.MEMORY_API_KEY || "") || undefined,
    memoryTemperature:
      env.MEMORY_TEMPERATURE === "false"
        ? false
        : env.MEMORY_TEMPERATURE
          ? parseFloat(env.MEMORY_TEMPERATURE)
          : 0.3,
    opencodeProvider: env.OPENCODE_PROVIDER || undefined,
    opencodeModel: env.OPENCODE_MODEL || undefined,
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

  return _config;
}

export function getServerConfig(): ServerConfig {
  if (!_config) throw new Error("Server config not initialized. Call initServerConfig() first.");
  return _config;
}

export function validateServerConfig(config: ServerConfig): string[] {
  const errors: string[] = [];
  if (!config.postgres.url) errors.push("POSTGRES_URL is required");
  if (!config.embeddingApiUrl) errors.push("EMBEDDING_API_URL is required");
  if (!config.embeddingModel) errors.push("EMBEDDING_MODEL is required");
  if (!config.embeddingApiKey) errors.push("EMBEDDING_API_KEY is required (or OPENAI_API_KEY)");
  if (!config.serverApiKey) errors.push("SERVER_API_KEY is required");
  return errors;
}
```

**Verification**:

```bash
# Should parse env vars without errors
SERVER_PORT=4747 POSTGRES_URL=test EMBEDDING_API_URL=test EMBEDDING_MODEL=test EMBEDDING_API_KEY=test SERVER_API_KEY=test \
  bun -e "const {initServerConfig,validateServerConfig}=require('./src/server-config.ts'); const c=initServerConfig(); console.log(validateServerConfig(c))"
# Expected: [] (no errors)
```

---

### Step 1.2: Create `src/services/auth.ts`

**Action**: CREATE new file.

**File**: `src/services/auth.ts`

Simple API key validation middleware. No external dependencies.

```typescript
// src/services/auth.ts

export class AuthMiddleware {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) throw new Error("SERVER_API_KEY is required");
    this.apiKey = apiKey;
  }

  /**
   * Validates the Authorization header.
   * Returns null if authenticated, or a 401 Response if not.
   */
  authenticate(req: Request): Response | null {
    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      return this.unauthorized("Missing Authorization header");
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      return this.unauthorized("Invalid Authorization format. Use: Bearer <key>");
    }

    if (parts[1] !== this.apiKey) {
      return this.unauthorized("Invalid API key");
    }

    return null;
  }

  private unauthorized(message: string): Response {
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
}
```

**Verification**:

```bash
# Quick unit test
bun -e "
const {AuthMiddleware}=require('./src/services/auth.ts');
const a=new AuthMiddleware('test-key');
const r1=a.authenticate(new Request('http://localhost/api/test'));
console.log('No header:', r1?.status); // 401
const r2=a.authenticate(new Request('http://localhost/api/test', {headers:{Authorization:'Bearer test-key'}}));
console.log('Valid:', r2); // null
const r3=a.authenticate(new Request('http://localhost/api/test', {headers:{Authorization:'Bearer wrong'}}));
console.log('Invalid:', r3?.status); // 401
"
```

---

### Step 1.3: Create `src/services/health-handler.ts`

**Action**: CREATE new file.

**File**: `src/services/health-handler.ts`

```typescript
// src/services/health-handler.ts
import { embeddingService } from "./embedding.js";

let _dbConnected = false;
const _startTime = Date.now();

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
  const embReady = embeddingService.isWarmedUp;
  return {
    status: _dbConnected && embReady ? "ok" : "degraded",
    version: "2.14.3",
    dbConnected: _dbConnected,
    embeddingReady: embReady,
    uptime: Date.now() - _startTime,
  };
}
```

---

### Step 1.4: Modify `src/services/web-server.ts`

**Action**: MODIFY existing file. This is the most invasive change in Phase 1.

**File**: `src/services/web-server.ts` (currently ~471 lines)

**Changes needed**:

#### 1.4.1 Update imports

Add at the top (after existing imports):

```typescript
import { AuthMiddleware } from "./auth.js";
```

#### 1.4.2 Update the constructor

**Find** (around line 47-49):

```typescript
constructor(config: WebServerConfig) {
  this.config = config;
  this.allowedOrigin = config.allowedOrigin ?? CONFIG.webServerAllowedOrigin ?? "*";
}
```

**Replace with**:

```typescript
constructor(config: WebServerConfig, apiKey: string) {
  this.config = config;
  this.allowedOrigin = config.allowedOrigin ?? "*";
  this.auth = new AuthMiddleware(apiKey);
}
```

#### 1.4.3 Add `auth` field to class

Add as a class property:

```typescript
export class WebServer {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private config: WebServerConfig;
  private isOwner: boolean = false;
  private startPromise: Promise<void> | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private onTakeoverCallback: (() => Promise<void>) | null = null;
  private readonly allowedOrigin: string;
  private readonly auth: AuthMiddleware;  // <-- ADD THIS LINE
```

#### 1.4.4 Add auth check in `handleRequest`

**Find** (around line 214-219):

```typescript
private async handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  try {
    // Handle CORS preflight
    if (method === "OPTIONS") {
```

**Add auth check after the method variable and before the try block, inside `handleRequest`**:

Insert these lines after `const method = req.method;` and before `try {`:

```typescript
// Auth: CORS preflight skips auth (SRV-016)
if (method !== "OPTIONS") {
  // Auth: API routes require API key (except health)
  if (path.startsWith("/api/") && path !== "/api/health") {
    const authError = this.auth.authenticate(req);
    if (authError) return authError;
  }
}
```

**Important**: Move the `const method = req.method;` line before the auth check, and restructure the CORS handler so it's AFTER the `try {` block opens, since the CORS preflight response needs the same CORS headers as other responses. The complete structure should be:

```typescript
private async handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // CORS preflight (no auth — SRV-016)
  if (method === "OPTIONS") {
    const headers = new Headers();
    headers.set("Access-Control-Allow-Origin", this.allowedOrigin);
    headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    headers.set("Access-Control-Max-Age", "86400");
    if (this.allowedOrigin !== "*") {
      headers.set("Vary", "Origin");
    }
    return new Response(null, { status: 204, headers });
  }

  // Auth: all /api/* routes (except health) require API key
  if (path.startsWith("/api/") && path !== "/api/health") {
    const authError = this.auth.authenticate(req);
    if (authError) return authError;
  }

  try {
    // ... rest of existing route handling (static files, API endpoints) ...
```

#### 1.4.5 Remove takeover-related code

**Delete** these methods entirely:

- `startHealthCheckLoop()` (lines 97-110)
- `stopHealthCheckLoop()` (lines 112-117)
- `attemptTakeover()` (lines 119-148)
- `checkServerAvailable()` (lines 175-185)

**Delete** these class properties:

- `healthCheckInterval`
- `onTakeoverCallback`

**Delete** this method:

- `setOnTakeoverCallback()` (lines 52-54)

**Delete** the `isOwner` logic. The constructor no longer sets `this.isOwner = true` on success. Instead, always set `this.isOwner = true` if `Bun.serve()` succeeds, or throw if port is in use (no silent fallback to non-owner mode).

**Replace** the `_start()` method (lines 65-95) with:

```typescript
private async _start(): Promise<void> {
  if (!this.config.enabled) return;

  try {
    this.server = Bun.serve({
      port: this.config.port,
      hostname: this.config.host,
      fetch: this.handleRequest.bind(this),
    });
    this.isOwner = true;
  } catch (error) {
    const errorMsg = String(error);
    log("Web server failed to start", { error: errorMsg });
    throw error; // No silent fallback — fail fast
  }
}
```

#### 1.4.6 Update `startWebServer()` function signature

**Find** (around line 467):

```typescript
export async function startWebServer(config: WebServerConfig): Promise<WebServer> {
  const server = new WebServer(config);
  await server.start();
  return server;
}
```

**Replace with**:

```typescript
export async function startWebServer(config: WebServerConfig, apiKey: string): Promise<WebServer> {
  const server = new WebServer(config, apiKey);
  await server.start();
  return server;
}
```

#### 1.4.7 Update `stop()` method

The `stop()` method still works but remove the `this.startPromise = null` line since it's no longer needed. Actually keep it as a defensive reset.

#### 1.4.8 Remove `isServerOwner()` method

Remove the `isServerOwner()` method (lines 167-169) since it's no longer meaningful (server always owns the port now).

#### 1.4.9 Add health endpoint route

**Find** the route handling block (after the auth check, inside `try {`). Add this route before the 404 fallback:

```typescript
if (path === "/api/health" && method === "GET") {
  const { handleHealth } = await import("./health-handler.js");
  const result = handleHealth();
  return this.jsonResponse(result);
}
```

**Verification**: `bun run build` should still succeed (though the old plugin path may have type errors from the changed `startWebServer` signature — that's expected and fixed in Step 1.5).

---

### Step 1.5: Create `src/server.ts`

**Action**: CREATE new file.

**File**: `src/server.ts`

```typescript
// src/server.ts — Standalone server entry point
import { initServerConfig, validateServerConfig, getServerConfig } from "./server-config.js";
import { initializeStorage } from "./services/storage/factory.js";
import { embeddingService } from "./services/embedding.js";
import { setDbConnected } from "./services/health-handler.js";
import { startWebServer } from "./services/web-server.js";
import { log } from "./services/logger.js";

async function main(): Promise<void> {
  log("opencode-mem server starting...");

  // 1. Load and validate config
  const config = initServerConfig();
  const errors = validateServerConfig(config);
  if (errors.length > 0) {
    console.error("Configuration errors:");
    errors.forEach((e) => console.error("  -", e));
    process.exit(1);
  }

  // 2. Initialize storage (runs DB migrations)
  try {
    await initializeStorage();
    setDbConnected(true);
    log("Storage initialized (migrations complete)");
  } catch (error) {
    console.error("Failed to initialize storage:", error);
    process.exit(1);
  }

  // 3. Warm up embedding service
  try {
    await embeddingService.warmup();
    log("Embedding service ready");
  } catch (error) {
    console.error("Failed to warm up embedding service:", error);
    process.exit(1);
  }

  // 4. Start HTTP server
  try {
    const server = await startWebServer(
      {
        port: config.port,
        host: config.host,
        enabled: true,
        allowedOrigin: config.webServerAllowedOrigin,
      },
      config.serverApiKey
    );

    log(`Server listening on http://${config.host}:${config.port}`);
    log(`WebUI: http://${config.host}:${config.port}/`);
    log(`Health: http://${config.host}:${config.port}/api/health`);

    // 5. Graceful shutdown
    const shutdown = async () => {
      log("Shutting down...");
      try {
        await server.stop();
      } catch (e) {
        log("Error stopping server", { error: String(e) });
      }
      try {
        const { closeStorage } = await import("./services/storage/factory.js");
        await closeStorage();
      } catch (e) {
        log("Error closing storage", { error: String(e) });
      }
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

main();
```

**Verification**: Start the server in one terminal, test in another.

```bash
# Terminal 1: Start server
SERVER_API_KEY=test-key \
POSTGRES_URL=$POSTGRES_URL \
EMBEDDING_API_URL=$EMBEDDING_API_URL \
EMBEDDING_MODEL=$EMBEDDING_MODEL \
EMBEDDING_API_KEY=$EMBEDDING_API_KEY \
bun run src/server.ts

# Terminal 2: Test
curl -s http://localhost:4747/api/health | jq
# Expected: {"status":"ok","version":"2.14.3","dbConnected":true,"embeddingReady":true}

curl -s http://localhost:4747/api/stats | jq
# Expected: 401 Unauthorized

curl -s -H "Authorization: Bearer test-key" http://localhost:4747/api/stats | jq
# Expected: {"success":true,"data":{"total":0,"byScope":{"user":0,"project":0},"byType":{}}}

curl -s -H "Authorization: Bearer test-key" -H "Content-Type: application/json" \
  -d '{"content":"Test memory","containerTag":"opencode_project_test"}' \
  http://localhost:4747/api/memories | jq
# Expected: {"success":true,"data":{"id":"mem_..."}}
```

---

### Step 1.6: Create `Dockerfile` and `docker-compose.yml`

**Action**: CREATE new files.

#### `Dockerfile`

```dockerfile
# Build stage
FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY src/ ./src/
RUN bunx tsc
RUN mkdir -p dist/web && cp -r src/web/* dist/web/

# Runtime stage
FROM oven/bun:1-slim
WORKDIR /app
COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/node_modules/ ./node_modules/
COPY package.json ./

EXPOSE 4747

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD bun -e "fetch('http://localhost:4747/api/health').then(r=>r.json()).then(d=>{if(d.status!=='ok')process.exit(1)})"

ENV SERVER_HOST=0.0.0.0
ENV SERVER_PORT=4747

CMD ["bun", "run", "dist/server.js"]
```

#### `docker-compose.yml`

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
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U opencode -d opencode_mem"]
      interval: 5s
      timeout: 3s
      retries: 5

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
      MEMORY_MODEL: ${MEMORY_MODEL:-}
      MEMORY_API_URL: ${MEMORY_API_URL:-}
      MEMORY_API_KEY: ${MEMORY_API_KEY:-}
    depends_on:
      db:
        condition: service_healthy

volumes:
  pgdata:
```

**Verification**:

```bash
# Build and run
EMBEDDING_API_URL="..." EMBEDDING_MODEL="..." EMBEDDING_API_KEY="..." \
  docker compose up -d

sleep 5
curl -s -H "Authorization: Bearer dev-key" http://localhost:4747/api/health | jq
# Expected: {"status":"ok",...}

docker compose down
```

---

### Step 1.7: Update `package.json` Scripts

**Action**: MODIFY `package.json`.

**Find** the `"scripts"` block and add:

```json
{
  "scripts": {
    "build": "bunx tsc && mkdir -p dist/web && cp -r src/web/* dist/web/",
    "dev": "tsc --watch",
    "start:server": "bun run dist/server.js",
    "dev:server": "bun run --watch src/server.ts",
    "typecheck": "tsc --noEmit",
    "format": "prettier --write \"src/**/*.{ts,js,css,html}\"",
    "format:check": "prettier --check \"src/**/*.{ts,js,css,html}\"",
    "prepare": "husky"
  }
}
```

Also update the `"exports"` field to add a server export:

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

---

### Step 1.8: Phase 1 Verification Checklist

| #   | Check                  | Command                                                         | Expected                                     |
| --- | ---------------------- | --------------------------------------------------------------- | -------------------------------------------- |
| 1   | Server starts          | `bun run src/server.ts` (with env vars)                         | Logs "Server listening on..."                |
| 2   | Health endpoint        | `curl localhost:4747/api/health`                                | `{"status":"ok",...}`                        |
| 3   | Auth rejection         | `curl localhost:4747/api/stats`                                 | HTTP 401                                     |
| 4   | Auth success           | `curl -H "Authorization: Bearer $KEY" localhost:4747/api/stats` | HTTP 200 with data                           |
| 5   | Memory CRUD            | POST a memory, GET it back, DELETE it                           | All work with auth                           |
| 6   | WebUI loads            | Browser → `http://localhost:4747/`                              | WebUI renders (API key needed for API calls) |
| 7   | Docker build           | `docker build -t opencode-mem-server .`                         | Build succeeds                               |
| 8   | Docker compose         | `docker compose up -d` with env vars                            | Server starts, health OK                     |
| 9   | Old plugin still works | Run existing plugin against same DB                             | No regression                                |

---

## 2. Phase 2 — Remote Client Plugin (Weeks 2-3)

**Goal**: A thin OpenCode plugin that communicates exclusively with the server over HTTP. Old plugin and new plugin run side-by-side.

**Acceptance criteria**: AC-009 through AC-016 from SPEC.md.

### Step 2.1: Create `src/services/remote-client.ts`

**Action**: CREATE new file.

**File**: `src/services/remote-client.ts`

This is the HTTP client that replaces `LocalMemoryClient`. It implements the same logical interface: `searchMemories`, `addMemory`, `listMemories`, `deleteMemory`, `searchMemoriesBySessionID`, plus new methods `getContext`, `autoCapture`, `getUserProfile`.

```typescript
// src/services/remote-client.ts
import { CLIENT_CONFIG } from "../config.js";
import { log } from "./logger.js";

const DEFAULT_TIMEOUT = 30_000;

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export class RemoteMemoryClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeout: number;

  constructor(baseUrl: string, apiKey: string, timeout?: number) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.timeout = timeout ?? DEFAULT_TIMEOUT;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | undefined>
  ): Promise<ApiResponse<T>> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) url.searchParams.set(k, v);
      }
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
          error: json.error || `HTTP ${response.status}`,
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

  // ─── Memory Search ──────────────────────────────────────

  async searchMemories(
    query: string,
    containerTag: string,
    scope: string = "project"
  ): Promise<{
    success: boolean;
    error?: string;
    results: any[];
    total: number;
    timing: number;
  }> {
    const res = await this.request("GET", "/api/search", undefined, {
      q: query,
      tag: containerTag,
      pageSize: "20",
    });
    if (!res.success) {
      return { success: false, error: res.error, results: [], total: 0, timing: 0 };
    }
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
  ): Promise<{
    success: boolean;
    error?: string;
    memories: any[];
    pagination: any;
  }> {
    const res = await this.request("GET", "/api/memories", undefined, {
      tag: containerTag,
      pageSize: String(limit),
    });
    if (!res.success) {
      return { success: false, error: res.error, memories: [], pagination: {} };
    }
    const items = (res.data as any)?.items ?? [];
    const memories = items
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
      }));
    return {
      success: true,
      memories,
      pagination: {
        currentPage: res.data?.page ?? 1,
        totalItems: res.data?.total ?? memories.length,
        totalPages: res.data?.totalPages ?? 1,
      },
    };
  }

  async searchMemoriesBySessionID(
    sessionID: string,
    containerTag: string,
    limit: number = 10
  ): Promise<{
    success: boolean;
    error?: string;
    results: any[];
    total: number;
    timing: number;
  }> {
    const res = await this.request("GET", "/api/search", undefined, {
      q: sessionID,
      tag: containerTag,
      pageSize: String(limit),
    });
    if (!res.success) {
      return { success: false, error: res.error, results: [], total: 0, timing: 0 };
    }
    const items = (res.data as any)?.items ?? [];
    const results = items
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
      }));
    return { success: true, results, total: results.length, timing: 0 };
  }

  // ─── User Profile ───────────────────────────────────────

  async getUserProfile(userId?: string): Promise<ApiResponse<any>> {
    const query: Record<string, string> = {};
    if (userId) query.userId = userId;
    return this.request("GET", "/api/user-profile", undefined, query);
  }
}

// Module-level singleton
let _client: RemoteMemoryClient | null = null;

export function getRemoteClient(): RemoteMemoryClient {
  if (_client) return _client;
  _client = new RemoteMemoryClient(CLIENT_CONFIG.serverUrl, CLIENT_CONFIG.apiKey);
  return _client;
}

// For backward compat with current code, export a named instance:
export const remoteMemoryClient = getRemoteClient();
```

---

### Step 2.2: Simplify `src/config.ts` for Client

**Action**: MODIFY existing file.

**File**: `src/config.ts` (currently ~694 lines)

**Strategy**: Keep the existing file working for the old plugin, but add a parallel `initClientConfig()` / `CLIENT_CONFIG` export that only loads the client-required fields. The old `CONFIG` and `initConfig()` remain for backward compat. Do NOT remove old config fields in this phase.

**Add** after the existing `CONFIG` export (around line 624) and before `validateConfig()`:

```typescript
// ── Client-only config (for thin remote plugin) ───────────────

export interface ClientConfig {
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

const CLIENT_DEFAULTS: ClientConfig = {
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

function buildClientConfig(fileConfig: Partial<ClientConfig>): ClientConfig {
  return {
    serverUrl: fileConfig.serverUrl ?? CLIENT_DEFAULTS.serverUrl,
    apiKey: fileConfig.apiKey ?? CLIENT_DEFAULTS.apiKey,
    autoCaptureEnabled: fileConfig.autoCaptureEnabled ?? CLIENT_DEFAULTS.autoCaptureEnabled,
    showAutoCaptureToasts:
      fileConfig.showAutoCaptureToasts ?? CLIENT_DEFAULTS.showAutoCaptureToasts,
    showErrorToasts: fileConfig.showErrorToasts ?? CLIENT_DEFAULTS.showErrorToasts,
    chatMessage: {
      enabled: fileConfig.chatMessage?.enabled ?? CLIENT_DEFAULTS.chatMessage.enabled,
      maxMemories: fileConfig.chatMessage?.maxMemories ?? CLIENT_DEFAULTS.chatMessage.maxMemories,
      excludeCurrentSession:
        fileConfig.chatMessage?.excludeCurrentSession ??
        CLIENT_DEFAULTS.chatMessage.excludeCurrentSession,
      maxAgeDays: fileConfig.chatMessage?.maxAgeDays,
      injectOn: (fileConfig.chatMessage?.injectOn ?? CLIENT_DEFAULTS.chatMessage.injectOn) as
        | "first"
        | "always",
    },
    memory: {
      defaultScope: fileConfig.memory?.defaultScope ?? CLIENT_DEFAULTS.memory.defaultScope,
    },
  };
}

export let CLIENT_CONFIG = buildClientConfig({});

export function initClientConfig(directory: string): void {
  const projectPaths = [
    join(directory, ".opencode", "opencode-mem.jsonc"),
    join(directory, ".opencode", "opencode-mem.json"),
  ];
  const globalConfig = loadConfigFromPaths(CONFIG_FILES) as Partial<ClientConfig>;
  const projectConfig = loadConfigFromPaths(projectPaths) as Partial<ClientConfig>;

  // Shallow merge for top-level keys, deep merge for chatMessage
  const merged: Partial<ClientConfig> = { ...globalConfig, ...projectConfig };
  if (globalConfig.chatMessage && projectConfig.chatMessage) {
    merged.chatMessage = { ...globalConfig.chatMessage, ...projectConfig.chatMessage };
  }
  if (globalConfig.memory && projectConfig.memory) {
    merged.memory = { ...globalConfig.memory, ...projectConfig.memory };
  }

  CLIENT_CONFIG = buildClientConfig(merged);
}

// Client is configured if serverUrl and apiKey are set
export function isClientConfigured(): boolean {
  return !!CLIENT_CONFIG.serverUrl && !!CLIENT_CONFIG.apiKey;
}
```

**Note**: The existing `isConfigured()`, `CONFIG`, and `initConfig()` remain untouched so the old in-process plugin continues to work.

**Verification**: `bun run typecheck` should pass.

---

### Step 2.3: Create Simplified Plugin `src/index-remote.ts`

**Action**: CREATE new file.

**File**: `src/index-remote.ts`

This is the thin client plugin. It imports `RemoteMemoryClient` instead of `LocalMemoryClient`.

```typescript
// src/index-remote.ts — Thin remote client plugin
import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import type { Part } from "@opencode-ai/sdk";
import { tool } from "@opencode-ai/plugin";

import { remoteMemoryClient } from "./services/remote-client.js";
import { getTags } from "./services/tags.js";
import { stripPrivateContent, isFullyPrivate } from "./services/privacy.js";
import { getLanguageName } from "./services/language-detector.js";

import { isClientConfigured, CLIENT_CONFIG, initClientConfig } from "./config.js";
import { log } from "./services/logger.js";
import type { MemoryType } from "./types/index.js";

export const OpenCodeMemPlugin: Plugin = async (ctx: PluginInput) => {
  const { directory } = ctx;
  initClientConfig(directory);

  if (!isClientConfigured()) {
    log("Remote plugin not configured — check serverUrl and apiKey in config.");
    return {};
  }

  const tags = await getTags(directory);
  let idleTimeout: Timer | null = null;
  let captureInProgress = false;

  return {
    "chat.message": async (input, output) => {
      if (!isClientConfigured() || !CLIENT_CONFIG.chatMessage.enabled) return;

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

        if (ctxResult.success && ctxResult.data && ctxResult.data.context) {
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
        // Graceful degradation: message proceeds without context
      }
    },

    tool: {
      memory: tool({
        description: `Manage and query project memory`,
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
          if (!isClientConfigured()) {
            return JSON.stringify({ success: false, error: "Memory system not configured." });
          }

          const mode = args.mode || "help";

          try {
            switch (mode) {
              case "help":
                return JSON.stringify({
                  success: true,
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
                    { command: "profile", description: "View user profile", args: [] },
                    { command: "list", description: "List recent memories", args: ["limit?"] },
                    { command: "forget", description: "Remove memory", args: ["memoryId"] },
                  ],
                });

              case "add": {
                if (!args.content)
                  return JSON.stringify({ success: false, error: "content required" });
                const sanitized = stripPrivateContent(args.content);
                if (isFullyPrivate(args.content))
                  return JSON.stringify({ success: false, error: "Private content blocked" });
                const parsedTags = args.tags
                  ? args.tags.split(",").map((t) => t.trim().toLowerCase())
                  : undefined;
                const result = await remoteMemoryClient.addMemory(sanitized, tags.project.tag, {
                  type: args.type as any,
                  tags: parsedTags,
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
                  id: result.data?.id,
                });
              }

              case "search": {
                if (!args.query) return JSON.stringify({ success: false, error: "query required" });
                const res = await remoteMemoryClient.searchMemories(
                  args.query,
                  tags.project.tag,
                  args.scope ?? CLIENT_CONFIG.memory.defaultScope
                );
                return JSON.stringify({
                  success: res.success,
                  query: args.query,
                  count: res.results.length,
                  results: res.results.slice(0, args.limit || 10).map((r: any) => ({
                    id: r.id,
                    content: r.memory || r.chunk,
                    similarity: Math.round((r.similarity || 0) * 100),
                  })),
                });
              }

              case "profile": {
                const profileRes = await remoteMemoryClient.getUserProfile(
                  tags.user.userEmail || undefined
                );
                return JSON.stringify({ success: true, profile: profileRes.data ?? null });
              }

              case "list": {
                const res = await remoteMemoryClient.listMemories(
                  tags.project.tag,
                  args.limit || 20,
                  args.scope ?? CLIENT_CONFIG.memory.defaultScope
                );
                return JSON.stringify({
                  success: res.success,
                  count: res.memories.length,
                  memories: res.memories.map((m: any) => ({
                    id: m.id,
                    content: m.summary,
                    createdAt: m.createdAt,
                  })),
                });
              }

              case "forget": {
                if (!args.memoryId)
                  return JSON.stringify({ success: false, error: "memoryId required" });
                const res = await remoteMemoryClient.deleteMemory(args.memoryId);
                return JSON.stringify({ success: res.success, message: "Memory removed" });
              }

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
        if (!isClientConfigured() || !CLIENT_CONFIG.autoCaptureEnabled) return;
        const sessionID = event.properties?.sessionID;
        if (!sessionID) return;

        if (idleTimeout) clearTimeout(idleTimeout);
        if (captureInProgress) return;

        idleTimeout = setTimeout(async () => {
          captureInProgress = true;
          try {
            const messagesResponse = await ctx.client.session.messages({
              path: { id: sessionID },
            });
            const messages = messagesResponse.data || [];

            const userMessages = messages.filter((m: any) => m.info.role === "user");
            const lastUserMsg = userMessages[userMessages.length - 1];
            if (!lastUserMsg) return;

            const userPrompt = lastUserMsg.parts
              .filter((p: any) => p.type === "text")
              .map((p: any) => p.text)
              .join("\n");

            // Fire-and-forget to server
            remoteMemoryClient
              .autoCapture({
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
              })
              .then((result) => {
                if (
                  result.success &&
                  result.data?.captured &&
                  CLIENT_CONFIG.showAutoCaptureToasts
                ) {
                  ctx.client?.tui
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
              });
          } catch (error) {
            log("Idle auto-capture error", { error: String(error) });
          } finally {
            idleTimeout = null;
            captureInProgress = false;
          }
        }, 10000);
      }

      if (event.type === "session.compacted") {
        const sessionID = event.properties?.sessionID;
        if (!sessionID) return;

        try {
          const memoriesResult = await remoteMemoryClient.searchMemoriesBySessionID(
            sessionID,
            tags.project.tag,
            10
          );

          if (!memoriesResult.success || memoriesResult.results.length === 0) return;

          let output = `## Restored Session Memory\n\n`;
          memoriesResult.results.forEach((m: any, i: number) => {
            if (m.memory == null) return;
            output += `### Memory ${i + 1}\n${m.memory}\n\n`;
            if (m.tags && m.tags.length > 0) {
              output += `Tags: ${m.tags.join(", ")}\n\n`;
            }
          });

          await ctx.client.session.prompt({
            path: { id: sessionID },
            body: {
              parts: [{ id: `prt-compaction-${Date.now()}`, type: "text", text: output }],
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

---

### Step 2.4: Update `src/plugin.ts` to Support Dual Exports

**Action**: MODIFY `src/plugin.ts`.

**File**: `src/plugin.ts` (currently 8 lines)

Add a conditional export. When a user configures `serverUrl` in their config file, load the remote plugin. Otherwise, load the in-process plugin.

```typescript
// src/plugin.ts
import type { PluginModule } from "@opencode-ai/plugin";
import pkg from "../package.json" with { type: "json" };

export const id =
  typeof pkg.name === "string" && pkg.name.trim() ? pkg.name.trim() : "opencode-mem";

// Detect mode based on config file presence
// If serverUrl is configured, use the remote thin client
// Otherwise, use the in-process plugin (backward compat)
async function resolvePlugin() {
  try {
    // Try loading config to check for serverUrl
    const { initClientConfig } = await import("./config.js");
    initClientConfig(process.cwd());
    const { isClientConfigured } = await import("./config.js");
    if (isClientConfigured()) {
      const { OpenCodeMemPlugin } = await import("./index-remote.js");
      return OpenCodeMemPlugin;
    }
  } catch {
    // Fall through to in-process plugin
  }

  const { OpenCodeMemPlugin } = await import("./index.js");
  return OpenCodeMemPlugin;
}

const OpenCodeMemPlugin = await resolvePlugin();
export { OpenCodeMemPlugin };
export default { id, server: OpenCodeMemPlugin } satisfies PluginModule;
```

**Note**: This pattern keeps backward compatibility. If no `serverUrl` is configured, the old plugin loads. If `serverUrl` is present, the thin client loads.

---

### Step 2.5: Add New API Endpoints to `src/services/api-handlers.ts`

**Action**: MODIFY `src/services/api-handlers.ts` (currently ~1017 lines).

Add the new handlers for `handleContextInject`, `handleAutoCapture`, and `handleUserProfileLearn`.

**Warning**: The `handleAutoCapture` and `handleUserProfileLearn` handlers call functions from `auto-capture.ts` and `user-memory-learning.ts`. For Phase 2, these call the existing functions, but they also call `ctx.client.session.messages()` which is an OpenCode SDK call not available in the server context. For Phase 2, implement `handleContextInject` fully, but stub `handleAutoCapture` and `handleUserProfileLearn` with a "server-side not yet implemented" response. Full implementation happens in Phase 3.

#### Add at the end of `api-handlers.ts`:

```typescript
// ── New endpoints for server-client architecture ────────────

// Phase 2: handleContextInject — fully implemented
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
  try {
    await ensureInit();

    const maxMemories = data.maxMemories ?? CONFIG.chatMessage?.maxMemories ?? 3;
    const excludeCurrentSession = data.excludeCurrentSession ?? true;
    const maxAgeDays = data.maxAgeDays ?? null;

    // List memories for this project tag
    const { scope, hash } = extractScopeFromTag(data.projectTag);
    const rows = await memoryRepo.list({
      scope: scope as MemoryScopeKind,
      scopeHash: hash,
      containerTag: data.projectTag,
      limit: maxMemories * 3,
    });

    let memories = rows.map((r) => ({
      id: r.id,
      summary: r.content,
      createdAt: safeToISOString(r.createdAt),
      similarity: 1.0,
      _metadata: r.metadata,
    }));

    // Filter: exclude current session
    if (excludeCurrentSession && data.sessionID) {
      memories = memories.filter((m: any) => {
        try {
          const meta = typeof m._metadata === "string" ? JSON.parse(m._metadata) : m._metadata;
          return meta?.sessionID !== data.sessionID;
        } catch {
          return true;
        }
      });
    }

    // Filter: max age
    if (maxAgeDays != null && maxAgeDays > 0) {
      const cutoffDate = Date.now() - maxAgeDays * 86400000;
      memories = memories.filter((m: any) => new Date(m.createdAt).getTime() > cutoffDate);
    }

    memories = memories.slice(0, maxMemories);

    // Format context
    const parts: string[] = ["[MEMORY]"];
    let profileInjected = false;

    // Profile
    if (CONFIG.injectProfile && data.userId) {
      const profile = await profileRepo.getActiveProfile(data.userId);
      if (profile) {
        try {
          const profileData = JSON.parse(profile.profileData);
          const preferences = (profileData?.preferences ?? []).sort(
            (a: any, b: any) => b.confidence - a.confidence
          );
          const patterns = (profileData?.patterns ?? []).sort(
            (a: any, b: any) => b.frequency - a.frequency
          );
          const workflows = profileData?.workflows ?? [];

          if (preferences.length > 0) {
            parts.push("\nUser Preferences:");
            preferences.slice(0, 5).forEach((pref: any) => {
              parts.push(`- [${pref.category}] ${pref.description}`);
            });
          }
          if (patterns.length > 0) {
            parts.push("\nUser Patterns:");
            patterns.slice(0, 5).forEach((pat: any) => {
              parts.push(`- [${pat.category}] ${pat.description}`);
            });
          }
          if (workflows.length > 0) {
            parts.push("\nUser Workflows:");
            workflows.slice(0, 3).forEach((wf: any) => {
              parts.push(`- ${wf.description}`);
            });
          }
          profileInjected = true;
        } catch {
          // skip corrupt profile
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

    return {
      success: true,
      data: {
        context,
        memories: memories.map(({ _metadata, ...rest }) => rest),
        profileInjected,
      },
    };
  } catch (error) {
    log("handleContextInject: error", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

// Phase 2: Stub — full implementation in Phase 3
export async function handleAutoCapture(
  _data: any
): Promise<ApiResponse<{ captured: boolean; memoryId?: string }>> {
  return {
    success: false,
    error: "Server-side auto-capture not yet implemented. Use in-process plugin for auto-capture.",
  };
}

// Phase 2: Stub — full implementation in Phase 3
export async function handleUserProfileLearn(
  _data: any
): Promise<ApiResponse<{ updated: boolean }>> {
  return {
    success: false,
    error:
      "Server-side profile learning not yet implemented. Use in-process plugin for profile learning.",
  };
}
```

#### Add routes in `web-server.ts` for the new endpoints

**In `web-server.ts`**, add these route handlers in the try block, before the 404 fallback:

```typescript
if (path === "/api/context/inject" && method === "POST") {
  const body = await this.parseBody(req);
  const result = await (await import("./api-handlers.js")).handleContextInject(body);
  return this.jsonResponse(result);
}

if (path === "/api/auto-capture" && method === "POST") {
  const body = await this.parseBody(req);
  const result = await (await import("./api-handlers.js")).handleAutoCapture(body);
  return this.jsonResponse(result);
}

if (path === "/api/user-profile/learn" && method === "POST") {
  const body = await this.parseBody(req);
  const result = await (await import("./api-handlers.js")).handleUserProfileLearn(body);
  return this.jsonResponse(result);
}
```

---

### Step 2.6: Phase 2 Verification Checklist

| #   | Check                          | Command / Action                                       | Expected                                     |
| --- | ------------------------------ | ------------------------------------------------------ | -------------------------------------------- |
| 1   | Build passes                   | `bun run build && bun run typecheck`                   | No errors                                    |
| 2   | Old plugin still works         | Run OpenCode with old config (no `serverUrl`)          | All existing functionality                   |
| 3   | Client config loads            | Add `serverUrl` + `apiKey` to config, restart OpenCode | Thin plugin activates                        |
| 4   | chat.message context injection | Post a message in a project with memories              | `[MEMORY]` block injected before LLM sees it |
| 5   | tool.memory add                | `tool.memory add "Test memory"`                        | Memory appears in server DB and WebUI        |
| 6   | tool.memory search             | `tool.memory search "test"`                            | Returns matching memories                    |
| 7   | tool.memory list               | `tool.memory list`                                     | Returns recent memories                      |
| 8   | tool.memory forget             | `tool.memory forget <id>`                              | Memory deleted                               |
| 9   | Server unreachable             | Stop the server, post a message                        | Message proceeds without context (no crash)  |
| 10  | Invalid API key                | Change API key, post a message                         | Graceful degradation (no crash)              |

---

## 3. Phase 3 — Move Capture & Learning to Server (Week 4)

**Goal**: Auto-capture and profile learning run on the server. Client sends conversation data, server handles the AI pipeline and storage.

**Acceptance criteria**: AC-017 through AC-021 from SPEC.md.

### Step 3.1: Implement `handleAutoCapture` in `api-handlers.ts`

**Action**: MODIFY `src/services/api-handlers.ts`.

**Replace** the stub `handleAutoCapture` with:

```typescript
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
  try {
    await ensureInit();
    await embeddingService.warmup();

    // ── Extract AI content (same logic as auto-capture.ts extractAIContent) ──
    const textResponses: string[] = [];
    const toolCalls: Array<{ name: string; input: string }> = [];

    for (const msg of data.conversationMessages) {
      if (msg.role !== "assistant") continue;
      if (!Array.isArray(msg.parts)) continue;

      for (const part of msg.parts) {
        if (part.type === "text" && part.text?.trim()) {
          textResponses.push(part.text.trim());
        }
        if (part.type === "tool") {
          const name = part.tool || "unknown";
          let input = "";
          if (part.state?.input) {
            const inputObj = part.state.input;
            if (typeof inputObj === "string") {
              input = inputObj;
            } else if (typeof inputObj === "object") {
              input = Object.entries(inputObj)
                .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
                .join(", ");
            }
          }
          if (input.length > 100) input = input.substring(0, 100) + "...";
          toolCalls.push({ name, input });
        }
      }
    }

    if (textResponses.length === 0 && toolCalls.length === 0) {
      return { success: true, data: { captured: false } };
    }

    // ── Get latest memory for context ──
    let latestMemory: string | null = null;
    const { scope, hash } = extractScopeFromTag(data.projectTag);
    const recentRows = await memoryRepo.list({
      scope: scope as MemoryScopeKind,
      scopeHash: hash,
      containerTag: data.projectTag,
      limit: 1,
    });
    if (recentRows.length > 0 && recentRows[0].content) {
      const content = recentRows[0].content;
      latestMemory = content.length <= 500 ? content : content.substring(0, 500) + "...";
    }

    // ── Build context for AI ──
    const context = buildMarkdownContextForCapture(
      data.userPrompt,
      textResponses,
      toolCalls,
      latestMemory
    );

    // ── Generate summary via AI ──
    const summaryResult = await generateCaptureSummary(context, data.sessionID, data.userPrompt);

    if (!summaryResult || summaryResult.type === "skip") {
      return { success: true, data: { captured: false } };
    }

    // ── Embed and store ──
    const embeddingInput =
      summaryResult.tags.length > 0
        ? `${summaryResult.summary}\nTags: ${summaryResult.tags.join(", ")}`
        : summaryResult.summary;

    const vector = await embeddingService.embedWithTimeout(embeddingInput, { kind: "content" });
    let tagsVector: Float32Array | undefined;
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
  } catch (error) {
    log("handleAutoCapture: error", { error: String(error) });
    return { success: false, error: String(error) };
  }
}

// ── Helpers (same logic as auto-capture.ts) ──

function buildMarkdownContextForCapture(
  userPrompt: string,
  textResponses: string[],
  toolCalls: Array<{ name: string; input: string }>,
  latestMemory: string | null
): string {
  const sections: string[] = [];
  if (latestMemory) {
    sections.push(`## Previous Memory Context\n---\n${latestMemory}\n---\n`);
  }
  sections.push(`## User Request\n---\n${userPrompt}\n---\n`);
  if (textResponses.length > 0) {
    sections.push(`## AI Response\n---\n${textResponses.join("\n\n")}\n---\n`);
  }
  if (toolCalls.length > 0) {
    sections.push("## Tools Used\n---");
    for (const tool of toolCalls) {
      sections.push(`- ${tool.name}${tool.input ? `(${tool.input})` : ""}`);
    }
    sections.push("---\n");
  }
  return sections.join("\n");
}

async function generateCaptureSummary(
  context: string,
  sessionID: string,
  userPrompt: string
): Promise<{ summary: string; type: string; tags: string[] } | null> {
  // Use the existing auto-capture AI logic from auto-capture.ts
  // but call the AI provider directly (not via ctx.client)
  // For Phase 3, import and use the existing generateSummary from auto-capture.ts
  // after adapting it to not require PluginInput
  const { generateSummary } = await import("./auto-capture-server.js");
  return generateSummary(context, sessionID, userPrompt);
}
```

### Step 3.2: Create `src/services/auto-capture-server.ts`

**Action**: CREATE new file.

**File**: `src/services/auto-capture-server.ts`

This extracts the `generateSummary` function from `auto-capture.ts` and adapts it to not require `PluginInput` or `ctx.client`. The core AI provider call logic is unchanged.

```typescript
// src/services/auto-capture-server.ts
// Server-side auto-capture: AI provider calls without OpenCode plugin dependency

import { CONFIG, getServerConfig } from "../server-config.js";
import { log } from "./logger.js";

export async function generateSummary(
  context: string,
  sessionID: string,
  userPrompt: string
): Promise<{ summary: string; type: string; tags: string[] } | null> {
  const serverConfig = getServerConfig();

  // OpenCode provider path is NOT supported on the server.
  // The server calls the AI provider API directly.
  if (!serverConfig.memoryModel || !serverConfig.memoryApiUrl) {
    throw new Error(
      "Server requires MEMORY_MODEL and MEMORY_API_URL for auto-capture. " +
        "Set these environment variables."
    );
  }

  const { AIProviderFactory } = await import("./ai/ai-provider-factory.js");
  const { buildMemoryProviderConfig } = await import("./ai/provider-config.js");
  const { detectLanguage, getLanguageName } = await import("./language-detector.js");

  const providerConfig = buildMemoryProviderConfig(serverConfig as any);
  const provider = AIProviderFactory.createProvider(serverConfig.memoryProvider, providerConfig);

  const targetLang =
    serverConfig.autoCaptureLanguage === "auto" || !serverConfig.autoCaptureLanguage
      ? detectLanguage(userPrompt)
      : serverConfig.autoCaptureLanguage;
  const langName = getLanguageName(targetLang);

  const systemPrompt = `You are a technical memory recorder for a software development project.

RULES:
1. ONLY capture technical work (code, bugs, features, architecture, config)
2. SKIP non-technical by returning type="skip"
3. NO meta-commentary or behavior analysis
4. Include specific file names, functions, technical details
5. Generate 2-4 technical tags (e.g., "react", "auth", "bug-fix")
6. You MUST write the summary in ${langName}.

FORMAT:
## Request
[1-2 sentences: what was requested, in ${langName}]

## Outcome
[1-2 sentences: what was done, include files/functions, in ${langName}]

SKIP if: greetings, casual chat, no code/decisions made
CAPTURE if: code changed, bug fixed, feature added, decision made`;

  const aiPrompt = `${context}

Analyze this conversation. If it contains technical work (code, bugs, features, decisions), create a concise summary and relevant tags. If it's non-technical (greetings, casual chat, incomplete requests), return type="skip" with empty summary.`;

  const toolSchema = {
    type: "function" as const,
    function: {
      name: "save_memory",
      description: "Save the conversation summary as a memory",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "Markdown-formatted summary" },
          type: {
            type: "string",
            description: "Type: 'skip' for non-technical, or technical type",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "2-4 technical tags",
          },
        },
        required: ["summary", "type", "tags"],
      },
    },
  };

  const result = await provider.executeToolCall(systemPrompt, aiPrompt, toolSchema, sessionID);

  if (!result.success || !result.data) {
    throw new Error(result.error || "Failed to generate summary");
  }

  return {
    summary: result.data.summary,
    type: result.data.type,
    tags: (result.data.tags || []).map((t: string) => t.toLowerCase().trim()),
  };
}
```

### Step 3.3: Implement `handleUserProfileLearn` in `api-handlers.ts`

**Action**: MODIFY `src/services/api-handlers.ts`.

**Replace** the stub with the full implementation, following the same extraction pattern — reuse the AI logic from `user-memory-learning.ts` but adapted for server-side (no `PluginInput` dependency).

(Same pattern as Step 3.1 — extract `buildUserAnalysisContext`, `analyzeUserProfile`, and `generateChangeSummary` into a separate server-friendly module and call them from the handler.)

### Step 3.4: Phase 3 Verification Checklist

| #   | Check                              | Command / Action                                                                                                                     | Expected                                                                     |
| --- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 1   | Auto-capture endpoint              | `curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{...}' http://localhost:4747/api/auto-capture` | Returns `{ success: true, data: { captured: true/false, memoryId: "..." } }` |
| 2   | Technical conversation captured    | Send a technical conversation payload                                                                                                | `captured: true`, memory created in DB                                       |
| 3   | Non-technical conversation skipped | Send "hello, how are you?" conversation                                                                                              | `captured: false`                                                            |
| 4   | Memory has auto-capture source     | Check created memory metadata                                                                                                        | `source: "auto-capture"`                                                     |
| 5   | Tags generated                     | Check created memory                                                                                                                 | Has 2-4 AI-generated tags                                                    |

---

## 4. Phase 4 — Decommission In-Process Path (Week 5)

**Goal**: Remove the in-process code from the client plugin. The server is the sole owner of Postgres, embeddings, AI provider, and WebUI.

**Acceptance criteria**: AC-022 through AC-026 from SPEC.md.

### Step 4.1: Make Remote Plugin the Default

**Action**: MODIFY `src/plugin.ts`.

Change the auto-detection logic so the remote plugin is preferred. Keep the in-process plugin as a fallback but log a deprecation warning.

```typescript
// src/plugin.ts — Phase 4 update
import type { PluginModule } from "@opencode-ai/plugin";
import pkg from "../package.json" with { type: "json" };

export const id =
  typeof pkg.name === "string" && pkg.name.trim() ? pkg.name.trim() : "opencode-mem";

async function resolvePlugin() {
  // Prefer remote plugin if configured
  try {
    const { initClientConfig, isClientConfigured } = await import("./config.js");
    initClientConfig(process.cwd());
    if (isClientConfigured()) {
      const { OpenCodeMemPlugin } = await import("./index-remote.js");
      console.log("[opencode-mem] Using remote server-client mode");
      return OpenCodeMemPlugin;
    }
  } catch {
    /* fall through */
  }

  // Fall back to legacy in-process plugin
  console.warn(
    "[opencode-mem] Using legacy in-process mode. Configure serverUrl + apiKey for server-client mode."
  );
  const { OpenCodeMemPlugin } = await import("./index.js");
  return OpenCodeMemPlugin;
}

const OpenCodeMemPlugin = await resolvePlugin();
export { OpenCodeMemPlugin };
export default { id, server: OpenCodeMemPlugin } satisfies PluginModule;
```

### Step 4.2: Update `package.json` Dependencies

**Action**: MODIFY `package.json`.

The client plugin no longer needs these dependencies (they're now server-only):

- `postgres` — PostgreSQL client (server-only)
- `zod` — Schema validation (server-only, used by AI structured output)
- `franc-min` — Language detection (server-only)
- `iso-639-3` — Language codes (server-only)

However, since the old in-process plugin is still available as a fallback, these dependencies must remain in `package.json` for now. Mark them as optional or add a note in the README.

**For Phase 4**: Keep all dependencies. Add documentation in the README about which deps are needed for server vs client modes.

### Step 4.3: Update `README.md`

**Action**: MODIFY `README.md`.

Add documentation for both deployment modes. Include:

- Quick start with Docker Compose
- Environment variable reference
- Legacy in-process mode deprecation notice
- Migration guide (how to switch from in-process to server-client)

### Step 4.4: Update Codemap

**Action**: MODIFY `src/codemap.md` and root `codemap.md`.

Add entries for:

- `src/server.ts` — server entry point
- `src/server-config.ts` — server configuration
- `src/services/auth.ts` — API key auth middleware
- `src/services/health-handler.ts` — health check handler
- `src/services/remote-client.ts` — HTTP client for remote server
- `src/index-remote.ts` — thin client plugin entry point

Update existing entries for modified files (`web-server.ts`, `api-handlers.ts`, `config.ts`, `plugin.ts`).

### Step 4.5: Phase 4 Verification Checklist

| #   | Check                    | Action                                     | Expected                                         |
| --- | ------------------------ | ------------------------------------------ | ------------------------------------------------ |
| 1   | Server-client is default | Configure serverUrl+apiKey, install plugin | Remote plugin loads by default                   |
| 2   | Legacy mode still works  | Remove serverUrl from config               | In-process plugin loads with deprecation warning |
| 3   | All existing tests pass  | `bun run typecheck && bun run build`       | No errors                                        |
| 4   | Full integration test    | Run through all SPEC.md AC-001 to AC-026   | All pass                                         |
| 5   | README updated           | Read root README.md                        | Documents both modes                             |
| 6   | Codemap updated          | Read codemap.md                            | Documents new files                              |

---

## 5. File Manifest

### Files Created

| File                                  | Phase | Purpose                           |
| ------------------------------------- | ----- | --------------------------------- |
| `src/server.ts`                       | 1     | Standalone server entry point     |
| `src/server-config.ts`                | 1     | Server env-var configuration      |
| `src/services/auth.ts`                | 1     | API key auth middleware           |
| `src/services/health-handler.ts`      | 1     | Health check handler              |
| `src/services/remote-client.ts`       | 2     | HTTP client for remote server     |
| `src/index-remote.ts`                 | 2     | Thin client plugin entry point    |
| `src/services/auto-capture-server.ts` | 3     | Server-side auto-capture AI logic |
| `Dockerfile`                          | 1     | Multi-stage Bun Docker build      |
| `docker-compose.yml`                  | 1     | Dev environment with PostgreSQL   |
| `SPEC.md`                             | 0     | Requirements specification        |
| `DESIGN.md`                           | 0     | Architecture design document      |
| `IMPLEMENTATION.md`                   | 0     | This file                         |

### Files Modified

| File                           | Phase | Changes                                                                           |
| ------------------------------ | ----- | --------------------------------------------------------------------------------- |
| `src/services/web-server.ts`   | 1     | Add auth, health endpoint, remove takeover logic, update startWebServer signature |
| `src/services/api-handlers.ts` | 2, 3  | Add handleContextInject, handleAutoCapture, handleUserProfileLearn                |
| `src/config.ts`                | 2     | Add ClientConfig interface, CLIENT_CONFIG export, initClientConfig()              |
| `src/plugin.ts`                | 2, 4  | Dual-mode resolution (remote preferred, legacy fallback)                          |
| `package.json`                 | 1, 4  | Add server export, scripts                                                        |
| `README.md`                    | 4     | Document both deployment modes                                                    |
| `codemap.md` (root)            | 4     | Update architecture diagram, add new files                                        |
| `src/codemap.md`               | 4     | Update descriptions                                                               |

### Files NOT Changed (Kept for Legacy Plugin)

| File                                           | Reason                                            |
| ---------------------------------------------- | ------------------------------------------------- |
| `src/index.ts`                                 | Legacy in-process plugin entry — still functional |
| `src/services/client.ts` (`LocalMemoryClient`) | Legacy in-process facade — still functional       |
| `src/services/embedding.ts`                    | Used by legacy plugin and server                  |
| `src/services/auto-capture.ts`                 | Used by legacy plugin                             |
| `src/services/user-memory-learning.ts`         | Used by legacy plugin                             |
| `src/services/context.ts`                      | Shared utility                                    |
| `src/services/ai/` (all)                       | Used by legacy plugin and server                  |
| `src/services/storage/` (all)                  | Used by legacy plugin and server                  |
| `src/services/tags.ts`                         | Client-only, unchanged                            |
| `src/services/privacy.ts`                      | Client-only, unchanged                            |
| `src/services/language-detector.ts`            | Shared, unchanged                                 |
| `src/services/logger.ts`                       | Shared, unchanged                                 |
| `src/services/jsonc.ts`                        | Shared, unchanged                                 |
| `src/services/secret-resolver.ts`              | Shared, unchanged                                 |
| `src/web/` (all)                               | Served by both legacy and new server              |

---

## 6. Testing Strategy

### 6.1 Unit Tests (Manual, via curl/bun)

Run these at each phase boundary:

```bash
# Config validation
bun -e "const {initServerConfig,validateServerConfig}=require('./src/server-config.ts'); console.log(validateServerConfig(initServerConfig()))"

# Auth middleware
bun -e "const {AuthMiddleware}=require('./src/services/auth.ts'); const a=new AuthMiddleware('k'); console.log(a.authenticate(new Request('http://l/api/x')))"

# Health handler
bun -e "const {handleHealth}=require('./src/services/health-handler.ts'); console.log(handleHealth())"

# RemoteMemoryClient unit test
bun -e "
const {RemoteMemoryClient}=require('./src/services/remote-client.ts');
const c=new RemoteMemoryClient('http://localhost:4747','test-key');
c.request('GET','/api/health').then(console.log)
"
```

### 6.2 Integration Tests

**Test 1: Full CRUD cycle via HTTP**

```bash
#!/bin/bash
set -e
BASE="http://localhost:4747"
AUTH="Authorization: Bearer test-key"
CT="Content-Type: application/json"

# Add memory
ID=$(curl -s -H "$AUTH" -H "$CT" -d '{"content":"Integration test memory","containerTag":"opencode_project_test","tags":["test"]}' $BASE/api/memories | jq -r '.data.id')
echo "Created: $ID"

# List memories
curl -s -H "$AUTH" "$BASE/api/memories?tag=opencode_project_test" | jq '.data.items | length'
echo " memories found"

# Search
curl -s -H "$AUTH" "$BASE/api/search?q=integration&tag=opencode_project_test" | jq '.data.items | length'
echo " search results"

# Delete
curl -s -X DELETE -H "$AUTH" "$BASE/api/memories/$ID" | jq '.success'
```

**Test 2: Context injection**

```bash
curl -s -H "$AUTH" -H "$CT" \
  -d '{"projectTag":"opencode_project_test","userId":"test@example.com","maxMemories":3}' \
  $BASE/api/context/inject | jq '.data.context'
```

**Test 3: Auto-capture**

```bash
curl -s -H "$AUTH" -H "$CT" \
  -d '{
    "sessionID":"sess_test_001",
    "projectTag":"opencode_project_test",
    "projectMetadata":{"displayName":"Test","userName":"test","userEmail":"t@t.com"},
    "conversationMessages":[
      {"role":"user","parts":[{"type":"text","text":"Fix the login bug in auth.ts"}]},
      {"role":"assistant","parts":[{"type":"text","text":"I fixed the login bug by updating the password validation in auth.ts line 42."}]}
    ],
    "userPrompt":"Fix the login bug in auth.ts",
    "promptMessageId":"msg_test_001"
  }' \
  $BASE/api/auto-capture | jq
```

**Test 4: Graceful degradation (server down)**

Stop the server. Post a message through the thin client plugin. Verify:

- Message proceeds without `[MEMORY]` injection
- No crash or unhandled error
- Error logged but not surfaced to user (unless `showErrorToasts` is true)

### 6.3 Performance Tests

```bash
# Measure context injection latency
time curl -s -H "$AUTH" -H "$CT" \
  -d '{"projectTag":"opencode_project_test","userId":"test@example.com","maxMemories":3}' \
  $BASE/api/context/inject > /dev/null

# Expected: < 200ms for local network with < 10 memories

# Measure health endpoint latency
time curl -s $BASE/api/health > /dev/null
# Expected: < 10ms
```

---

## 7. Rollback Plan

If issues are discovered after deploying any phase:

### Phase 1 Rollback

- The old plugin is unchanged. Simply stop the server process.
- No rollback needed — the server is additive.

### Phase 2 Rollback

- Remove `serverUrl` and `apiKey` from the client config file.
- The `plugin.ts` resolver will load the old in-process plugin automatically.
- Or, revert `plugin.ts` to the pre-Phase-2 version that always loads `index.ts`.

### Phase 3 Rollback

- Same as Phase 2. The client's `session.idle` handler calls `remoteMemoryClient.autoCapture()` which returns an error if the server endpoint is not available. The old auto-capture path in `index.ts` continues to work.

### Phase 4 Rollback

- The legacy `index.ts` is still present in the repository.
- Revert `plugin.ts` to force-load `index.ts` instead of `index-remote.ts`.
- All old behavior is preserved.

---

## 8. Release Checklist

- [ ] All Phase 1 acceptance criteria met (AC-001 through AC-008)
- [ ] All Phase 2 acceptance criteria met (AC-009 through AC-016)
- [ ] All Phase 3 acceptance criteria met (AC-017 through AC-021)
- [ ] All Phase 4 acceptance criteria met (AC-022 through AC-026)
- [ ] `bun run build` succeeds
- [ ] `bun run typecheck` succeeds
- [ ] Docker build succeeds
- [ ] Docker Compose starts and health check passes
- [ ] Old plugin works as fallback
- [ ] README, SPEC.md, DESIGN.md, IMPLEMENTATION.md all present and consistent
- [ ] Codemap updated
- [ ] No secrets committed (API keys in env vars only)
- [ ] Git tag created: `v3.0.0-server-client`
