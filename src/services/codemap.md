# src/services/

## Responsibility

- **Core service layer** for opencode-memnet: coordinates memory storage, vector embeddings, AI-powered capture/learning, and the web dashboard API.
- Provides the main public facade (`LocalMemoryClient`) that the plugin layer calls into for CRUD and vector search on memories.
- Provides a **remote HTTP client** (`RemoteMemoryClient`) for connecting to an opencode-memnet server instance from external processes.
- Houses the **auto-capture pipeline** that observes conversations and distills them into saved memories via LLM summarization — both plugin-side (`auto-capture.ts`) and server-side (`auto-capture-server.ts`).
- Runs **user profile learning** — periodic analysis of user prompts to build/maintain behavioral profiles (preferences, patterns, workflows) — both plugin-side (`user-memory-learning.ts`) and server-side (`user-profile-learner-server.ts`).
- Exposes a **REST API surface** (`api-handlers.ts`) consumed by the built-in web server for the dashboard UI, protected by Bearer token authentication (`AuthMiddleware`).
- Runs a **perpetual background tag migration loop** (`tag-migration-service.ts`) that auto-detects untagged memories, generates tags via AI, re-embeds vectors, and exposes progress to the WebUI.
- Supplies cross-cutting utilities: tagging/identity, privacy redaction, JSONC parsing, language detection, configurable logging, and secret resolution.

## Design

- **Singleton patterns**: `EmbeddingService` uses a global Symbol key for cross-worker dedup; `memoryClient` and repository factories produce singletons. Module-level flags (`isCaptureRunning`, `isLearningRunning`) prevent concurrent pipeline runs.
- **Lazy initialization**: Both `LocalMemoryClient` and API handlers use an `initialize()` / `ensureInit()` pattern that runs DB migrations once on first use, avoiding heavy startup cost.
- **Two AI provider paths**: Every AI-calling service (auto-capture, user-learning, tag migration) supports (1) an opencode-connected provider via `generateStructuredOutput` with Zod schemas, and (2) a standalone provider via `AIProviderFactory` with function-calling tool schemas.
- **Server-side AI pipeline**: `auto-capture-server.ts` and `user-profile-learner-server.ts` mirror the plugin-side capture/learning logic but use `AIProviderFactory` directly (no OpenCode plugin dependency), enabling the HTTP API server to generate summaries and learn profiles autonomously.
- **Remote-only embeddings**: `EmbeddingService` calls an OpenAI-compatible `/embeddings` HTTP endpoint. It handles truncation (left/right per kind), caches results keyed by model+text+params, and aborts after 30 s timeout.
- **Scope resolution via container tags**: Memories are partitioned by `{prefix}_{scope}_{hash}` tags (user vs project). `MemoryScope` ("project" | "all-projects") controls whether search/list filters to one project or crosses all.
- **Guarded re-entrancy**: Boolean flags (`isCaptureRunning`, `isLearningRunning`) serialize the auto-capture and profile-learning pipelines to avoid duplicate work when hooks fire concurrently.
- **Authenticated API**: `AuthMiddleware` (`auth.ts`) validates Bearer tokens on all `/api/*` routes (except `/api/health`). The web server reads `SERVER_API_KEY` at startup and rejects unauthenticated requests with 401 responses.
- **Server-client architecture**: `RemoteMemoryClient` (`remote-client.ts`) is an HTTP client that external consumers use to talk to the opencode-memnet server. It wraps all API endpoints (context injection, auto-capture, memory CRUD, search, user profiles) and is exported as a module-level singleton `remoteMemoryClient`.
- **Background tag migration**: `tag-migration-service.ts` runs a perpetual loop on the server that detects untagged memories, generates tags via AI, re-embeds vectors, and tracks progress. It supports abort via `stopMigration()` and progress queries via `getMigrationProgress()`.
- **Configurable logging**: `logger.ts` supports `OPENCODE_MEM_LOG_FILE` env var for custom log file paths; defaults to `~/.opencode-memnet/opencode-memnet.log`. Includes log rotation at 5 MB.

## Flow

1. **Plugin hook** receives a user prompt → `tags.ts` resolves user/project identity → prompt is stored unanalyzed.
2. After the AI responds, `auto-capture.ts` claims the uncaptured prompt, fetches AI messages, builds markdown context, and calls an LLM to summarize. If the result is "skip", the prompt is deleted; otherwise the summary is embedded and persisted as a memory via `LocalMemoryClient`.
3. `user-memory-learning.ts` runs on a configurable interval — when enough unanalyzed prompts accumulate, it sends them (plus any existing profile) to an LLM to extract preferences/patterns/workflows, then upserts the profile via `UserProfileRepository`.
4. `context.ts` assembles the `[MEMORY]` injection block: it retrieves the user profile and project memories, formats them with similarity percentages, and returns the string that gets prepended to prompts.
5. **Web dashboard** requests hit `web-server.ts` (or its worker variant) → `AuthMiddleware` validates the Bearer token → routes to `api-handlers.ts` functions → handlers call repositories/embedding-service directly, bypassing `LocalMemoryClient` for richer operations (search across memories+prompts, pagination, cascade deletes, tag migration).
6. **Health check**: `/api/health` (unauthenticated) returns `{ status, version, dbConnected, embeddingReady, uptime }` via `health-handler.ts`. The server calls `setDbConnected(true)` after successful startup.
7. **Server-side auto-capture**: API route `/api/auto-capture` → `handleAutoCapture()` → delegates to `auto-capture-server.ts` → `generateSummary()` uses `AIProviderFactory` to produce a memory summary without the plugin dependency.
8. **Server-side profile learning**: API route `/api/user-profile/learn` → `handleUserProfileLearn()` → delegates to `user-profile-learner-server.ts` → `analyzeUserProfile()` builds/updates the user profile using `AIProviderFactory`.
9. **Tag migration**: API routes `/api/migration/*` → handlers delegate to `tag-migration-service.ts` for detection, batch runs, progress queries, and resets. The background loop auto-detects untagged memories and tags them continuously.
10. **Remote client**: External processes instantiate `RemoteMemoryClient` with a server URL and API key → call `getContext()`, `autoCapture()`, `searchMemories()`, `addMemory()`, etc. → requests are authenticated with Bearer tokens and routed to the web server.

## Integration

- **Upstream**: `src/index.ts` (plugin entry) instantiates `LocalMemoryClient`, starts `WebServer`, and hooks `performAutoCapture` / `performUserProfileLearning` into the opencode plugin lifecycle.
- **Storage layer** (`src/services/storage/`): All data access goes through repository interfaces (`MemoryRepository`, `UserPromptRepository`, `UserProfileRepository`) created by `storage/factory.ts`.
- **AI layer** (`src/services/ai/`): Auto-capture, user-learning, and tag migration dynamically import `AIProviderFactory` and `opencode-provider` for LLM calls; embedding uses `CONFIG.embeddingApiUrl` directly via HTTP.
- **Config** (`src/config.ts`): Every service reads from the centralized `CONFIG` singleton for model names, API URLs, thresholds, and feature flags.
- **Tags** (`tags.ts`): Shared by auto-capture, user-learning, and API handlers to resolve container tags from git identity and project paths; results are cached for 1 minute.
- **Auth** (`auth.ts`): `WebServer` instantiates `AuthMiddleware` with `SERVER_API_KEY` and applies it to all `/api/*` routes except `/api/health`. `RemoteMemoryClient` sends the same key as a Bearer token on every request.
- **Tag migration service** (`tag-migration-service.ts`): Imported by `api-handlers.ts` for on-demand batch runs and progress queries; can also run as a perpetual background loop on server startup.
