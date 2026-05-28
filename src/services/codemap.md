# src/services/

## Responsibility
Core service layer implementing the business logic for the memory system: client abstractions, HTTP server, auto-capture pipeline, user profile learning, embedding generation, authentication, and tag management.

## Design Patterns
- **Singleton**: `memoryClient`, `embeddingService`, `remoteMemoryClient` are module-level singletons
- **Lazy Proxy**: Storage repositories use lazy dynamic imports (`PostgresMemoryRepositoryLazy`) to defer postgres client loading
- **Strategy**: AI provider selection via `AIProviderFactory.createProvider(type, config)` with `openai-chat` as the primary provider
- **Template Method**: Auto-capture and profile learning have dual paths — opencode-provider (structured output via SDK) and manual API (tool-call completion)

## Key Modules

| File | Purpose |
|------|---------|
| `client.ts` | `LocalMemoryClient` — in-process CRUD + vector search against Postgres. Used in legacy in-process mode. |
| `remote-client.ts` | `RemoteMemoryClient` — HTTP client delegating all operations to the server API. Used in server-client mode (src/index-remote.ts). |
| `web-server.ts` | Bun HTTP server (`WebServer` class) — serves static WebUI files + routes `/api/*` to `api-handlers.ts`. Includes CORS, auth middleware, body size limits. |
| `api-handlers.ts` | Request handler functions for every API route (CRUD, search, stats, pin/unpin, migration, cleanup, dedup, profiles, client identity). |
| `auto-capture.ts` | `performAutoCapture()` — triggered on `session.idle` event. Extracts AI responses + tool calls, sends to AI for summarization, stores as memory. Plugin-only path. |
| `auto-capture-server.ts` | Server-side equivalent of auto-capture AI summary generation (no plugin dependency). |
| `user-memory-learning.ts` | `performUserProfileLearning()` — analyzes accumulated prompts to build/update user preference profiles. Plugin-only. |
| `user-profile-learner-server.ts` | Server-side equivalent for profile learning AI calls. |
| `embedding.ts` | `EmbeddingService` — calls OpenAI-compatible embedding API, manages LRU cache, handles truncation (left/right) per kind (content/tags/query/migration). |
| `auth.ts` | `AuthMiddleware` — Bearer token authentication for API routes. Supports disabling WebUI and client auth independently. |
| `context.ts` | `formatContextForPrompt()` — builds the `[MEMORY]` prefix injected into chat prompts, combining user profile + project memories. |
| `tags.ts` | Git-based project/user identity resolution → SHA256 container tags. Cached per directory with 1-minute TTL. |
| `tag-migration-service.ts` | Perpetual background loop that auto-tags untagged memories using AI, with progress tracking. |
| `language-detector.ts` | Detects text language via `franc-min` + `iso-639-3` for auto-capture language matching. |
| `privacy.ts` | Strips `<private>...</private>` blocks from content before storage. |
| `health-handler.ts` | `/api/health` — returns DB + embedding service status, uptime, version. |
| `jsonc.ts` | JSONC parser (strips comments + trailing commas). Duplicate of `shared/jsonc.ts` for server Docker build. |
| `secret-resolver.ts` | Resolves `file://`, `env://`, and literal secret values. Duplicate of `shared/secret-resolver.ts` for server build. |
| `logger.ts` | Leveled logger (debug/info/warn/error) with file rotation + console filtering. Duplicate of `shared/logger.ts` for server build. |
| `web-server-worker.ts` | Legacy Bun Worker-based server (superseded by inline handling in `web-server.ts`). |

## Flow
1. Auto-capture: `session.idle` → 10s debounce → `performAutoCapture()` → extract AI content → AI summary → `memoryClient.addMemory()`
2. Profile learning: Same idle event → `performUserProfileLearning()` → batch analyze prompts → AI structured output → `profileRepo.updateProfile()`
3. Chat injection: `chat.message` hook → search memories → `formatContextForPrompt()` → prepend synthetic `[MEMORY]` part

## Integration
- Consumed by: `src/index.ts` (legacy), `src/index-remote.ts` (client), `src/server.ts` (standalone server)
- Depends on: `src/services/storage/` (repos), `src/services/ai/` (providers), `src/config.ts` (config)
