# opencode-mem Server-Client Architecture

## Specification v1.0

---

## 1. Overview

opencode-mem currently operates as an in-process OpenCode plugin: a single Bun process that handles memory storage (PostgreSQL + pgvector), semantic search (remote embeddings), AI-powered auto-capture and profile learning, a local WebUI, and OpenCode plugin hooks. Every plugin instance owns its own process, its own config, and its own connection to shared infrastructure.

This specification defines a server-client split:

- **Server**: A standalone, long-lived Bun HTTP service hosting the Postgres connection pool, embedding service calls, AI provider orchestration, memory CRUD, auto-capture pipeline, user-profile learning, and the Management WebUI.
- **Client**: A thin OpenCode plugin that communicates with the server exclusively over HTTP. It carries no database drivers, no embedding logic, no AI provider, and no WebUI. Its sole responsibility is to forward OpenCode plugin hooks to the server API and inject returned context into the chat.

The goal is to enable headless deployment (Docker/VPS), centralized infrastructure, and simplified client configuration while preserving full functional parity with the current in-process plugin.

---

## 2. Scope

### 2.1 In Scope

- Standalone server entry point, lifecycle, and configuration
- API key authentication on all server endpoints
- REST API surface covering: memory CRUD, semantic search, status, tag listing, user profile access, prompt management, tag migration
- New API endpoints: context injection and auto-capture trigger
- Server-side auto-capture pipeline (conversation ingestion → AI analysis → memory storage)
- Server-side user-profile learning (prompt analysis → profile creation/update)
- Thin client plugin (`RemoteMemoryClient`) with the same logical interface as `LocalMemoryClient`
- Client configuration reduced to server URL, API key, and injection-formatting preferences
- Docker containerization of the server
- Side-by-side compatibility of old in-process plugin and new thin plugin during migration

### 2.2 Out of Scope

- Multi-tenant authentication (OAuth, JWT, user registration)
- WebSocket or streaming transport (REST-only for v1)
- Offline support or local caching on the client
- Admin dashboard or user management UI
- Horizontal scaling (multiple server instances, load balancing)
- API versioning strategy
- Migration tooling to convert existing local plugin instances to the new split
- Performance regression benchmarking beyond acceptable latency targets

---

## 3. Functional Requirements

### 3.1 Server

#### 3.1.1 Standalone Operation

| ID      | Requirement                                                                                                           |
| ------- | --------------------------------------------------------------------------------------------------------------------- |
| SRV-001 | The server SHALL start as a standalone Bun HTTP process without any OpenCode plugin dependency.                       |
| SRV-002 | The server SHALL bind to a configurable host and port (default: `0.0.0.0:4747`).                                      |
| SRV-003 | The server SHALL initialize the PostgreSQL connection pool on startup and report status via a health endpoint.        |
| SRV-004 | The server SHALL gracefully shut down on SIGINT/SIGTERM, closing the Postgres pool and completing in-flight requests. |
| SRV-005 | The server SHALL run indefinitely until terminated (no plugin lifecycle coupling).                                    |

#### 3.1.2 Configuration

| ID      | Requirement                                                                                                                                                                                                                                     |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SRV-006 | The server SHALL load configuration from environment variables, with a JSON/JSONC file fallback.                                                                                                                                                |
| SRV-007 | Required server configuration SHALL include: `POSTGRES_URL`, `EMBEDDING_API_URL`, `EMBEDDING_MODEL`, `EMBEDDING_API_KEY`, `SERVER_API_KEY`.                                                                                                     |
| SRV-008 | Optional server configuration SHALL include: `SERVER_PORT`, `SERVER_HOST`, `MEMORY_MODEL`, `MEMORY_API_URL`, `MEMORY_API_KEY`, `OPENCODE_PROVIDER`, `OPENCODE_MODEL`, and all current auto-capture, profile-learning, and AI tuning parameters. |
| SRV-009 | The server SHALL validate required configuration at startup and refuse to start if missing.                                                                                                                                                     |
| SRV-010 | The server SHALL NOT expose any configuration endpoint that returns secret values (API keys, database URLs).                                                                                                                                    |

#### 3.1.3 Authentication

| ID      | Requirement                                                                              |
| ------- | ---------------------------------------------------------------------------------------- |
| SRV-011 | Every `/api/*` request SHALL require a valid API key.                                    |
| SRV-012 | The API key SHALL be provided via the `Authorization: Bearer <key>` header.              |
| SRV-013 | The server SHALL validate the provided key against `SERVER_API_KEY` from configuration.  |
| SRV-014 | Requests with missing or invalid API keys SHALL receive HTTP 401 with a JSON error body. |
| SRV-015 | The health endpoint (`GET /api/health`) MAY be excluded from authentication.             |
| SRV-016 | CORS preflight requests (`OPTIONS`) SHALL NOT require authentication.                    |

