# plugin/

## Responsibility
OpenCode plugin bundle that runs inside the opencode process. Implements the remote client architecture — delegates all memory operations to the standalone server via HTTP.

## Design
- Built with `bun run build.ts` into a single ESM bundle (`dist/opencode-memnet.js`)
- Externalizes `@opencode-ai/plugin` and `@opencode-ai/sdk` (provided by opencode runtime)
- Imports shared utilities directly from `../shared/` which get bundled
- Registers three hooks: `chat.message` (context injection), `tool.memory` (memory CRUD), `event` (auto-capture on idle, memory restoration on compaction)

## Key Files

| File | Purpose |
|------|---------|
| `src/plugin.ts` | Entry point. Resolves config, conditionally loads `index-remote.ts` or returns noop. Exports `PluginModule` with `id` and `server`. |
| `src/index-remote.ts` | Main plugin logic: hooks for chat injection, memory tool, idle auto-capture, compaction restoration. Uses `RemoteMemoryClient` for all server communication. |
| `src/client-identity.ts` | Generates and persists a UUID client ID to `~/.config/opencode/opencode-memnet-client-id`. Provides hostname/platform metadata. |
| `src/services/remote-client.ts` | `RemoteMemoryClient` — HTTP client with Bearer auth + X-Client-ID header. Wraps all API endpoints: context injection, auto-capture, memory CRUD, search, profile, client connect/stats. |
| `build.ts` | Bun build script. Bundles to `dist/`, copies and rewrites `package.json` paths. |
| `package.json` | Plugin manifest with `opencode.type: "plugin"` and hooks declaration. |

## Flow
1. OpenCode loads plugin → `src/plugin.ts` → `resolvePlugin()` → checks config
2. If configured → loads `index-remote.ts` → initializes `RemoteMemoryClient` with client ID
3. Client connects to server → receives welcome/stats info → shows toast
4. `chat.message` hook → `POST /api/context/inject` → prepend memory context
5. `tool.memory` → routes to appropriate server API based on mode
6. `session.idle` → 10s debounce → `POST /api/auto-capture` with conversation messages
7. `session.compacted` → `GET /api/search` by session ID → inject restored memories

## Integration
- Loaded by: OpenCode plugin system (resolves `dist/opencode-memnet.js`)
- Communicates with: Server at `CLIENT_CONFIG.serverUrl` via HTTP
- Depends on: `shared/` (logger, client-config, tags, privacy, jsonc, secret-resolver)
