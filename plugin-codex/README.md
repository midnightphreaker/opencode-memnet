# opencode-memnet Codex Plugin

This package connects Codex CLI to an existing `opencode-memnet` server.

It does not create a new memory database. It gives Codex three ways to use the same
memory server that the OpenCode plugin already uses:

- an MCP server that exposes memory tools to Codex
- Codex lifecycle hooks that inject memory context and auto-capture session summaries
- a Codex skill that tells Codex when to call the memory tools

In plain English: the server stores the memories, and this plugin lets Codex read and
write those memories.

## Quick Start

1. Start the `opencode-memnet` server and confirm it is healthy:

   ```bash
   curl -fsS http://localhost:4747/api/health
   ```

2. Build the Codex plugin:

   ```bash
   cd /path/to/opencode-memnet
   bun install
   cd plugin-codex
   bun install
   bun run verify
   ```

3. Create the Codex plugin config file:

   ```bash
   mkdir -p ~/.codex
   $EDITOR ~/.codex/opencode-memnet.jsonc
   ```

   ```jsonc
   {
     "serverUrl": "http://localhost:4747",
     "apiKey": "paste-your-server-or-profile-api-key-here",
     "profileId": "default",
   }
   ```

4. Add the MCP server to `~/.codex/config.toml`:

   ```toml
   [mcp_servers.opencode-memnet]
   command = "/home/phrkr/.mcp-servers/opencode-memnet/plugin-codex/dist/mcp/server.js"
   startup_timeout_sec = 10
   tool_timeout_sec = 60
   enabled = true
   ```

5. Restart Codex, run `/mcp`, and confirm `opencode-memnet` is listed.

If a tool returns `Missing serverUrl`, Codex started the MCP server, but the plugin
could not find `~/.codex/opencode-memnet.jsonc` or the equivalent environment
variables.

## What Each Piece Does

| Piece                 | File or command                                            | What it does                                                                                 |
| --------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Memory server         | `opencode-memnet` server from the repo root                | Stores memories, profiles, repository identity, tags, prompts, and embeddings in PostgreSQL. |
| Codex MCP server      | `plugin-codex/dist/mcp/server.js`                          | Runs as a local stdio MCP process and exposes `memory_*` tools to Codex.                     |
| Codex hook runner     | `plugin-codex/dist/hooks/runner.js`                        | Runs during Codex lifecycle events to inject context and auto-capture summaries.             |
| Codex skill           | `plugin-codex/dist/skills/opencode-memnet-memory/SKILL.md` | Teaches Codex when to use memory tools and what not to store.                                |
| Codex plugin manifest | `plugin-codex/.codex-plugin/plugin.json`                   | Describes the plugin bundle: skills, MCP server, and hooks.                                  |
| Plugin config         | `~/.codex/opencode-memnet.jsonc`                           | Tells the plugin which server to use and which API key/profile to use.                       |
| Codex MCP config      | `~/.codex/config.toml`                                     | Tells Codex how to start the plugin MCP server process.                                      |

The two config files are different on purpose:

- `~/.codex/config.toml` is Codex configuration. It starts MCP servers and controls
  Codex behavior.
- `~/.codex/opencode-memnet.jsonc` is opencode-memnet plugin configuration.
  It contains the memory server URL, API key, profile, and memory options.

## Requirements

- Git
- Bun
- Codex CLI
- A running `opencode-memnet` server
- A server API key or profile-scoped API key
- Optional: a profile ID when you use the admin `SERVER_API_KEY`

The plugin uses the server API. It does not start Docker, PostgreSQL, pgvector, or
the WebUI for you.

## Start The Memory Server First

From the repository root:

```bash
cp .env.example .env
$EDITOR .env
docker compose up -d --build
curl -fsS http://localhost:4747/api/health
```

At minimum, the server needs its normal server-side settings, including:

- `SERVER_API_KEY`, or a generated server key
- `POSTGRES_PASSWORD`
- embedding settings such as `EMBEDDING_API_URL`, `EMBEDDING_MODEL`, and
  `EMBEDDING_API_KEY`

Use the WebUI at `http://localhost:4747` with the server API key if you want to
inspect memories and profiles directly.

## Build The Codex Plugin