#### 3.1.4 API Endpoints (Existing Surface)

These endpoints from the current `web-server.ts` / `api-handlers.ts` codebase SHALL be preserved with no semantic changes, only the addition of authentication:

| Method   | Path                            | Handler                         | Description                                 |
| -------- | ------------------------------- | ------------------------------- | ------------------------------------------- |
| `GET`    | `/api/tags`                     | `handleListTags`                | List distinct project tags                  |
| `GET`    | `/api/memories`                 | `handleListMemories`            | Paginated memory listing                    |
| `POST`   | `/api/memories`                 | `handleAddMemory`               | Create a new memory with embedding          |
| `PUT`    | `/api/memories/:id`             | `handleUpdateMemory`            | Update memory content and re-embed          |
| `DELETE` | `/api/memories/:id`             | `handleDeleteMemory`            | Delete a memory (optional cascade)          |
| `POST`   | `/api/memories/bulk-delete`     | `handleBulkDelete`              | Bulk delete memories                        |
| `GET`    | `/api/search`                   | `handleSearch`                  | Semantic search across memories and prompts |
| `GET`    | `/api/stats`                    | `handleStats`                   | Memory counts by scope and type             |
| `POST`   | `/api/memories/:id/pin`         | `handlePinMemory`               | Pin a memory                                |
| `POST`   | `/api/memories/:id/unpin`       | `handleUnpinMemory`             | Unpin a memory                              |
| `GET`    | `/api/migration/tags/detect`    | `handleDetectTagMigration`      | Check for untagged memories                 |
| `POST`   | `/api/migration/tags/run-batch` | `handleRunTagMigrationBatch`    | Run AI tag migration batch                  |
| `GET`    | `/api/migration/tags/progress`  | `handleGetTagMigrationProgress` | Get migration progress                      |
| `DELETE` | `/api/prompts/:id`              | `handleDeletePrompt`            | Delete a prompt (optional cascade)          |
| `POST`   | `/api/prompts/bulk-delete`      | `handleBulkDeletePrompts`       | Bulk delete prompts                         |
| `GET`    | `/api/user-profile`             | `handleGetUserProfile`          | Get user profile                            |
| `GET`    | `/api/user-profile/changelog`   | `handleGetProfileChangelog`     | Get profile changelog                       |
| `GET`    | `/api/user-profile/snapshot`    | `handleGetProfileSnapshot`      | Get historical profile snapshot             |
| `POST`   | `/api/user-profile/refresh`     | `handleRefreshProfile`          | Queue profile refresh                       |

| ID      | Requirement                                                                                                                          |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| SRV-017 | All preserved endpoints SHALL maintain the exact request/response schemas defined in `api-handlers.ts` (see Appendix A).             |
| SRV-018 | All preserved endpoints SHALL accept the same query parameters, path parameters, and request bodies as the current implementation.   |
| SRV-019 | The server SHALL return HTTP 200 for successful responses with `{ success: true, data: ... }` bodies matching the current format.    |
| SRV-020 | The server SHALL return HTTP 400/500 for error responses with `{ success: false, error: "..." }` bodies matching the current format. |

#### 3.1.5 New API Endpoints

