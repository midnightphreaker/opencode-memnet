# plugin/

## Responsibility

OpenCode plugin client that connects to the opencode-memnet server to inject conversation context, expose a `memory` tool, and auto-capture memories from idle sessions.

## Design

- **Entry point**: `src/plugin.ts` — a top-level await resolves configuration, then dynamically imports `index-remote.ts` (or returns a noop plugin if unconfigured). Exports a `PluginModule` with `{ id, server }`.
- **Plugin hooks registered** (declared in `package.json` opencode config):
  - `chat.message` — intercepts user messages, fetches relevant memory context from the server, and prepends a synthetic `Part` to the output.
  - `event` — listens for `session.idle` (triggers auto-capture with debounce) and `session.compacted` (restores session memories via a silent prompt).
- **Tool registration**: registers a `memory` tool via `@opencode-ai/plugin`'s `tool()` builder supporting modes: `add`, `search`, `profile`, `list`, `forget`, `help`.
- **Remote client**: `src/services/remote-client.ts` — `RemoteMemoryClient` class wrapping fetch-based HTTP calls to server endpoints (`/api/context/inject`, `/api/memories`, `/api/search`, `/api/auto-capture`, `/api/client/connect`, `/api/user-profile`). Singleton via `getRemoteClient()`.
- **Client identity**: `src/client-identity.ts` — generates and persists a UUID to `~/.config/opencode/opencode-memnet-client-id` for server-side client tracking.
- **Build**: `build.ts` uses Bun to bundle `src/plugin.ts` into a single ESM file (`dist/opencode-memnet.js`), externalizing `@opencode-ai/plugin` and `@opencode-ai/sdk`, and copies a rewritten `package.json` into dist.

## Flow

1. OpenCode loads the plugin → `plugin.ts` top-level await calls `resolvePlugin()`.
2. `resolvePlugin()` reads config via `shared/client-config`, checks `serverUrl` + `apiKey`.
3. If configured, imports `OpenCodeMemPlugin` from `index-remote.ts`.
4. Plugin init connects to server (`clientConnect`), resolves tags, shows welcome toast.
5. On each `chat.message` hook: extracts user text → `getContext` from server → prepends context `Part`.
6. On `session.idle` event: debounces 10s → fetches session messages → `autoCapture` to server → shows toast.
7. On `session.compacted` event: searches memories by session ID → injects restored memory as a `noReply` prompt.

## Integration

- Consumed by: OpenCode runtime loads this as a plugin via `@opencode-ai/plugin` / `@opencode-ai/sdk`.
- Depends on:
  - `../shared/` — `client-config` (config loading), `tags` (project/user resolution), `privacy` (content sanitization), `logger` (structured logging).
  - Server REST API endpoints: `/api/context/inject`, `/api/memories`, `/api/search`, `/api/auto-capture`, `/api/client/connect`, `/api/client/stats`, `/api/user-profile`.