From the repository root:

```bash
bun install
cd plugin-codex
bun install
bun run verify
```

`bun run verify` runs:

```bash
bun run typecheck
bun test
bun run build
```

After a successful build, these files should exist:

```text
plugin-codex/dist/mcp/server.js
plugin-codex/dist/hooks/runner.js
plugin-codex/dist/hooks/hooks.json
plugin-codex/dist/skills/opencode-memnet-memory/SKILL.md
plugin-codex/dist/.codex-plugin/plugin.json
```

The package also exposes these bin names when installed in a way that puts package
bins on `PATH`:

```text
opencode-memnet-codex-mcp
opencode-memnet-codex-hook
```

For local setup, the most explicit form is the absolute `dist/.../*.js` path.

## Configure The Plugin JSONC File

The plugin reads config from these places:

1. Project config: `.codex/opencode-memnet.jsonc`
2. User config: `~/.codex/opencode-memnet.jsonc`
3. Environment variables, only when a value is missing from the files

Project config overrides user config. Nested objects such as `memory`, `context`,
and `capture` merge recursively.

JSONC means JSON with comments and trailing commas. This is valid:

```jsonc
{
  // The base URL of your running opencode-memnet server.
  "serverUrl": "http://localhost:4747",

  // Use SERVER_API_KEY for admin access, or a profile key for one profile.
  "apiKey": "paste-your-key-here",

  // Use this with SERVER_API_KEY. You can omit it for a profile key.
  "profileId": "default",
}
```

### Minimal User Config

Use this when your server is running on your machine and you use the default profile:

```jsonc
{
  "serverUrl": "http://localhost:4747",
  "apiKey": "paste-your-server-or-profile-api-key-here",
  "profileId": "default",
}
```

### Full User Config

```jsonc
{
  "serverUrl": "http://localhost:4747",
  "apiKey": "paste-your-server-or-profile-api-key-here",
  "profileId": "default",
  "nickname": "Codex on workstation",
  "timeoutMs": 30000,
  "memory": {
    "defaultScope": "project",
  },
  "context": {
    "maxMemories": 5,
    "maxAgeDays": null,
    "excludeCurrentSession": true,
  },
  "capture": {
    "enabled": true,
    "includeRawHookPayload": false,
  },
}
```

### Config Fields

| Field                           | Required | Default   | Meaning                                                                                                                                  |
| ------------------------------- | -------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `serverUrl`                     | Yes      | empty     | Base URL of the running `opencode-memnet` server, for example `http://localhost:4747`.                                                   |
| `apiKey`                        | Yes      | empty     | Bearer token sent to the server. Use `SERVER_API_KEY` for admin access or a profile key for scoped access.                               |
| `profileId`                     | No       | unset     | Profile scope to use with the admin key. Profile keys are already tied to one profile, so this can usually be omitted with profile keys. |
| `nickname`                      | No       | unset     | Friendly name sent during `memory_connect`. The current strict server does not support later nickname update calls.                      |
| `timeoutMs`                     | No       | `30000`   | Timeout for most HTTP calls from the plugin to the memory server. `memory_capture` auto-capture uses a longer internal timeout.          |
| `memory.defaultScope`           | No       | `project` | Default search/list scope. Use `project` for the current repo or `all-projects` to search across accessible projects.                    |
| `context.maxMemories`           | No       | `5`       | Number of memories requested by `memory_get_context` unless the tool call supplies `maxMemories`.                                        |
| `context.maxAgeDays`            | No       | `null`    | Maximum age for context memories. Use `null` for no age limit.                                                                           |
| `context.excludeCurrentSession` | No       | `true`    | Avoid returning memories from the current session when context is requested.                                                             |
| `capture.enabled`               | No       | `true`    | Enables `memory_capture` and hook capture.                                                                                               |
| `capture.includeRawHookPayload` | No       | `false`   | Reserved for raw hook payload handling. Keep `false` unless you are deliberately debugging and know the payload is safe.                 |

### Environment Variable Fallback

If a field is missing from the JSONC files, the plugin can fill it from:

| Environment variable         | Fills config field |
| ---------------------------- | ------------------ |
| `OPENCODE_MEMNET_SERVER_URL` | `serverUrl`        |
| `OPENCODE_MEMNET_API_KEY`    | `apiKey`           |
| `OPENCODE_MEMNET_PROFILE_ID` | `profileId`        |
| `OPENCODE_MEMNET_NICKNAME`   | `nickname`         |

Example:

```bash
export OPENCODE_MEMNET_SERVER_URL="http://localhost:4747"
export OPENCODE_MEMNET_API_KEY="paste-your-key-here"
export OPENCODE_MEMNET_PROFILE_ID="default"
```

You can also forward these into the MCP server process from Codex config with
`env_vars`; see the MCP config section below.

## Configure The MCP Server

Codex needs an MCP server entry so it knows how to start the local memory tool
process.

Use global config for all projects:

```text
~/.codex/config.toml
```

Use project config for one trusted project:

```text
<project>/.codex/config.toml
```

Project `.codex/config.toml` only loads when Codex trusts the project.

### Recommended Direct MCP Config

This is the exact shape requested for this local install:

```toml
[mcp_servers.opencode-memnet]
command = "/home/phrkr/.mcp-servers/opencode-memnet/plugin-codex/dist/mcp/server.js"
startup_timeout_sec = 10
tool_timeout_sec = 60
enabled = true
```

Replace the path if your clone lives somewhere else:

```toml
[mcp_servers.opencode-memnet]
command = "/absolute/path/to/opencode-memnet/plugin-codex/dist/mcp/server.js"
startup_timeout_sec = 10
tool_timeout_sec = 60
enabled = true
```

Do not set `cwd` to the plugin directory for normal use. The MCP server uses its
current working directory to derive project tags and repository identity. If you force
`cwd` to the plugin folder, Codex may store memories under the plugin repository
instead of the project you are working on.

### MCP Config Options

| Option                        | Required              | Example                                                    | Meaning                                                                                                                                     |
| ----------------------------- | --------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `command`                     | Yes for stdio servers | `"/path/to/dist/mcp/server.js"`                            | The executable Codex starts. For this plugin, point it at the built MCP server or use `opencode-memnet-codex-mcp` if that bin is on `PATH`. |
| `args`                        | No                    | `["--flag"]`                                               | Extra arguments passed to `command`. This plugin does not need arguments in the normal direct setup.                                        |
| `env`                         | No                    | `{ OPENCODE_MEMNET_SERVER_URL = "http://localhost:4747" }` | Literal environment variables Codex passes to the MCP process. Useful for non-secret values or local-only config.                           |
| `env_vars`                    | No                    | `["OPENCODE_MEMNET_API_KEY"]`                              | Names of environment variables Codex should forward from its own environment into the MCP process. Prefer this for secrets.                 |
| `cwd`                         | No                    | `"/path/to/project"`                                       | Working directory for the MCP process. Only set this when you deliberately want a fixed project scope.                                      |
| `startup_timeout_sec`         | No                    | `10`                                                       | How long Codex waits for the MCP server to start. Default is 10 seconds.                                                                    |
| `tool_timeout_sec`            | No                    | `60`                                                       | How long Codex lets one MCP tool call run. Default is 60 seconds.                                                                           |
| `enabled`                     | No                    | `true`                                                     | Set `false` to keep the config but stop loading this MCP server.                                                                            |
| `required`                    | No                    | `false`                                                    | Set `true` if Codex should fail startup/resume when this MCP server cannot initialize.                                                      |
| `enabled_tools`               | No                    | `["memory_search"]`                                        | Allow only the listed tools from this MCP server.                                                                                           |
| `disabled_tools`              | No                    | `["memory_forget"]`                                        | Disable listed tools. This is applied after `enabled_tools`.                                                                                |
| `default_tools_approval_mode` | No                    | `"prompt"`                                                 | Default approval mode for this server's tools. Codex supports `auto`, `prompt`, and `approve`.                                              |
| `tools.<tool>.approval_mode`  | No                    | `"prompt"`                                                 | Per-tool approval override. Useful for destructive tools such as `memory_forget`.                                                           |
| `experimental_environment`    | No                    | `"remote"`                                                 | Experimental Codex option for running stdio servers through a remote executor when available. Not needed for normal local use.              |

### MCP Config With Environment Variables