| ID      | Requirement                                                                                                                                                                                                                                                                                                                                                                         |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SRV-021 | The server SHALL provide `POST /api/context/inject` accepting a JSON body `{ userId, projectTag, sessionID?, maxMemories?, excludeCurrentSession?, maxAgeDays? }` and returning `{ success: true, data: { context: string, memories: Array<{ id, summary, createdAt, similarity }> } }`. The `context` field SHALL contain the formatted `[MEMORY]` block ready for chat injection. |
| SRV-022 | The `/api/context/inject` endpoint SHALL apply the same business logic as the current `chat.message` hook `injectOn` rules (first-message detection, compaction-awareness, post-compaction re-injection). If `sessionID` is provided, the server SHALL implement the `injectOn` logic. If `sessionID` is omitted, the server SHALL return context unconditionally.                  |
| SRV-023 | The server SHALL provide `POST /api/auto-capture` accepting a JSON body `{ sessionID, projectTag, projectMetadata: { displayName, userName, userEmail, projectPath, projectName, gitRepoUrl }, conversationMessages: Array<{ role, parts }>, userPrompt: string, promptMessageId: string }` and returning `{ success: true, data: { captured: boolean, memoryId?: string } }`.      |
| SRV-024 | The `/api/auto-capture` endpoint SHALL execute the exact same pipeline as `performAutoCapture` in `auto-capture.ts`: extract AI content from messages, build markdown context, call the AI provider for summary generation, create embedding, store the memory, and return the result.                                                                                              |
| SRV-025 | The `/api/auto-capture` endpoint SHALL return `{ success: true, data: { captured: false } }` if the conversation contains no capturable technical content (AI determines type "skip").                                                                                                                                                                                              |
| SRV-026 | The server SHALL provide `POST /api/user-profile/learn` accepting a JSON body `{ userId, displayName, userName, userEmail, prompts: Array<{ id, content }>, existingProfile? }` and returning `{ success: true, data: { updated: boolean } }`.                                                                                                                                      |
| SRV-027 | The `/api/user-profile/learn` endpoint SHALL execute the exact same pipeline as `performUserProfileLearning` in `user-memory-learning.ts`.                                                                                                                                                                                                                                          |
| SRV-028 | The server SHALL provide `GET /api/health` returning `{ status: "ok", version: string, dbConnected: boolean, embeddingReady: boolean, uptime: number }`.                                                                                                                                                                                                                            |
| SRV-029 | The server SHALL set `dbConnected: true` when the PostgreSQL pool is connected and migrations are complete.                                                                                                                                                                                                                                                                         |
| SRV-030 | The server SHALL set `embeddingReady: true` when the embedding service has completed warmup.                                                                                                                                                                                                                                                                                        |

#### 3.1.6 Web UI

| ID      | Requirement                                                                                                                                                        |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SRV-031 | The server SHALL serve the existing Management WebUI static files (`src/web/index.html`, `app.js`, `styles.css`, `i18n.js`, `favicon.ico`) at the root path (`/`). |
| SRV-032 | The WebUI SHALL use the same API endpoints as the client plugin (no separate WebUI-only endpoints).                                                                |
| SRV-033 | The WebUI SHALL include the API key in all requests to `/api/*` endpoints (read from browser storage or URL parameter).                                            |
| SRV-034 | No WebUI code changes beyond API key integration SHALL be required.                                                                                                |

#### 3.1.7 Deployment

| ID      | Requirement                                                                                              |
| ------- | -------------------------------------------------------------------------------------------------------- |
| SRV-035 | The server SHALL be deployable via a provided `Dockerfile` using the `oven/bun` base image.              |
| SRV-036 | The server SHALL accept all configuration via environment variables when running in Docker.              |
| SRV-037 | The server SHALL support an optional `docker-compose.yml` for local development with bundled PostgreSQL. |
| SRV-038 | The server SHALL bind to `0.0.0.0` by default in Docker to accept external connections.                  |

### 3.2 Client

#### 3.2.1 Plugin Compatibility

| ID     | Requirement                                                                                                                                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CL-001 | The client SHALL be an OpenCode plugin conforming to the `@opencode-ai/plugin` Plugin interface.                                                                         |
| CL-002 | The client SHALL register the same hooks as the current plugin: `chat.message`, `tool.memory`, `event` (`session.idle`, `session.compacted`).                            |
| CL-003 | The `tool.memory` tool SHALL expose the same modes as the current plugin: `add`, `search`, `profile`, `list`, `forget`, `help`.                                          |
| CL-004 | The `chat.message` hook SHALL inject memory context as a synthetic text part at the beginning of `output.parts`, identical in format and behavior to the current plugin. |

#### 3.2.2 Remote Memory Client

| ID     | Requirement                                                                                                                                                                                                                   |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CL-005 | The client SHALL use a `RemoteMemoryClient` class that implements the same logical interface as the current `LocalMemoryClient` (`searchMemories`, `addMemory`, `listMemories`, `deleteMemory`, `searchMemoriesBySessionID`). |
| CL-006 | `RemoteMemoryClient` SHALL translate each method call to an HTTP request against the server API endpoints defined in section 3.1.4.                                                                                           |
| CL-007 | `RemoteMemoryClient` SHALL handle HTTP errors gracefully, returning result objects with `success: false` and error messages matching the current error format.                                                                |
| CL-008 | `RemoteMemoryClient` SHALL set `Authorization: Bearer <apiKey>` on every request.                                                                                                                                             |
| CL-009 | `RemoteMemoryClient` SHALL implement a configurable request timeout (default: 30 seconds).                                                                                                                                    |
| CL-010 | `RemoteMemoryClient` SHALL NOT cache responses (no local state).                                                                                                                                                              |
| CL-011 | `RemoteMemoryClient` SHALL NOT perform embedding, AI calls, or database operations.                                                                                                                                           |

