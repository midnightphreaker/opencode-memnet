# Repository Atlas: opencode-memnet

## Project Responsibility

`opencode-memnet` is an OpenCode plugin that gives coding agents persistent, semantically searchable memory. It captures user prompts, embeds them via a remote OpenAI-compatible API (1024-dim vectors), stores memories in PostgreSQL with pgvector HNSW indexes, injects relevant context into future chat messages, supports automatic memory capture and user-profile learning, and exposes a local HTTP API and Management WebUI for memory management.

## System Entry Points

- **`src/index.ts`** — primary OpenCode plugin factory; wires configuration, chat hooks, tools, event handlers, memory injection, auto-capture, profile learning, and web server startup.
- **`src/index-remote.ts`** — thin remote client plugin factory; delegates all operations to `RemoteMemoryClient` over HTTP. Handles chat.message injection, memory tool operations, idle auto-capture forwarding, and session compaction memory restoration.
- **`src/server.ts`** — standalone headless server entry point; loads env-based config, initializes storage/embedding, starts HTTP API server with Bearer auth, launches background tag migration loop.
- **`src/server-config.ts`** — environment-variable server configuration loader with `ServerConfig` interface, secret resolution, auto-detected embedding dimensions, and validation.
- **`src/config.ts`** — configuration loader/normalizer for global and project-local `opencode-memnet` JSON/JSONC files, defaults, path expansion, and secret resolution. Validates required fields: `postgres.url`, `embeddingApiUrl`, `embeddingModel`.

## Directory Map

| Directory                        | Responsibility Summary                                                                                                                                                                                                                                                                                                      | Detailed Map                                         |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `src/`                           | Plugin entry surface: ESM export (`plugin.ts`), lifecycle orchestration (`index.ts`), thin remote client plugin (`index-remote.ts`), standalone headless server (`server.ts`), server config from env vars (`server-config.ts`), configuration loader with JSONC merging and secret resolution (`config.ts`).               | [View Map](src/codemap.md)                           |
| `src/types/`                     | Shared type contracts: `MemoryType`, `MemoryMetadata`, `AIProviderType`. Single barrel file.                                                                                                                                                                                                                                | [View Map](src/types/codemap.md)                     |
| `src/web/`                       | Management WebUI: vanilla JS SPA for browsing, searching, and managing memories and user profiles with prompt→memory linked views.                                                                                                                                                                                          | [View Map](src/web/codemap.md)                       |
| `src/services/`                  | Core service layer: `LocalMemoryClient` facade, `RemoteMemoryClient` HTTP client, auto-capture pipeline (plugin + server-side), user-profile learning (plugin + server-side), `AuthMiddleware` Bearer token auth, background tag migration loop, HTTP API handlers, privacy/embedding/tags utilities, configurable logging. | [View Map](src/services/codemap.md)                  |
| `src/services/ai/`               | AI provider abstraction: factory routes to OpenAI chat completions provider; opencode SDK structured-output integration; provider config resolution.                                                                                                                                                                        | [View Map](src/services/ai/codemap.md)               |
| `src/services/ai/providers/`     | Provider implementations: `BaseAIProvider` abstract contract, `OpenAIChatCompletionProvider` with bounded tool-call iteration loops and session persistence.                                                                                                                                                                | [View Map](src/services/ai/providers/codemap.md)     |
| `src/services/ai/tools/`         | Tool schema contracts: `ChatCompletionTool` interface shared between tool definitions and provider implementations.                                                                                                                                                                                                         | [View Map](src/services/ai/tools/codemap.md)         |
| `src/services/ai/validators/`    | AI output validation: `UserProfileValidator` with two-phase structural/semantic checks, accumulating-error pattern.                                                                                                                                                                                                         | [View Map](src/services/ai/validators/codemap.md)    |
| `src/services/storage/`          | Storage abstraction: repository interfaces (`MemoryRepository`, etc.) and factory routing to Postgres implementations.                                                                                                                                                                                                      | [View Map](src/services/storage/codemap.md)          |
| `src/services/storage/postgres/` | PostgreSQL + pgvector: lazy client singleton, HNSW vector search with weighted scoring, 11 schema migrations, tag migration methods, atomic CRUD operations.                                                                                                                                                                | [View Map](src/services/storage/postgres/codemap.md) |
| `src/services/user-profile/`     | Profile data model: typed `UserProfile`/`UserProfileData` interfaces and defensive JSON-parsing utilities (`safeArray`, `safeObject`).                                                                                                                                                                                      | [View Map](src/services/user-profile/codemap.md)     |

## Core Modules

### Embedding — `src/services/embedding.ts`

Calls a remote OpenAI-compatible `/v1/embeddings` endpoint. Produces 1024-dimensional vectors used for semantic memory search. Stateless service consumed by `LocalMemoryClient`.

### AI Provider — `src/services/ai/`

Single provider: **OpenAI Chat Completions** (`providers/openai-chat-completion.ts`). Used for structured memory/profile extraction via tool calls. Supporting modules:

- `ai-provider-factory.ts` — resolves and creates the provider instance.
- `opencode-provider.ts` — opencode SDK structured-output integration.
- `provider-config.ts` — provider configuration resolution.
- `tools/` — canonical tool/function schema contracts for memory/profile extraction.
- `validators/` — validation of LLM-produced structured user-profile data.