This keeps the API key out of `~/.codex/opencode-memnet.jsonc` and asks
Codex to forward it from your shell environment:

```toml
[mcp_servers.opencode-memnet]
command = "/absolute/path/to/opencode-memnet/plugin-codex/dist/mcp/server.js"
startup_timeout_sec = 10
tool_timeout_sec = 60
enabled = true
env_vars = [
  "OPENCODE_MEMNET_SERVER_URL",
  "OPENCODE_MEMNET_API_KEY",
  "OPENCODE_MEMNET_PROFILE_ID",
  "OPENCODE_MEMNET_NICKNAME",
]
```

Then start Codex from a shell that has those variables:

```bash
export OPENCODE_MEMNET_SERVER_URL="http://localhost:4747"
export OPENCODE_MEMNET_API_KEY="paste-your-key-here"
export OPENCODE_MEMNET_PROFILE_ID="default"
codex
```

### MCP Config With Tool Restrictions

Use this if you want search and context tools available, but you do not want Codex
to delete memories:

```toml
[mcp_servers.opencode-memnet]
command = "/absolute/path/to/opencode-memnet/plugin-codex/dist/mcp/server.js"
startup_timeout_sec = 10
tool_timeout_sec = 60
enabled = true
disabled_tools = ["memory_forget"]
```

Use this if you want Codex to ask before deletion:

```toml
[mcp_servers.opencode-memnet]
command = "/absolute/path/to/opencode-memnet/plugin-codex/dist/mcp/server.js"
startup_timeout_sec = 10
tool_timeout_sec = 60
enabled = true

[mcp_servers.opencode-memnet.tools.memory_forget]
approval_mode = "prompt"
```

## Install The Hooks

Hooks let Codex run the hook runner at useful moments:

- `SessionStart`: connect the Codex client and inject project memory context when available
- `UserPromptSubmit`: inject project memory context before the prompt is sent
- `Stop`: use `transcript_path` to auto-capture useful conversation summaries after a turn
- `PreCompact`: auto-capture useful conversation summaries before compaction
- `PostCompact`: connect after compaction without emitting fake restoration context

The package includes default hook config at:

```text
plugin-codex/hooks/hooks.json
plugin-codex/dist/hooks/hooks.json
```

The bundled file uses the command name `opencode-memnet-codex-hook`. That works
when the package bin is on `PATH`. For a direct local install, use an absolute path
to `dist/hooks/runner.js`.

### User-Level Hook Install

Create or edit:

```text
~/.codex/hooks.json
```

