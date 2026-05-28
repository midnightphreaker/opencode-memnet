# src/

## Responsibility
Server and legacy plugin source code. Contains the standalone HTTP server, two plugin entry points (legacy in-process and remote client), configuration system, and all service modules.

## Entry Points

| File | Purpose |
|------|---------|
| `server.ts` | Standalone server — loads config, initializes Postgres storage, warms up embeddings, starts HTTP server, launches background tag migration |
| `index.ts` | Legacy in-process plugin (deprecated in v3.0.0). Registers `chat.message`, `tool.memory`, and `event` hooks directly. |
| `index-remote.ts` | Remote client plugin — delegates all operations to server via `RemoteMemoryClient`. Used by `plugin/` bundle. |
| `plugin.ts` | Deprecated plugin re-export |

## Configuration

| File | Purpose |
|------|---------|
| `config.ts` | Full server+plugin config from `~/.config/opencode/opencode-memnet.jsonc`. Handles JSONC parsing, secret resolution (`env://`, `file://`), defaults merging. Exports `CONFIG`, `isConfigured()`, `initConfig()`. Also contains `CLIENT_CONFIG` path and `serverConfigToGlobalConfig()` bridge. |
| `server-config.ts` | Server-specific config loading from environment variables (PORT, HOST, DATABASE_URL, SERVER_API_KEY, etc.). Validates and normalizes. |

## Key Design Decisions
- **Dual config system**: `config.ts` serves both server (full config) and client (subset). `server-config.ts` bridges env vars into the global CONFIG.
- **Three deployment modes**: (1) Legacy in-process plugin (`index.ts`), (2) Standalone server (`server.ts`), (3) Remote client plugin (`index-remote.ts` → `plugin/`)
- **AI provider priority**: opencode SDK provider (structured output via transient sessions) takes precedence over direct API provider (tool-call completion)

## Flow (Server Mode)
1. `server.ts` → `initServerConfig()` + validate → bridge to global CONFIG
2. `initializeStorage()` → Postgres migrations → all repos ready
3. `embeddingService.warmup()` → embedding API reachable
4. `startWebServer()` → Bun HTTP server on configured port
5. Background: `runTagMigration()` perpetual loop for auto-tagging
6. API requests → `web-server.ts` routing → `api-handlers.ts` → storage repos + embedding service

## Integration
- `server.ts` consumed by: Docker, `bun run start:server`, `dist/server.js`
- `index-remote.ts` consumed by: `plugin/src/index-remote.ts` (bundled into `plugin/dist/`)
- Depends on: `src/services/`, `src/types/`, `shared/`
