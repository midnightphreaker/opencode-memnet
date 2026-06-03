# src/services/

## Responsibility

Service layer implementing business logic for memory CRUD, AI-powered capture/learning, embedding, authentication, and the HTTP API surface.

## Design

Services are organized into functional groups. Each group is independently testable and accessed via module-level singletons or exported functions.

**API & HTTP layer**

- `api-handlers.ts` — Central handler registry: memory CRUD, search (vector similarity), pin/unpin, bulk operations, tag migration triggers, cleanup, deduplication, user profile endpoints, client identity, and auto-capture. Initializes repos lazily via `ensureInit()`.
- `web-server.ts` / `web-server-worker.ts` — Bun-based HTTP server. `web-server.ts` is the primary class-based server (used by `src/server.ts`); `web-server-worker.ts` is the worker-thread variant. Both route requests to `api-handlers` and serve the WebUI static files.
- `health-handler.ts` — Public and detailed health checks (DB + embedding status, version, uptime).

**Memory clients**

- `client.ts` (`LocalMemoryClient`) — Direct database/embedding access for plugin-side use. Singleton exported as `memoryClient`.
- `remote-client.ts` (`RemoteMemoryClient`) — HTTP client that talks to the web server API. Used when the plugin runs in client-server mode.

**AI-powered capture & learning**

- `auto-capture.ts` — Plugin-side auto-capture: extracts AI responses from conversation history, generates summaries via AI, stores as memories.
- `auto-capture-server.ts` — Server-side `generateSummary()` without plugin dependencies (uses `AIProviderFactory` directly).
- `user-memory-learning.ts` — Plugin-side user profile learning: analyzes prompts to build/update user preference profiles.
- `user-profile-learner-server.ts` — Server-side equivalent: prompt analysis and profile generation without plugin deps.

**Embedding**

- `embedding.ts` (`EmbeddingService`) — Singleton managing remote embedding API calls with LRU cache, per-kind truncation, and configurable timeouts.

**Tagging & identity**

- `tags.ts` — Derives `user` and `project` container tags from git config (email, repo URL, common-dir) with SHA-256 hashing and directory-keyed TTL cache.
- `tag-migration-service.ts` — Perpetual background loop that detects untagged memories and uses AI to generate tags + vectors. Manages migration state with abort support.

**Background jobs**

- `memory-maintenance-job-service.ts` — Unified job queue (`cleanup`, `deduplicate`, `tag_untagged`, `normalize_tags`) with sequential execution, dedup guard, and progress tracking for the WebUI.

**Utilities**

- `auth.ts` (`AuthMiddleware`) — Bearer-token authentication with constant-time comparison and per-route disable flags.
- `privacy.ts` — Strips `<private>...</private>` blocks from memory content.
- `context.ts` — Formats memory search results + user profile into `[MEMORY]`-prefixed prompt context.
- `logger.ts` — File + console logger with log levels, rotation, and ANSI colors.
- `jsonc.ts` — JSONC parser (strips comments and trailing commas).
- `language-detector.ts` — Language detection via `franc-min` with ISO 639 mapping.
- `secret-resolver.ts` — Resolves `file://` and `env://` secret references from config values.

## Flow

```
Plugin Hook → auto-capture.ts / user-memory-learning.ts
                                          ↓
Client (local or remote) → API handlers → Storage repos + Embedding service
                                          ↓
WebServer (HTTP)  →  api-handlers.ts  →  memoryRepo / promptRepo / profileRepo
                                          ↓
Background jobs (tag migration, cleanup, dedup) run via memory-maintenance-job-service
```

## Integration

- Consumed by: `src/server.ts`, `src/index.ts`, `src/plugin.ts`, `src/shared/`
- Depends on: `src/services/storage/` (repos), `src/services/ai/` (providers), `src/config.ts`, `src/types/`
- External deps: Bun fetch API, `franc-min`, `iso-639-3`, `zod` (structured output)