Example:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "/home/phrkr/.mcp-servers/opencode-memnet/plugin-codex/dist/hooks/runner.js",
            "timeout": 30,
            "statusMessage": "Connecting opencode-memnet"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/home/phrkr/.mcp-servers/opencode-memnet/plugin-codex/dist/hooks/runner.js",
            "timeout": 30,
            "statusMessage": "Checking opencode-memnet memory"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/home/phrkr/.mcp-servers/opencode-memnet/plugin-codex/dist/hooks/runner.js",
            "timeout": 180,
            "statusMessage": "Saving opencode-memnet memory"
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "matcher": "manual|auto",
        "hooks": [
          {
            "type": "command",
            "command": "/home/phrkr/.mcp-servers/opencode-memnet/plugin-codex/dist/hooks/runner.js",
            "timeout": 180,
            "statusMessage": "Saving opencode-memnet memory"
          }
        ]
      }
    ],
    "PostCompact": [
      {
        "matcher": "manual|auto",
        "hooks": [
          {
            "type": "command",
            "command": "/home/phrkr/.mcp-servers/opencode-memnet/plugin-codex/dist/hooks/runner.js",
            "timeout": 30,
            "statusMessage": "Restoring opencode-memnet context"
          }
        ]
      }
    ]
  }
}
```

Restart Codex. Run `/hooks` and trust the new hook definitions if Codex asks you
to review them.

### Project-Level Hook Install

For one project, use:

```text
<project>/.codex/hooks.json
```

Project hooks load only when Codex trusts the project. Use absolute hook command
paths so the hook still works when Codex starts from a subdirectory.

### Hook Behavior

The hook runner:

- reads JSON from stdin
- tolerates missing or unknown hook fields
- loads the same `opencode-memnet.jsonc` config as the MCP server
- connects the Codex client with `/api/client/connect`
- calls `/api/context/inject` from `SessionStart` and `UserPromptSubmit`, then returns
  `hookSpecificOutput.additionalContext` only when Codex can use it
- does not store raw `UserPromptSubmit` prompts as memories
- strips `<private>...</private>` blocks while parsing transcripts
- calls `/api/auto-capture` from `Stop` and `PreCompact` when `transcript_path`
  contains a latest user prompt plus assistant text or tool activity
- skips capture when config is missing, capture is disabled, `transcript_path` is
  unavailable, `stop_hook_active` is true, or the transcript does not contain enough
  useful conversation data
- exits successfully for non-fatal failures so memory context and capture do not block Codex work

`transcript_path` parsing is best effort because Codex documents transcripts as a
convenience format rather than a stable hook interface. `PostCompact` cannot inject
new model-visible context after compaction; continuity comes from the next supported
context hook, usually `SessionStart` with `source: "compact"` or the next
`UserPromptSubmit`.

## Install The Skill

The skill tells Codex how to use the memory tools safely. It is instruction only;
it does not contain secrets.

Built skill path:

```text
plugin-codex/dist/skills/opencode-memnet-memory/SKILL.md
```

Source skill path:

```text
plugin-codex/skills/opencode-memnet-memory/SKILL.md
```

### User-Level Skill Install

Codex reads user skills from:

```text
~/.agents/skills
```

Install with a symlink:

```bash
mkdir -p ~/.agents/skills
ln -sfn /home/phrkr/.mcp-servers/opencode-memnet/plugin-codex/dist/skills/opencode-memnet-memory \
  ~/.agents/skills/opencode-memnet-memory
```

Restart Codex. Then use `/skills` or mention the skill explicitly:

```text
$opencode-memnet-memory
```

### Project-Level Skill Install

For one project:

```bash
mkdir -p .agents/skills
ln -sfn /absolute/path/to/opencode-memnet/plugin-codex/dist/skills/opencode-memnet-memory \
  .agents/skills/opencode-memnet-memory
```

Project skills are useful when the team wants everyone working in that repository
to get the same memory guidance.

### What The Skill Says

The bundled skill tells Codex to:

- call `memory_get_context` before substantial work when prior decisions may matter
- call `memory_search` for targeted recall
- call `memory_add` only for durable facts, conventions, decisions, and repeatable workflows
- call `memory_capture` near the end of substantial work
- never store secrets, credentials, private keys, tokens, passwords, API keys, or raw private content

## Install As A Codex Plugin Bundle

The package includes a Codex plugin manifest:

```text
plugin-codex/.codex-plugin/plugin.json
plugin-codex/dist/.codex-plugin/plugin.json
```

The manifest declares:

```json
{
  "name": "opencode-memnet-codex",
  "version": "0.1.0",
  "description": "Codex CLI integration for opencode-memnet persistent memory",
  "skills": "./skills/",
  "mcp_servers": {
    "opencode-memnet": {
      "command": "opencode-memnet-codex-mcp"
    }
  },
  "hooks": "./hooks/hooks.json"
}
```

This is the packaged form of the same three pieces:

- `skills` points at the bundled skill directory
- `mcp_servers.opencode-memnet.command` points at the MCP bin name
- `hooks` points at the bundled hook config

For local development, direct MCP/hook/skill setup with absolute paths is easier to
inspect and debug. For distribution, expose this plugin folder through a Codex
plugin marketplace and install it from Codex. After installing a marketplace plugin,
restart Codex and check `/mcp`, `/hooks`, and `/skills`.

## Available MCP Tools

| Tool                  | Main arguments                                                                       | What it does                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memory_connect`      | `nickname?`                                                                          | Registers this Codex client with the server and returns server/client stats.                                                                               |
| `memory_get_context`  | `sessionID?`, `maxMemories?`                                                         | Fetches formatted memory context for the current project.                                                                                                  |
| `memory_add`          | `content`, `type?`, `tags?`                                                          | Stores a manual memory. Private blocks are stripped; fully private content is blocked.                                                                     |
| `memory_search`       | `query`, `limit?`                                                                    | Searches memories in the configured scope.                                                                                                                 |
| `memory_list`         | `limit?`                                                                             | Lists recent memories in the configured scope.                                                                                                             |
| `memory_forget`       | `memoryId`                                                                           | Deletes one memory by ID.                                                                                                                                  |
| `memory_profile`      | none                                                                                 | Reads the active user profile from the server.                                                                                                             |
| `memory_stats`        | none                                                                                 | Reads client stats from the server.                                                                                                                        |
| `memory_capture`      | `summary?`, `sessionID?`, `conversationMessages?`, `userPrompt?`, `promptMessageId?` | Captures durable session information. Uses auto-capture when enough conversation data is present; otherwise stores a manual session memory from `summary`. |
| `memory_set_nickname` | `nickname`                                                                           | Returns an unsupported response. The current server does not expose nickname updates.                                                                      |