### Postgres Storage — `src/services/storage/postgres/`

Postgres + pgvector implementations:

- Lazy client singleton and vector utilities.
- HNSW-backed memory search with weighted scoring (content × 0.6 + tags × 0.4).
- Tri-state prompt capture, JSONB profile data, TTL-based AI sessions.
- Repository interfaces: `MemoryRepository`, `UserPromptRepository`, `UserProfileRepository`, `AISessionRepository`.

### API Handlers — `src/services/api-handlers.ts`

HTTP request handlers for the local API server. Routes user actions (CRUD, search) to repositories and embedding service. New endpoints: `handleContextInject` (memory context for remote client), `handleAutoCapture` (server-side auto-capture), `handleUserProfileLearn` (server-side profile learning), `handleListUserProfiles`, `handleCleanup` (stale memory/prompt cleanup), and tag migration delegation to `tag-migration-service.ts`.

### Supporting Services

- `src/services/client.ts` — `LocalMemoryClient` facade hiding embedding and storage details.
- `src/services/remote-client.ts` — HTTP client: `RemoteMemoryClient` class with CRUD, search, context injection, and auto-capture methods for server-client mode.
- `src/services/auth.ts` — `AuthMiddleware` for Bearer token authentication on API routes.
- `src/services/health-handler.ts` — Health check endpoint: returns server status, DB/embedding readiness, uptime.
- `src/services/auto-capture.ts` — idle-event-driven automatic memory capture (plugin-side).
- `src/services/auto-capture-server.ts` — server-side auto-capture: `generateSummary()` via `AIProviderFactory` (no plugin dependency).
- `src/services/user-memory-learning.ts` — user-profile learning workflows (plugin-side).
- `src/services/user-profile-learner-server.ts` — server-side profile learning: `analyzeUserProfile()` via `AIProviderFactory`.
- `src/services/tag-migration-service.ts` — perpetual background loop for auto-tagging untagged memories via AI.
- `src/services/web-server.ts` — HTTP server with Bearer auth, CORS, static file serving, and all API routes.
- `src/services/context.ts` — memory context formatting for chat injection.
- `src/services/tags.ts` — tag extraction for memories.
- `src/services/logger.ts` — configurable file-based logging with rotation.

### Types — `src/types/`

Shared public TypeScript contracts, including exported memory and provider types.

### Server-Client Architecture

The plugin supports two modes of operation:

- **In-process (legacy)**: All services (storage, embedding, AI) run inside the OpenCode process. This is the default when no `serverUrl` is configured. Uses `src/index.ts` as the plugin factory.
- **Server-client**: A standalone headless server (`src/server.ts`) runs storage, embedding, and business logic independently. The plugin (`src/index-remote.ts`) connects via HTTP using `RemoteMemoryClient` (`src/services/remote-client.ts`). Activated when `serverUrl` + `apiKey` are configured. `plugin.ts` auto-detects the mode at load time.

Both modes share the same REST API surface and WebUI. The server adds: Bearer token authentication (`AuthMiddleware`), health endpoint (`/api/health`), server-side auto-capture and profile learning (no plugin dependency), and a background tag migration loop.

## Architectural Flow

1. `plugin.ts` auto-detects mode → loads `index.ts` (in-process) or `index-remote.ts` (server-client).
2. In-process: `initConfig()` loads JSONC config; server-client: `initClientConfig()` loads `serverUrl`/`apiKey`; server: `initServerConfig()` reads env vars.
3. `chat.message` captures user prompts, retrieves relevant memories (via `LocalMemoryClient` or `RemoteMemoryClient`), and injects formatted memory/profile context.
4. Memory tool and HTTP API route user actions through `api-handlers.ts` → repositories/embedding service.
5. Memory writes compute embeddings via the OpenAI-compatible API, resolve scope, and persist to Postgres with pgvector HNSW indexing.
6. Memory search embeds the query, runs HNSW search (content + tags vectors), and applies weighted scoring in TypeScript.
7. Idle/session events trigger auto-capture and user-profile learning workflows (plugin-side or server-side depending on mode).
8. Server mode: background tag migration loop auto-detects untagged memories, generates tags via AI, and re-embeds vectors.

## Cross-Cutting Design Patterns

- **Facade** — `LocalMemoryClient` and `RemoteMemoryClient` hide embedding, storage, and HTTP details from plugin/API callers.
- **Repository** — storage interfaces decouple business logic from Postgres implementation.
- **Singleton** — module-level instances coordinate embedding, repositories, AI provider, and remote client.
- **Lazy Initialization** — Postgres client and repositories created on first use.
- **Event-Driven Orchestration** — OpenCode hooks and idle events drive capture, context injection, and profile learning.
- **Strategy** — AI provider abstraction (`BaseAIProvider`) enables swapping LLM backends without modifying callers.
- **Middleware** — `AuthMiddleware` intercepts API requests for authentication before routing to handlers.

## Root Assets

- `codemap.md` — this atlas.
- `AGENTS.md` — agent-facing pointer to read the codemap before making changes.
- `package.json` — dependency and script manifest.
