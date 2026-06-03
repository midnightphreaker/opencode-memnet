# plugin-codex Specification

## Purpose

`plugin-codex` provides the Codex CLI equivalent of the existing OpenCode plugin. It connects Codex to the existing `opencode-memnet` server so Codex can use the same memory store, client identity registry, nickname system, project tags, user profile retrieval, and manual memory operations already used by the OpenCode client.

The Codex integration must preserve the server as the source of truth. The first implementation must not require server changes.

## Background

The current OpenCode plugin performs three jobs:

- registers a persistent client ID and optional nickname with the server
- exposes memory commands for add, search, list, forget, profile, and stats
- retrieves memory context and auto-captures session summaries through OpenCode hooks

Codex exposes different integration points. It supports plugins that can bundle skills, MCP servers, and command hooks. Codex does not expose an OpenCode-style `chat.message` hook that can silently prepend synthetic message parts. The equivalent Codex experience must be built from MCP tools, MCP server instructions, and command hooks.

## Goals

- Provide a Codex plugin package under `plugin-codex/`.
- Communicate with the existing `opencode-memnet` server over HTTP.
- Reuse the existing server endpoints for memory CRUD, search, context retrieval, auto-capture, profile lookup, client registration, nickname updates, and client stats.
- Persist a Codex-specific client ID and register it with `/api/client/connect`.
- Support nickname sync through config and `/api/client/nickname`.
- Expose Codex-visible MCP tools for common memory workflows.
- Bundle Codex hooks for best-effort lifecycle registration and capture.
- Bundle a Codex skill that tells Codex when and how to use the memory MCP tools.
- Keep secrets out of logs, hook output, memory content, and docs.

## Non-Goals

- Do not replace Codex built-in memories.
- Do not modify `src/server.ts`, server migrations, repository schema, or WebUI for the first version.
- Do not implement a direct chat-message mutation layer; Codex does not provide the OpenCode `chat.message` API.
- Do not copy implementation code from AGPL projects such as `codex-mem`.
- Do not introduce a second database, vector store, or local memory schema.

## Functional Requirements

### Configuration

The Codex plugin must load configuration from Codex-oriented locations first:

- project config: `.codex/opencode-memnet.jsonc`
- user config: `~/.config/codex/opencode-memnet.jsonc`
- environment fallback: `OPENCODE_MEMNET_SERVER_URL`, `OPENCODE_MEMNET_API_KEY`, and `OPENCODE_MEMNET_NICKNAME`

The config must support:

- `serverUrl`: base URL for the existing memory server
- `apiKey`: bearer token for the existing server
- `nickname`: optional Codex client nickname
- `timeoutMs`: HTTP timeout, default `30000`
- `memory.defaultScope`: default `project`
- `context.maxMemories`: default `5`
- `context.maxAgeDays`: nullable, default `null`
- `context.excludeCurrentSession`: default `true`
- `capture.enabled`: default `true`
- `capture.includeRawHookPayload`: default `false`

### Client Identity

The plugin must persist a stable Codex client ID at:

`~/.config/codex/opencode-memnet-client-id`

On MCP server startup and on `SessionStart`, the client must call:

- `POST /api/client/connect`
- `PUT /api/client/nickname` when configured nickname differs from the server nickname

Metadata sent to the server must include:

- `client: "codex"`
- `runtime: "codex-cli"`
- `hostname`
- `platform`
- `cwd`
- `projectName`
- `gitRepoUrl` when available

### Project Tags

The Codex plugin must generate the same kind of project and user tags as the OpenCode plugin by reusing the shared tag algorithm when possible. The tag prefix must remain `opencode` for compatibility with existing stored memories unless a future server setting exposes a different prefix.

### MCP Tools

The MCP server must expose these tools:

- `memory_connect`: register the Codex client and return nickname/stats
- `memory_get_context`: fetch formatted context from `/api/context/inject`
- `memory_add`: add a memory to `/api/memories`
- `memory_search`: search memories through `/api/search`
- `memory_list`: list recent memories through `/api/memories`
- `memory_forget`: delete a memory through `/api/memories/:id`
- `memory_profile`: read the active user profile through `/api/user-profile`
- `memory_stats`: read client stats through `/api/client/stats`
- `memory_set_nickname`: update the Codex client nickname through `/api/client/nickname`
- `memory_capture`: submit a best-effort capture payload through `/api/auto-capture` when enough conversation data exists, otherwise save a manual memory with `source: "codex-hook"`

### MCP Instructions

The MCP server must return instructions that tell Codex:

- call `memory_get_context` at the start of work when project context or prior decisions may matter
- call `memory_search` for targeted recall
- call `memory_add` only for durable facts, user preferences, decisions, and repeatable workflows
- call `memory_capture` near the end of substantial work when the session contains useful durable context
- never store secrets, credentials, private keys, or raw sensitive payloads

### Hooks

The plugin must bundle command hooks for:

- `SessionStart`: connect client and sync nickname
- `UserPromptSubmit`: best-effort prompt capture or hook-event audit, depending on available payload
- `Stop`: best-effort session capture
- `PostCompact`: attempt to preserve continuity by asking the server for context associated with the current session or project

Hook scripts must:

- read JSON payloads from stdin
- tolerate unknown or missing fields
- never print secrets
- return success for non-fatal capture failures so hooks do not block Codex work
- log diagnostics to the plugin log file rather than stdout

### Packaging

The plugin must be installable as a Codex plugin bundle with:

- `.codex-plugin/plugin.json`
- bundled MCP server configuration
- bundled hook configuration
- bundled memory skill
- npm package metadata for local development and builds

### Compatibility

The first version must support Codex CLI through MCP stdio. Streamable HTTP MCP can be added later if needed.

The plugin must use the existing server API contract used by `plugin/src/services/remote-client.ts`. Server changes are allowed only if implementation proves a hard gap that cannot be solved client-side.

## Error Handling

- Missing config must make the MCP server start with tools that return clear configuration errors.
- HTTP failures must return structured MCP tool errors with status, endpoint, and sanitized message.
- Client registration failure must not prevent manual `memory_search` or `memory_add` from working when server auth is valid.
- Nickname sync failure must be reported in `memory_connect` and plugin logs.
- Hook failures must not write sensitive payloads or fail closed unless an explicit safety violation is detected.

## Security

- API keys must come from config or environment and must never be printed.
- `<private>...</private>` blocks must be stripped before memory storage.
- Fully private content must be rejected for `memory_add` and hook capture.
- Logs must redact bearer tokens, API keys, and obvious secret-like values.
- MCP tools that delete or overwrite data must use explicit IDs and return the affected ID.

## Test Requirements

- Unit tests for config loading precedence.
- Unit tests for client ID persistence and metadata shape.
- Unit tests for private-content stripping and fully private rejection.
- Unit tests for HTTP client request construction and error handling.
- MCP contract tests for every tool schema.
- Hook tests for stdin payload handling, missing fields, and failure behavior.
- Build/typecheck verification for the package.

## Acceptance Criteria

- `plugin-codex` can be built without modifying server code.
- Codex can start the MCP server over stdio.
- `memory_connect` registers a Codex client with the existing server.
- Configured nickname appears through `/api/client/stats`.
- `memory_add`, `memory_search`, `memory_list`, `memory_forget`, `memory_profile`, and `memory_stats` work against the existing server.
- `memory_get_context` returns the same formatted memory/profile context shape as the OpenCode plugin receives.
- Hooks are packaged and can run without crashing when Codex sends partial or unexpected payloads.
- No test, log, or fixture contains a real secret.