## How Codex, OpenCode, And The Server Relate

`opencode-memnet` is the memory system. The server is the shared source of truth.

The OpenCode plugin and the Codex plugin are two different clients for that same
server:

| Capability                                          | OpenCode plugin                       | Codex plugin                                                      |
| --------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------- |
| Talks to the same server                            | Yes                                   | Yes                                                               |
| Uses the same memory database                       | Yes                                   | Yes                                                               |
| Uses `profileId` and repository identity            | Yes                                   | Yes                                                               |
| Uses compatible project tags                        | Yes                                   | Yes, keeps the `opencode_project_...` tag shape for compatibility |
| Can inject context automatically into model context | Yes, through OpenCode `chat.message`  | Yes, as Codex developer context from supported command hooks      |
| Provides interactive memory tools                   | One OpenCode `memory` tool with modes | MCP tools named `memory_*`                                        |
| Provides lifecycle capture                          | OpenCode session hooks                | Codex command hooks                                               |
| Provides reusable agent instructions                | OpenCode plugin behavior              | Bundled Codex skill                                               |

### Can OpenCode And Codex Use The Same JSON Config?

They can use the same values, but they do not read the same path by default.

OpenCode reads:

```text
~/.config/opencode/opencode-memnet.jsonc
<project>/.opencode/opencode-memnet.jsonc
```

Codex reads:

```text
~/.codex/opencode-memnet.jsonc
<project>/.codex/opencode-memnet.jsonc
```

The shared fields are:

```jsonc
{
  "serverUrl": "http://localhost:4747",
  "apiKey": "paste-your-key-here",
  "profileId": "default",
  "memory": {
    "defaultScope": "project",
  },
}
```

You have three practical options:

1. Keep separate files with the same shared values. This is the clearest setup.
2. Copy the same JSONC content into both paths.
3. Symlink both expected paths to one shared file if you are comfortable with one
   client changing the file affecting the other client.

Use separate files if you use OpenCode-only settings such as `chatMessage`,
`customMessage`, `autoCaptureEnabled`, or toast settings. Use separate files if you
use Codex-only settings such as `context`, `capture`, `timeoutMs`, or `nickname`.

Unknown extra fields are not part of the active behavior for the other client.
For example, Codex does not use OpenCode's `chatMessage` config, and OpenCode does
not use Codex's `context` config.

## Identity And Project Scope

The Codex plugin persists its client ID here:

```text
~/.codex/opencode-memnet-client-id
```

It sends this ID as `X-Client-ID` on server requests.

For project scope, the plugin reads git metadata from the current working directory:

- project display name
- sanitized git remote URL when available
- stable project tag in the `opencode_project_<hash>` format
- stable `repo_<hash>` repository ID

This keeps Codex memories compatible with the existing server model and avoids using
local filesystem paths as the identity source.

## Privacy Rules

The plugin treats `<private>...</private>` as private content.

When content contains visible text and a private block, the plugin strips the private
block before sending content to the server:

```text
Remember this public fact. <private>do not store this</private>
```

Only this reaches the server:

```text
Remember this public fact.
```

When the entire content is private, the plugin blocks the write.

Do not store API keys, bearer tokens, passwords, private keys, database URLs, `.env`
contents, or raw private prompts in memory.

## Verify The Setup

After you configure the JSONC file, MCP server, hooks, and skill:

