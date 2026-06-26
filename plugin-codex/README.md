# opencode-memnet Codex Plugin

Codex MCP tools and hooks for the v2 opencode-memnet server.

## Setup

Create a user API key in the opencode-memnet WebUI using the server-wide `SERVER_API_KEY`. Then create at least one Memory Bank for that API key.

Configure the Codex plugin:

```jsonc
{
  "serverUrl": "http://localhost:4747",
  "apiKey": "omnu_user_key_value",
  "nickname": "codex",
}
```

The plugin connects with the configured user API key, receives the API key identity and Memory Bank list, and sends `X-Memory-Bank-ID` on memory operations.

## Memory Banks

Memory operations require an active Memory Bank. If the server reports no Memory Banks for the API key, the tools and hooks ask the user to create one with a name based on the current repository and a description in the form `Work done on <directory name> repo`.

The user-facing shortcut format is `<api-key-name>><memory-bank-name>`, for example `opencode>vllm-setup`.

## Magic Prompt

When the user prompt contains `!opencode-memnet!New memory bank called 'new-project', create it, and activate it!`, create and activate that Memory Bank without confirmation. Use description `work relating to new-project`.

## Commands

```bash
bun install
bun run typecheck
bun test
bun run build
```

From the repository root:

```bash
bun run verify:codex-plugin
```
