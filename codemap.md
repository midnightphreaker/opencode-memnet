# Repository Atlas: opencode-memnet

## Project Responsibility
A persistent AI memory system for OpenCode. Captures technical knowledge from coding sessions (auto-capture), stores it with vector embeddings in PostgreSQL (pgvector), and injects relevant context back into future conversations. Supports both a standalone server deployment and an in-process plugin mode.

## Architecture Overview
```
┌─────────────────────────────────────────────────────────┐
│                    OpenCode Process                       │
│  ┌──────────────────────────┐                            │
│  │  plugin/ (client bundle)  │ ← chat.message, event hooks│
│  │  - tool.memory            │                            │
│  │  - RemoteMemoryClient     │──────── HTTP ────────┐     │
│  └──────────────────────────┘                       │     │
│                                                     │     │
│  ┌──────────────────────────┐                       │     │
│  │  src/ (legacy in-process)│ ← direct DB access    │     │
│  │  - LocalMemoryClient      │                       │     │
│  └──────────────────────────┘                       │     │
│                                                     │     │
└─────────────────────────────────────────────────────│─────┘
                                                      │
┌─────────────────────────────────────────────────────│─────┐
│  Standalone Server (src/server.ts)                   │     │
│  ┌──────────────────┐  ┌──────────────────┐         │     │
│  │  WebServer        │  │  API Handlers     │←────────┘     │
│  │  (Bun HTTP)       │  │  (CRUD, search,   │               │
│  │  + WebUI serving  │  │   auto-capture,   │               │
│  └──────────────────┘  │   profiles, etc.)  │               │
│                         └────────┬──────────┘               │
│                                  │                          │
│  ┌──────────────────┐  ┌────────▼──────────┐               │
│  │  EmbeddingService │  │  Storage Layer     │               │
│  │  (OpenAI compat)  │  │  (Postgres+pgvector│               │
│  └──────────────────┘  └────────────────────┘               │
│                                                             │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │  AI Providers     │  │  Background Jobs  │                │
│  │  (OpenCode SDK /  │  │  - Tag Migration  │                │
│  │   Direct API)     │  │  - Profile Learn  │                │
│  └──────────────────┘  └──────────────────┘                │
└─────────────────────────────────────────────────────────────┘
```

## System Entry Points
| Entry Point | Trigger | Description |
|-------------|---------|-------------|
| `src/server.ts` | `bun run start:server` / Docker | Standalone HTTP server. Initializes Postgres, embeddings, web server, background tag migration. |
| `plugin/src/plugin.ts` | OpenCode plugin loader | Remote client plugin. Connects to server via HTTP. Registers hooks. |
| `src/index.ts` | (Deprecated) | Legacy in-process plugin. Direct DB access. Removed in v3.0.0. |

## Core Concepts
- **Container Tags**: SHA256 hashes of git identity → scoping memories to user/project
- **Memory Scope**: `project` (single project shard) or `all-projects` (cross-project search)
- **Auto-Capture**: On `session.idle`, extracts conversation context → AI summary → stored as memory
- **Profile Learning**: Batches of user prompts analyzed by AI → user preference/pattern/workflow profile
- **Compaction Recovery**: On `session.compacted`, searches memories by session ID → injects restored context
- **Dual AI Path**: opencode SDK (structured output via transient sessions) preferred over direct API (tool-call completion)

## Directory Map (Aggregated)

| Directory | Responsibility Summary | Detailed Map |
|-----------|------------------------|--------------|
| `src/` | Server source: entry points, configuration, type definitions | [View Map](src/codemap.md) |
| `src/services/` | Core service layer: client abstractions, HTTP server, auto-capture, embedding, auth, tags | [View Map](src/services/codemap.md) |
| `src/services/storage/` | Repository pattern over PostgreSQL with lazy-loaded implementations | [View Map](src/services/storage/codemap.md) |
| `src/services/ai/` | AI provider abstraction (OpenCode SDK + direct API) for structured output | [View Map](src/services/ai/codemap.md) |
| `src/services/user-profile/` | User profile type definitions and parsing utilities | [View Map](src/services/user-profile/codemap.md) |
| `src/web/` | Memory Explorer SPA — vanilla JS single-page app for managing memories | [View Map](src/web/codemap.md) |
| `src/types/` | Server-side type re-exports | [View Map](src/types/codemap.md) |
| `shared/` | Client-server shared code: tags, logger, config, privacy, JSONC parser | [View Map](shared/codemap.md) |
| `plugin/` | OpenCode plugin bundle (remote client architecture) | [View Map](plugin/codemap.md) |

## Configuration
- Server: `~/.config/opencode/opencode-memnet.jsonc` (JSONC with comments)
- Client: Same file + `.opencode/opencode-memnet.jsonc` (project-level overrides)
- Environment: `DATABASE_URL`, `PORT`, `HOST`, `SERVER_API_KEY`, `LOG_LEVEL`, `DEBUG`
- Secrets: Support `env://VAR` and `file://path` references for API keys

## Key Dependencies
- `postgres` + `pgvector`: Vector storage and similarity search
- `@opencode-ai/plugin` + `@opencode-ai/sdk`: OpenCode plugin API and v2 client
- `franc-min` + `iso-639-3`: Language detection for auto-capture matching
- `zod`: Schema validation for structured AI outputs
- `marked` + `dompurify`: WebUI markdown rendering