1. Restart Codex.
2. Run `/mcp` and confirm `opencode-memnet` is enabled.
3. Run `/hooks` and trust the hook definitions if needed.
4. Run `/skills` and confirm `opencode-memnet-memory` is visible.
5. Ask Codex to call `memory_connect`.
6. Ask Codex to call `memory_get_context`.

Expected successful MCP tool responses are JSON text with:

```json
{
  "success": true
}
```

The response may also include `data`, stats, memories, or profile information.

## Troubleshooting

### `Missing serverUrl`

Codex started the MCP server, but the plugin config is missing.

Fix one of these:

- Create `~/.codex/opencode-memnet.jsonc`.
- Create `<project>/.codex/opencode-memnet.jsonc`.
- Set and forward `OPENCODE_MEMNET_SERVER_URL` with `env_vars`.

The MCP TOML starts the process. It does not replace the JSONC server config unless
you pass equivalent environment variables.

### `Missing apiKey`

The plugin found `serverUrl` but not `apiKey`.

Add `apiKey` to the JSONC config or forward `OPENCODE_MEMNET_API_KEY` with
`env_vars`.

### Server Is Unavailable

Check the server health endpoint:

```bash
curl -fsS http://localhost:4747/api/health
```

If this fails, start the server before debugging the Codex plugin.

### Authentication Fails

Use one of these keys:

- `SERVER_API_KEY` for admin/all-profile access
- a profile-scoped key from `PROFILE_KEYS_FILE` for one profile

Do not use the database password, embedding provider key, or OpenAI key as the plugin
`apiKey`.

### Hooks Do Not Run

Run `/hooks` in Codex.

Check:

- the hook file is in `~/.codex/hooks.json` or trusted `<project>/.codex/hooks.json`
- the command path points at `plugin-codex/dist/hooks/runner.js`
- the hook definitions have been reviewed and trusted
- hooks are not disabled with `[features] hooks = false`

### Skill Does Not Appear

Run `/skills` or restart Codex.

Check:

- the symlink points at a directory, not directly at `SKILL.md`
- the directory contains `SKILL.md`
- the skill is under `~/.agents/skills` or `<project>/.agents/skills`

### Memories Are Stored Under The Wrong Project

Check whether you set `cwd` in the MCP config or used a hook command that runs from
the wrong directory. The plugin derives repository identity from the process working
directory.

For normal use, do not set MCP `cwd`. Let Codex launch the MCP server in the active
project context.

## Development Commands

From the repository root:

```bash
bun run typecheck:codex-plugin
bun run test:codex-plugin
bun run build:codex-plugin
bun run verify:codex-plugin
```

From `plugin-codex/`:

```bash
bun run typecheck
bun test
bun run build
bun run verify
```

## Source Map

| File                                     | Purpose                                                                                            |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/config.ts`                          | Loads `.codex/opencode-memnet.jsonc`, `~/.codex/opencode-memnet.jsonc`, and environment fallbacks. |
| `src/jsonc.ts`                           | Parses JSONC comments and trailing commas.                                                         |
| `src/identity.ts`                        | Creates and persists the Codex client ID.                                                          |
| `src/tags.ts`                            | Derives project tags, repository IDs, and git metadata.                                            |
| `src/http-client.ts`                     | Calls the existing `opencode-memnet` server API.                                                   |
| `src/mcp/server.ts`                      | Starts the stdio MCP server and registers tools.                                                   |
| `src/mcp/tools.ts`                       | Implements `memory_*` tools.                                                                       |
| `src/hooks/payload.ts`                   | Reads defensive hook payload fields.                                                               |
| `src/hooks/transcript.ts`                | Parses Codex JSONL transcripts for best-effort auto-capture input.                                 |
| `src/hooks/logger.ts`                    | Writes sanitized hook diagnostics outside stdout.                                                  |
| `src/hooks/runner.ts`                    | Runs Codex command hooks.                                                                          |
| `hooks/hooks.json`                       | Default packaged hook configuration.                                                               |
| `skills/opencode-memnet-memory/SKILL.md` | Bundled Codex memory skill.                                                                        |
| `.codex-plugin/plugin.json`              | Codex plugin manifest.                                                                             |
