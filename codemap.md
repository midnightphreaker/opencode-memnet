# Repository Atlas: opencode-memnet

## Project Responsibility

A persistent AI memory system for OpenCode — a standalone server that stores, retrieves, and learns from conversation memories using PostgreSQL/pgvector embeddings, with an OpenCode plugin client for automatic context injection and memory capture.

## System Entry Points

- `src/server.ts`: Standalone memory server (HTTP API + embedded web UI for memory management)
- `src/index.ts`: In-process plugin mode — embeds the memory server directly inside OpenCode
- `src/index-remote.ts`: Remote client mode — plugin connects to a standalone server over HTTP
- `src/plugin.ts`: OpenCode plugin entry point (hooks: `chat.message`, `event`)
- `plugin/src/plugin.ts`: OpenCode plugin client (separate package, connects to server)
- `package.json`: Server package manifest (`opencode-memnet-server`)
- `plugin/package.json`: Plugin package manifest (`opencode-memnet-plugin`)
- `docker-compose.yml`: Development environment with PostgreSQL + pgvector

## Architecture Overview

Two-package monorepo with a shared utilities layer:

```
plugin/                    OpenCode plugin client
  └─ src/services/         Remote HTTP client to server
src/                       Memory server (core)
  ├─ services/             Business logic layer
  │   ├─ ai/              AI provider abstraction (OpenAI-compatible + opencode SDK)
  │   ├─ storage/          Persistence layer (PostgreSQL/pgvector)
  │   └─ user-profile/    User profile domain types
  └─ web/                  Embedded web dashboard (HTML/JS/CSS)
shared/                    Cross-module utilities (config, logger, privacy, types)
```

## Key Design Patterns

- **Repository Pattern**: Storage layer abstracts data access behind typed interfaces (`MemoryRepository`, `PromptRepository`, `ProfileRepository`, etc.)
- **Factory Pattern**: `StorageFactory` creates storage backends; `AIProviderFactory` creates AI providers
- **Provider Abstraction**: `BaseAIProvider` → `OpenAIChatCompletionProvider` with tool-call loop for structured extraction
- **Dual AI Path**: Direct OpenAI HTTP provider OR opencode SDK-based provider (delegates auth/routing to host)
- **Plugin Hooks**: OpenCode plugin hooks (`chat.message` for context injection, `event` for auto-capture)
- **Auto-Capture**: Background job service that automatically extracts and stores memories from idle sessions

## Data Flow

1. **Memory Ingestion**: OpenCode conversation → plugin hook → server API → AI extraction (provider tool-call loop) → embedding → PostgreSQL/pgvector storage
2. **Context Retrieval**: OpenCode conversation → plugin hook → server search API → pgvector similarity search → relevant memories injected as context
3. **User Profile Learning**: Captured memories → user-profile-learner → AI analysis → profile updates → persistent storage

## Directory Map (Aggregated)

| Directory                        | Responsibility                                                                                                                     | Detailed Map                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `shared/`                        | Cross-module utilities: config loading, logging, JSONC parsing, secret resolution, privacy redaction, tag generation, shared types | [View Map](shared/codemap.md)                        |
| `plugin/`                        | OpenCode plugin client — injects context, exposes `memory` tool, auto-captures memories via HTTP to the memory server              | [View Map](plugin/codemap.md)                        |
| `src/`                           | Server entry points, configuration, and shared types wiring server/plugin/client modes                                             | [View Map](src/codemap.md)                           |
| `src/types/`                     | Shared value-level types: MemoryType, MemoryMetadata, AIProviderType                                                               | [View Map](src/types/codemap.md)                     |
| `src/services/`                  | Service layer — memory CRUD, AI capture/learning, embedding, authentication, HTTP API surface                                      | [View Map](src/services/codemap.md)                  |
| `src/services/ai/`               | AI provider abstraction with OpenAI-compatible HTTP and opencode SDK paths                                                         | [View Map](src/services/ai/codemap.md)               |
| `src/services/ai/providers/`     | BaseAIProvider abstract class and OpenAIChatCompletionProvider implementation                                                      | [View Map](src/services/ai/providers/codemap.md)     |
| `src/services/ai/tools/`         | ChatCompletionTool interface mirroring OpenAI function-calling format                                                              | [View Map](src/services/ai/tools/codemap.md)         |
| `src/services/ai/validators/`    | UserProfileValidator with static validation chain for profile data                                                                 | [View Map](src/services/ai/validators/codemap.md)    |
| `src/services/storage/`          | PostgreSQL/pgvector persistence layer with repository pattern                                                                      | [View Map](src/services/storage/codemap.md)          |
| `src/services/storage/postgres/` | Concrete PostgreSQL repositories for memories, prompts, profiles, sessions, clients + migrations                                   | [View Map](src/services/storage/postgres/codemap.md) |
| `src/services/user-profile/`     | User profile domain types and safe-deserialization utilities                                                                       | [View Map](src/services/user-profile/codemap.md)     |

## Technology Stack

- **Runtime**: Bun / Node.js (TypeScript)
- **Database**: PostgreSQL with pgvector extension (vector similarity search)
- **AI**: OpenAI-compatible APIs (any provider), opencode SDK
- **HTTP**: Built-in Bun/Node HTTP server (no Express/etc.)
- **Plugin API**: @opencode-ai/plugin, @opencode-ai/sdk
- **Containerization**: Docker + docker-compose for dev
