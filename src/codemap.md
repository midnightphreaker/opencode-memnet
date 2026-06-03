# src/

## Responsibility

Top-level entry points, configuration, and shared types for the opencode-memnet memory system — wiring server, plugin, and client modes into a coherent application.

## Design

**Three deployment modes, one plugin interface (`OpenCodeMemPlugin`):**

- **Standalone server** (`server.ts`) — HTTP server with embedded storage/embedding; reads env vars via `server-config.ts`.
- **In-process plugin** (`index.ts`) — Legacy mode (deprecated). Runs the full memory stack inside the opencode plugin host.
- **Remote client plugin** (`index-remote.ts`) — Thin plugin that delegates all memory ops to the standalone server via `remoteMemoryClient`.

**Plugin resolution** (`plugin.ts`) — Auto-detects mode: if `serverUrl` + `apiKey` are configured, loads `index-remote.ts` (remote mode); otherwise falls back to `index.ts` (legacy in-process). Exports a `PluginModule` for the opencode runtime.

**Configuration layers:**

- `config.ts` — Merges global (`~/.config/opencode/opencode-memnet.jsonc`) + per-project (`.opencode/opencode-memnet.json`) config files. Manages both full `CONFIG` (in-process) and `CLIENT_CONFIG` (remote). Bridges server config into global `CONFIG` via `serverConfigToGlobalConfig()`.
- `server-config.ts` — Env-var-driven config for the standalone server. Defines the `ServerConfig` interface with PostgreSQL, embedding, LLM, and auth settings.

**Types** (`types/index.ts`) — `MemoryMetadata` (extensible per-memory metadata), `MemoryType` (string alias), `AIProviderType` (currently `"openai-chat"`).

## Flow

1. **Server mode:** `server.ts` → `initServerConfig()` → validate → `serverConfigToGlobalConfig()` → `initializeStorage()` → `embeddingService.warmup()` → `startWebServer()` → listen for SIGINT/SIGTERM with drain & cleanup.
2. **Plugin mode (remote):** `plugin.ts` resolves `index-remote.ts` → `initClientConfig()` → registers `chat.message`, `tool.memory`, `event` hooks via `remoteMemoryClient` HTTP calls.
3. **Plugin mode (legacy):** `plugin.ts` resolves `index.ts` → `initConfig()` → warmup embedding client → registers same hooks using local `memoryClient`, storage repos, and AI services.

## Integration

- **Consumed by:** opencode runtime (loads `plugin.ts` as a `PluginModule`); standalone server process (runs `server.ts` via `node dist/server.js`).
- **Depends on:** `services/` (client, storage, embedding, AI, web-server, tags, privacy, auto-capture, user-memory-learning, logger); `@opencode-ai/plugin`, `@opencode-ai/sdk`.