#### 3.2.3 chat.message Hook

| ID     | Requirement                                                                                                                                                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CL-012 | The `chat.message` hook SHALL call the server's `/api/context/inject` endpoint to fetch formatted context.                                                                                                                                  |
| CL-013 | If the server returns a non-empty `context` string, the client SHALL inject it as a synthetic text part at the front of `output.parts`.                                                                                                     |
| CL-014 | The client SHALL pass `sessionID` to the server so the server can apply `injectOn` rules (first-message detection, compaction-awareness).                                                                                                   |
| CL-015 | The client SHALL save the user prompt to the server (via the prompt-save path) when the message is not fully private. The server may expose a `POST /api/prompts` endpoint for this, or the client may defer this to the auto-capture flow. |
| CL-016 | If the server is unreachable or returns an error, the `chat.message` hook SHALL gracefully continue without injected context (no crash, no blocking). It MAY show a non-blocking error toast.                                               |

#### 3.2.4 session.idle and Auto-Capture

| ID     | Requirement                                                                                                                                                      |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CL-017 | The `session.idle` event handler SHALL fetch the full session conversation history via `ctx.client.session.messages()`.                                          |
| CL-018 | The client SHALL send the conversation history, user prompt, and project metadata to `POST /api/auto-capture`.                                                   |
| CL-019 | The client SHALL handle the auto-capture response as fire-and-forget: success/failure SHALL NOT block the plugin.                                                |
| CL-020 | The client MAY optionally call `POST /api/user-profile/learn` from the idle handler if the current instance is the web-server owner (matching current behavior). |

#### 3.2.5 Configuration

| ID     | Requirement                                                                                                                                                                                                                                    |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CL-021 | The client SHALL load configuration from files matching the current pattern (`~/.config/opencode/opencode-mem.jsonc`, project `.opencode/opencode-mem.jsonc`).                                                                                 |
| CL-022 | Required client configuration SHALL be: `serverUrl`, `apiKey`.                                                                                                                                                                                 |
| CL-023 | Optional client configuration SHALL be: `autoCaptureEnabled`, `chatMessage.*` (maxMemories, excludeCurrentSession, maxAgeDays, injectOn), `showErrorToasts`, `showAutoCaptureToasts`, `showUserProfileToasts`.                                 |
| CL-024 | The client SHALL NOT require any of: `postgres.*`, `embedding*`, `memoryModel`, `memoryApiUrl`, `memoryApiKey`, `memoryProvider`, `opencodeProvider`, `opencodeModel`, `webServer*`, `userProfile*`, `compaction.*`, `aiSessionRetentionDays`. |
| CL-025 | If `serverUrl` is missing, the client SHALL report a configuration error (same as current `isConfigured()` behavior) and skip hook registration.                                                                                               |
| CL-026 | The client SHALL validate that `serverUrl` is a valid HTTP/HTTPS URL at startup.                                                                                                                                                               |

---

## 4. Non-Functional Requirements

### 4.1 Latency

| ID     | Requirement                                                                                                                                                                                                                                     |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NF-001 | The `/api/context/inject` endpoint SHALL respond within 500ms for typical loads (10 or fewer memories, no cold start).                                                                                                                          |
| NF-002 | The `/api/auto-capture` endpoint SHALL be considered asynchronous by the client; the server MAY take up to 30 seconds to complete AI processing. The HTTP response SHALL still return within 5 seconds (server processes synchronously for v1). |
| NF-003 | The `chat.message` hook SHALL NOT add more than 200ms of additional latency compared to the current in-process plugin under local-network conditions.                                                                                           |
| NF-004 | The health endpoint SHALL respond within 100ms.                                                                                                                                                                                                 |

### 4.2 Reliability

| ID     | Requirement                                                                                                                                                            |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NF-005 | The client SHALL NOT crash or propagate unhandled exceptions when the server is unreachable. All server calls SHALL be wrapped in try/catch with graceful degradation. |
| NF-006 | The server SHALL restart cleanly after unexpected termination. Database migrations SHALL be idempotent.                                                                |
| NF-007 | The server SHALL handle concurrent requests without data corruption (reuse existing Postgres connection pool with transaction isolation).                              |

### 4.3 Security

