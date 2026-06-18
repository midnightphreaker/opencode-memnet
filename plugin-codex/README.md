# opencode-memnet Codex Plugin

Codex CLI integration for the existing opencode-memnet server.

## Configuration

Create `~/.config/codex/opencode-memnet.jsonc`:

```jsonc
{
  "serverUrl": "http://localhost:4747",
  "apiKey": "your-server-api-key",
  "profileId": "your-profile-id"
}
```

Project-level config may be placed at `.codex/opencode-memnet.jsonc`. Project config overrides global config.

Use `SERVER_API_KEY` for admin access or a profile-scoped key from `PROFILE_KEYS_FILE` for scoped access. Do not store secrets, tokens, or private content in memory.

## Development

```bash
bun install
bun run verify
```

## Direct MCP Setup

```toml
[mcp_servers.opencode-memnet]
command = "opencode-memnet-codex-mcp"
startup_timeout_sec = 10
tool_timeout_sec = 60
```

## Tools

- `memory_connect`
- `memory_get_context`
- `memory_add`
- `memory_search`
- `memory_list`
- `memory_forget`
- `memory_profile`
- `memory_stats`
- `memory_capture`

`memory_set_nickname` is registered only to return a clear unsupported response because the current server does not expose nickname updates.

## Hooks

The bundled hook command is `opencode-memnet-codex-hook`. It connects when configuration exists and records safe, stripped prompt summaries without blocking Codex when the server is unavailable.
