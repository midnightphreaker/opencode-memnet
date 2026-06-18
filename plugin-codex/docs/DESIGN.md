# plugin-codex Design

## Overview

`plugin-codex` will be a Codex plugin bundle that connects Codex CLI to the existing `opencode-memnet` server. The plugin will not create a new memory backend. It will act as a Codex-native client that exposes memory operations through MCP tools, lifecycle support through Codex command hooks, and operator guidance through a bundled skill.

This design intentionally differs from the OpenCode plugin where Codex lacks the same runtime hook. OpenCode can mutate chat messages through `chat.message`; Codex should instead receive memory context through MCP tools and MCP server instructions.

## Chosen Approach

Use a TypeScript/Bun package in `plugin-codex/` with three surfaces:

- MCP stdio server for interactive memory tools
- command hooks for lifecycle registration and best-effort capture
- Codex skill for durable usage instructions

This approach keeps the server unchanged, follows Codex's documented extension model, and reuses the existing server API. It also keeps the Codex plugin independently testable because the HTTP client, config loader, identity module, MCP tools, and hook runner can be tested without Codex itself.

## Alternatives Considered

### MCP-Only Package

An MCP-only package would be simpler and enough for manual memory add/search/list/profile workflows. It would not provide automatic connection or capture behavior, so session lifecycle continuity would feel weaker than the OpenCode plugin.

### Hook-Only Package

A hook-only package could register clients and capture prompts, but it would not expose first-class interactive tools. It would also depend too much on hook payload shape and would be harder for Codex to use intentionally.

### Server-Side Codex Endpoint Changes

Server-side Codex-specific endpoints could simplify the client, but the existing server already exposes the needed memory, context, auto-capture, profile, client, and stats APIs. Adding server changes first would increase risk without proving a gap.

## Architecture

The package will be organized around small modules:

- `src/config.ts`: load Codex-specific config from project, user, and env sources
- `src/identity.ts`: persist Codex client ID and produce metadata
- `src/privacy.ts`: strip private blocks and reject fully private content
- `src/tags.ts`: derive project/user tags compatible with the existing server
- `src/http-client.ts`: typed HTTP wrapper for the existing server API
- `src/mcp/server.ts`: MCP stdio entrypoint and tool registration
- `src/mcp/tools.ts`: tool schemas and handlers
- `src/hooks/runner.ts`: shared command hook entrypoint
- `src/hooks/payload.ts`: defensive hook payload parsing
- `skills/opencode-memnet-memory/SKILL.md`: Codex usage guidance
- `.codex-plugin/plugin.json`: Codex plugin manifest
- `hooks/hooks.json`: bundled hook config

The module graph should keep side effects near entrypoints. Config loading, client ID creation, and network calls happen in `src/mcp/server.ts` or `src/hooks/runner.ts`, not during import of leaf modules.

## Data Flow

### Startup and Client Registration

Codex starts the bundled MCP server. The MCP entrypoint loads config, creates or reads the Codex client ID, derives metadata, and calls `/api/client/connect`. Optional configured `nickname` is sent as connection metadata only; the current strict server does not expose nickname update endpoints.

The same registration logic runs from the `SessionStart` hook. Duplicate registration is acceptable because the server upserts the client and updates `lastSeen`.

### Context Retrieval

Codex calls `memory_get_context` when it needs project memory. The tool derives the project tag from the current working directory, then calls `/api/context/inject` with:

- `sessionID` when available
- `projectTag`
- `profileId`
- `repoId`
- `maxMemories`
- `excludeCurrentSession`
- `maxAgeDays`

The tool returns the formatted context string, memory count, and profile status. Codex decides how to use that context in the current turn.

### Manual Memory Operations

The memory tools map directly to existing server endpoints:

- add: `POST /api/memories`
- search: `GET /api/search`
- list: `GET /api/memories`
- forget: `DELETE /api/memories/:id`
- profile: `GET /api/user-profile`
- stats: `GET /api/client/stats`

The client includes `Authorization: Bearer <apiKey>` and `X-Client-ID: <clientId>` on all requests.

### Capture

Hooks read JSON payloads from stdin and pass them to the shared hook runner. The runner extracts a stable session ID, prompt text, available messages, and current working directory when present.

If a payload includes enough conversation data, `memory_capture` or the hook runner calls `/api/auto-capture`. If only a prompt or summary is available, it stores a conservative manual memory through `/api/memories` with metadata:

- `source: "codex-hook"`
- `hookEvent`
- `sessionID`
- `client: "codex"`
- project metadata
- `profileId`
- `repoId`

This preserves useful continuity without inventing messages Codex did not provide.

## Tool Design

Tool names use a `memory_` prefix to keep Codex's tool list readable:

- `memory_connect`
- `memory_get_context`
- `memory_add`
- `memory_search`
- `memory_list`
- `memory_forget`
- `memory_profile`
- `memory_stats`
- `memory_set_nickname`
- `memory_capture`

`memory_set_nickname` is retained only to return a clear unsupported response without an HTTP request.

Each tool returns JSON text with:

- `success`
- `data` when successful
- `error` when failed
- `diagnostics` for non-sensitive troubleshooting details

Deletion requires a concrete `memoryId`. Adding memory rejects empty content, fully private content, and content above the configured size limit.

## Configuration Design

Config is intentionally separate from OpenCode's `~/.config/opencode` path so Codex users can manage it independently:

- `.codex/opencode-memnet.jsonc`
- `~/.config/codex/opencode-memnet.jsonc`
- env fallback

Project config overrides user config. Environment variables fill missing values but do not override explicit project config.

The implementation can reuse parsing and secret-resolution ideas from `shared/`, but it should avoid coupling runtime behavior to OpenCode-specific config names.

## Error Handling

MCP tools should fail visibly but safely. A missing API key returns a configuration error. A server timeout returns a sanitized network error. A server 401 returns an auth error with no token material. Hook failures are logged and return process exit code `0` for non-fatal issues, because memory capture should not block Codex turns.

The exception is private content. Fully private content should be rejected and logged as a blocked capture without sending the content to the server.

## Testing Strategy

Tests should use mocked fetch calls and temporary config directories. They should avoid a live Postgres server for unit and contract coverage.

Required test groups:

- config precedence and JSONC parsing
- identity persistence
- metadata and tag derivation
- HTTP request headers, body, query, timeout, and errors
- MCP tool schemas and handler behavior
- hook payload parsing and fallback capture behavior
- private block stripping and fully private rejection

End-to-end testing against a live `opencode-memnet` server can be added later as an integration suite.

## Packaging

The package should build to `dist/` and expose:

- a bin entry for the MCP server
- a bin entry for hook execution
- a Codex plugin manifest
- bundled `hooks/hooks.json`
- bundled skill directory

The first version should install locally through a Codex local marketplace or direct MCP config. A later version can add publishing metadata.

## Server Compatibility

The first version assumes the current server endpoints are sufficient. If implementation discovers that `/api/auto-capture` cannot support Codex hook payloads, the client must use `/api/memories` fallback rather than changing the server in the same pass.

Server changes should be considered only after the Codex client has working MCP tools and manual memory operations.