| ID     | Requirement                                                                                         |
| ------ | --------------------------------------------------------------------------------------------------- |
| NF-008 | All `/api/*` endpoints (except health) SHALL reject requests without valid API keys.                |
| NF-009 | API keys SHALL be transmitted only in HTTP headers, never in URL query parameters.                  |
| NF-010 | The server SHALL enforce HTTPS in production (via reverse proxy or direct TLS configuration).       |
| NF-011 | The server SHALL NOT log API keys, database URLs, or embedding API keys.                            |
| NF-012 | The server SHALL enforce request body size limits (maximum 10MB, matching current `MAX_BODY_SIZE`). |

---

## 5. Constraints

### 5.1 Preserved Behaviors

| ID     | Constraint                                                                                                                                                                                                               |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CN-001 | Memory storage SHALL continue to use PostgreSQL with pgvector for vector similarity search.                                                                                                                              |
| CN-002 | Embeddings SHALL continue to be 1024-dimensional vectors generated by a remote OpenAI-compatible `/v1/embeddings` API. The embedding dimension SHALL be configurable (matching current auto-detection for known models). |
| CN-003 | Memory identity SHALL continue to be scoped by project tags in the format `opencode_project_<hash>`.                                                                                                                     |
| CN-004 | User identity SHALL continue to be resolved from project metadata (displayName, userName, userEmail) rather than server-side authentication.                                                                             |
| CN-005 | The Management WebUI SHALL continue to be a vanilla JavaScript SPA with no framework dependencies.                                                                                                                       |
| CN-006 | All existing database migrations (in `src/services/storage/postgres/migrations/`) SHALL remain valid and unchanged.                                                                                                      |
| CN-007 | The existing `config.ts` file format for client-side configuration SHALL be preserved (minimal new fields, no breaking changes to existing fields in the old plugin).                                                    |
| CN-008 | The old in-process plugin SHALL continue to work without modification during the migration period (Phase 2 side-by-side).                                                                                                |
| CN-009 | The `@opencode-ai/plugin` SDK API SHALL NOT be changed by this specification.                                                                                                                                            |

### 5.2 Technology Constraints

| ID     | Constraint                                                                                                |
| ------ | --------------------------------------------------------------------------------------------------------- |
| CN-010 | The server SHALL be implemented in TypeScript running on Bun.                                             |
| CN-011 | The client SHALL be implemented in TypeScript as an OpenCode plugin.                                      |
| CN-012 | HTTP communication SHALL use the fetch API (native to Bun). No additional HTTP client libraries required. |
| CN-013 | The Docker image SHALL be based on `oven/bun` (not Node.js).                                              |

---

## 6. Acceptance Criteria

### 6.1 Phase 1 — Standalone Server

| AC-001 | The server starts with `bun run src/server.ts` and logs the listening address. |
| AC-002 | `GET /api/health` returns `{ status: "ok", dbConnected: true, embeddingReady: true }` within 10 seconds of startup. |
| AC-003 | `GET /api/stats` without an API key returns HTTP 401. |
| AC-004 | `GET /api/stats` with a valid `Authorization: Bearer <key>` header returns HTTP 200 with correct memory counts. |
| AC-005 | The existing WebUI loads at `http://localhost:4747/` and displays memories (assuming API key is provided). |
| AC-006 | `docker build -t opencode-mem-server . && docker run -p 4747:4747 -e ...` starts the server and serves the WebUI. |
| AC-007 | Memory CRUD operations (add, list, search, update, delete) work identically to the current in-process plugin via HTTP API. |
| AC-008 | The old in-process plugin continues to work without changes when tested against the same Postgres database. |

### 6.2 Phase 2 — Thin Client Plugin

| AC-009 | The client plugin starts without Postgres, embedding, or AI provider dependencies. |
| AC-010 | The client plugin registers all three hooks (`chat.message`, `tool.memory`, `event`) and they function when the server is reachable. |
| AC-011 | `tool.memory add` sends content via HTTP to the server's `POST /api/memories`, and the memory appears in the server's database and WebUI. |
| AC-012 | `tool.memory search` returns results matching the server's semantic search results. |
| AC-013 | `chat.message` injection produces the same `[MEMORY]` block format as the current plugin when the server is reachable. |
| AC-014 | `chat.message` hook does NOT crash when the server is unreachable (graceful degradation). |
| AC-015 | The client configuration file requires only `serverUrl` and `apiKey` for full functionality. |
| AC-016 | Side-by-side operation: the old plugin and new plugin can both run against the same Postgres database and produce functionally identical memory search/injection results. |

