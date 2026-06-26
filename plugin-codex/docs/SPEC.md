# plugin-codex Specification

`plugin-codex` connects Codex MCP tools and hooks to the v2 opencode-memnet server.

## Configuration

The plugin reads project and user JSONC config plus environment fallbacks for server URL, API key, nickname, timeout, memory, context, and capture settings. Runtime config does not expose legacy profile scope.

Required client settings:

- `serverUrl`
- `apiKey`

Optional client settings:

- `nickname`
- `timeoutMs`
- `memory.defaultScope`
- `context.maxMemories`
- `context.maxAgeDays`
- `context.excludeCurrentSession`
- `capture.enabled`
- `capture.includeRawHookPayload`

## Connection

On MCP startup and hooks, the client calls `POST /api/client/connect` with `includeStats: false`. The response is the v2 client connect contract:

- user API key principal identity
- available Memory Banks
- whether a Memory Bank is required before memory operations

## Memory Banks

Memory operations require an active Memory Bank. The current implementation chooses the first returned bank. If no bank exists, tools fail with a clear no-bank message and hooks skip context/capture with `missing-memory-bank`.

All memory, search, context, profile, stats, and capture requests include `X-Memory-Bank-ID`.

## Tools

The MCP server exposes:

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

Secrets must not be printed in logs, hook output, tool responses, or docs.