### 6.3 Phase 3 — Server-Side Auto-Capture and Profile Learning

| AC-017 | `POST /api/auto-capture` with a valid conversation payload creates a memory in the database with `source: "auto-capture"`. |
| AC-018 | The `session.idle` client hook sends conversation data to `/api/auto-capture` and the resulting memory appears in the WebUI. |
| AC-019 | `POST /api/user-profile/learn` with valid prompts creates or updates a user profile. |
| AC-020 | Auto-capture correctly identifies non-technical conversations and returns `captured: false`. |
| AC-021 | Auto-capture produces memories with AI-generated tags (2-4 tags per memory). |

### 6.4 Phase 4 — Decommission

| AC-022 | The in-process code path (`LocalMemoryClient`, embedding service as plugin dependency, in-process AI provider, in-process web server) is removed from the client plugin source tree. |
| AC-023 | The server is the sole owner of Postgres connections, embedding calls, AI provider calls, and WebUI serving. |
| AC-024 | The plugin repository contains two entry points: `src/server.ts` (standalone server) and `src/index.ts` (thin client plugin). |
| AC-025 | All existing tests (if any) pass, or equivalent test coverage exists for the split architecture. |
| AC-026 | The README documents both deployment modes: in-process (legacy, continued support) and server-client (recommended). |

---

## 7. Out of Scope (Explicit)

The following capabilities are explicitly excluded from this specification. They may be addressed in future versions:

### 7.1 Multi-Tenant Authentication

- OAuth 2.0, OpenID Connect, or JWT-based user authentication
- User registration, login, or session management
- Role-based access control (admin vs. read-only)
- Per-user data isolation beyond the project-tag pattern

### 7.2 Transport Upgrades

- WebSocket or Server-Sent Events for real-time updates
- gRPC or protobuf serialization
- Streaming responses for large result sets

### 7.3 Client-Side Resilience

- Offline mode with local cache and sync
- Retry with exponential backoff
- Circuit breaker pattern
- Response caching on the client

### 7.4 Operations

- Admin dashboard with system metrics, logs viewer, or user management
- Horizontal scaling (load-balanced server instances, read replicas)
- Database backup/restore tooling
- Monitoring, alerting, or observability beyond basic health checks
- API rate limiting or quota enforcement

### 7.5 Migration Tooling

- Automated conversion of existing plugin configs to the new format
- Data migration between instances
- Schema versioning or API version negotiation

### 7.6 Advanced Features

- Multi-modal memory (images, audio)
- Memory summarization or consolidation across sessions
- Collaborative/shared project memories
- Plugin hot-reload or zero-downtime deployment

---

## Appendix A — API Response Schemas (Reference)

### A.1 Success Response

```json
{
  "success": true,
  "data": { ... }
}
```

### A.2 Error Response

```json
{
  "success": false,
  "error": "Human-readable error message"
}
```

### A.3 Paginated Response

```json
{
  "success": true,
  "data": {
    "items": [ ... ],
    "total": 100,
    "page": 1,
    "pageSize": 20,
    "totalPages": 5
  }
}
```

### A.4 Memory Object

```json
{
  "type": "memory",
  "id": "mem_1716000000000_abc123def",
  "content": "Memory content text",
  "memoryType": "feature",
  "tags": ["react", "auth"],
  "createdAt": "2024-05-18T12:00:00.000Z",
  "updatedAt": "2024-05-18T12:00:00.000Z",
  "similarity": 0.85,
  "metadata": { "source": "manual" },
  "displayName": "John Doe",
  "userName": "johndoe",
  "userEmail": "john@example.com",
  "projectPath": "/home/user/project",
  "projectName": "my-project",
  "gitRepoUrl": "https://github.com/user/repo",
  "isPinned": false,
  "linkedPromptId": "prm_..."
}
```

### A.5 Context Injection Request/Response

**Request:**

```json
{
  "sessionID": "sess_abc123",
  "projectTag": "opencode_project_a1b2c3",
  "userId": "user@example.com",
  "maxMemories": 3,
  "excludeCurrentSession": true,
  "maxAgeDays": null
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "context": "[MEMORY]\n\nUser Preferences:\n- [explicit] Prefers code without comments\n\nProject Knowledge:\n- [85%] Added authentication middleware\n- [72%] Fixed pagination bug in API",
    "memories": [
      {
        "id": "mem_001",
        "summary": "Added authentication middleware",
        "createdAt": "2024-05-18T12:00:00.000Z",
        "similarity": 0.85
      }
    ],
    "profileInjected": true
  }
}
```

### A.6 Auto-Capture Request/Response

**Request:**

```json
{
  "sessionID": "sess_abc123",
  "projectTag": "opencode_project_a1b2c3",
  "projectMetadata": {
    "displayName": "John Doe",
    "userName": "johndoe",
    "userEmail": "john@example.com",
    "projectPath": "/home/user/project",
    "projectName": "my-project",
    "gitRepoUrl": "https://github.com/user/repo"
  },
  "conversationMessages": [
    {
      "role": "user",
      "parts": [{ "type": "text", "text": "Add auth middleware" }]
    },
    {
      "role": "assistant",
      "parts": [{ "type": "text", "text": "I've added..." }]
    }
  ],
  "userPrompt": "Add auth middleware to the Express app",
  "promptMessageId": "msg_xyz789"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "captured": true,
    "memoryId": "mem_1716000000000_abc123def"
  }
}
```

---

## Appendix B — Configuration Schemas

### B.1 Server Configuration

| Key                                  | Required | Default         | Description                                                             |
| ------------------------------------ | -------- | --------------- | ----------------------------------------------------------------------- |
| `SERVER_PORT`                        | No       | `4747`          | HTTP listen port                                                        |
| `SERVER_HOST`                        | No       | `0.0.0.0`       | HTTP listen host                                                        |
| `SERVER_API_KEY`                     | **Yes**  | —               | API key for client authentication                                       |
| `POSTGRES_URL`                       | **Yes**  | —               | PostgreSQL connection URL (supports `env://` and `file://` secret refs) |
| `POSTGRES_SSL`                       | No       | `"require"`     | SSL mode                                                                |
| `POSTGRES_MAX_CONNECTIONS`           | No       | `10`            | Connection pool size                                                    |
| `POSTGRES_IDLE_TIMEOUT_SECONDS`      | No       | `30`            | Idle connection timeout                                                 |
| `POSTGRES_CONNECT_TIMEOUT_SECONDS`   | No       | `10`            | Connection timeout                                                      |
| `POSTGRES_VECTOR_TYPE`               | No       | `"vector"`      | pgvector type (`vector` or `halfvec`)                                   |
| `POSTGRES_HNSW_EF_SEARCH`            | No       | `128`           | HNSW ef_search parameter                                                |
| `POSTGRES_HNSW_EF_CONSTRUCTION`      | No       | `256`           | HNSW ef_construction parameter                                          |
| `EMBEDDING_API_URL`                  | **Yes**  | —               | OpenAI-compatible embeddings endpoint                                   |
| `EMBEDDING_API_KEY`                  | **Yes**  | —               | Embeddings API key                                                      |
| `EMBEDDING_MODEL`                    | **Yes**  | —               | Embedding model name                                                    |
| `EMBEDDING_DIMENSIONS`               | No       | auto-detected   | Output vector dimensions                                                |
| `EMBEDDING_MAX_TOKENS_CONTENT`       | No       | `2048`          | Max tokens for content embedding                                        |
| `EMBEDDING_MAX_TOKENS_TAGS`          | No       | `256`           | Max tokens for tag embedding                                            |
| `EMBEDDING_MAX_TOKENS_QUERY`         | No       | `512`           | Max tokens for query embedding                                          |
| `SIMILARITY_THRESHOLD`               | No       | `0.6`           | Minimum similarity score for search                                     |
| `MAX_MEMORIES`                       | No       | `10`            | Max memories per search                                                 |
| `INJECT_PROFILE`                     | No       | `true`          | Include user profile in context                                         |
| `MEMORY_PROVIDER`                    | No       | `"openai-chat"` | AI provider for auto-capture                                            |
| `MEMORY_MODEL`                       | No       | —               | Model for auto-capture (if not using opencode provider)                 |
| `MEMORY_API_URL`                     | No       | —               | API URL for auto-capture (if not using opencode provider)               |
| `MEMORY_API_KEY`                     | No       | —               | API key for auto-capture (if not using opencode provider)               |
| `MEMORY_TEMPERATURE`                 | No       | `0.3`           | AI temperature (or `false` to omit)                                     |
| `OPENCODE_PROVIDER`                  | No       | —               | OpenCode provider name for auto-capture (takes precedence)              |
| `OPENCODE_MODEL`                     | No       | —               | OpenCode model for auto-capture                                         |
| `AUTO_CAPTURE_MAX_ITERATIONS`        | No       | `5`             | Max AI tool-call loop iterations                                        |
| `AUTO_CAPTURE_ITERATION_TIMEOUT`     | No       | `30000`         | Timeout per iteration (ms)                                              |
| `AUTO_CAPTURE_LANGUAGE`              | No       | `"auto"`        | Language for summaries                                                  |
| `USER_PROFILE_ANALYSIS_INTERVAL`     | No       | `10`            | Prompts before profile analysis                                         |
| `USER_PROFILE_MAX_PREFERENCES`       | No       | `20`            | Max preferences in profile                                              |
| `USER_PROFILE_MAX_PATTERNS`          | No       | `15`            | Max patterns in profile                                                 |
| `USER_PROFILE_MAX_WORKFLOWS`         | No       | `10`            | Max workflows in profile                                                |
| `USER_PROFILE_CONFIDENCE_DECAY_DAYS` | No       | `30`            | Confidence decay period                                                 |
| `USER_PROFILE_CHANGELOG_RETENTION`   | No       | `5`             | Changelog versions to keep                                              |
| `WEB_SERVER_ALLOWED_ORIGIN`          | No       | `"*"`           | CORS allowed origin                                                     |

### B.2 Client Configuration

| Key                                 | Required | Default     | Description                                    |
| ----------------------------------- | -------- | ----------- | ---------------------------------------------- |
| `serverUrl`                         | **Yes**  | —           | Server HTTP URL (e.g. `http://localhost:4747`) |
| `apiKey`                            | **Yes**  | —           | Server API key                                 |
| `autoCaptureEnabled`                | No       | `true`      | Enable auto-capture on idle                    |
| `chatMessage.enabled`               | No       | `true`      | Enable chat message context injection          |
| `chatMessage.maxMemories`           | No       | `3`         | Max memories to inject                         |
| `chatMessage.excludeCurrentSession` | No       | `true`      | Exclude current session memories               |
| `chatMessage.maxAgeDays`            | No       | —           | Maximum age of injected memories               |
| `chatMessage.injectOn`              | No       | `"first"`   | When to inject (`"first"` or `"always"`)       |
| `showAutoCaptureToasts`             | No       | `true`      | Show auto-capture UI toasts                    |
| `showUserProfileToasts`             | No       | `true`      | Show profile update UI toasts                  |
| `showErrorToasts`                   | No       | `true`      | Show error UI toasts                           |
| `memory.defaultScope`               | No       | `"project"` | Default scope for list/search                  |

---

## Appendix C — Migration Path

### C.1 Phase Timeline

| Phase                           | Duration | Deliverable                                                   |
| ------------------------------- | -------- | ------------------------------------------------------------- |
| Phase 1 — Standalone Server     | Week 1-2 | `src/server.ts`, `Dockerfile`, auth middleware, server config |
| Phase 2 — Thin Client           | Week 3-4 | `RemoteMemoryClient`, thin plugin, side-by-side validation    |
| Phase 3 — Server-Side Pipelines | Week 5-6 | Server-side auto-capture, profile learning, new endpoints     |
| Phase 4 — Decommission          | Week 7   | Remove in-process code, documentation, final testing          |

### C.2 Backward Compatibility During Migration

1. The old in-process plugin SHALL continue to function throughout all phases.
2. Both old and new plugins SHALL target the same Postgres database schema.
3. Both old and new plugins SHALL produce identical search results for the same queries.
4. Configuration files for the old plugin SHALL NOT require changes.
5. After Phase 4, the old plugin MAY be deprecated but SHALL remain functional.

---

## Appendix D — Glossary

| Term                   | Definition                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Plugin**             | An OpenCode extension conforming to the `@opencode-ai/plugin` Plugin interface. Runs in-process with OpenCode.     |
| **Server**             | The standalone Bun HTTP service that hosts Postgres, embeddings, AI providers, and the WebUI.                      |
| **Client**             | The thin OpenCode plugin that communicates with the server over HTTP.                                              |
| **LocalMemoryClient**  | The current in-process facade that wraps embedding and Postgres calls directly.                                    |
| **RemoteMemoryClient** | The new HTTP-based facade that calls the server API instead of local resources.                                    |
| **Auto-capture**       | The pipeline that analyzes conversation history via AI to extract and store technical memories.                    |
| **Profile learning**   | The pipeline that analyzes user prompts to build and maintain a user preference/profile document.                  |
| **Context injection**  | The process of inserting relevant memories and profile data into the chat message as a synthetic `[MEMORY]` block. |
| **Project tag**        | A unique identifier in the format `opencode_project_<hash>` used to shard memories by project.                     |
| **pgvector**           | PostgreSQL extension providing vector storage and HNSW similarity search.                                          |
