# opencode-memnet

Persistent memory for OpenCode and Codex coding agents.

## v2 Clean Start

Before starting v2 against an existing opencode-memnet database, run the explicit clean-start command. It creates a verified backup file at `backups/opencode-memnet-v1-<timestamp>.dump`. For bundled Compose, the command uses `docker compose exec -T db pg_dump ... --format=custom --file=-`, then verifies the dump with `pg_restore --list`. For external Postgres, it uses `pg_dump --format=custom --file backups/opencode-memnet-v1-<timestamp>.dump "$POSTGRES_URL"` and verifies with `pg_restore --list`.

v2 is a clean start. After the backup is verified, `scripts/v2-clean-start.ts` removes old opencode-memnet runtime/auth/memory data. Normal server startup does not perform destructive reset. Migration 15 refuses to run while v1 rows remain and creates the new v2 structure only after the explicit clean-start reset has already emptied v1 data tables. There is no v1-to-v2 upgrade, import, or backfill path.

## Authentication

SERVER_API_KEY is required. The server never generates it. If it is missing or empty, startup fails before the HTTP server starts.

The WebUI is administered with `SERVER_API_KEY`. From the WebUI, create user API keys with a required name and description. The generated user API key value is shown once at creation time and stored server-side only as a hash.

Each user API key starts with no Memory Banks. Create a Memory Bank before using OpenCode or Codex memory operations. The user-facing bank shortcut is `<api-key-name>><memory-bank-name>`, for example `opencode>vllm-setup`.

## Quickstart

```bash
git clone https://git.phrk.org/pub/opencode-memnet.git
cd opencode-memnet
cp .env.example .env
```

Set at least:

```env
SERVER_API_KEY=replace-with-a-long-random-admin-key
POSTGRES_URL=postgresql://opencode_memnet:opencode_memnet@localhost:5432/opencode_memnet
EMBEDDING_API_URL=https://api.openai.com/v1
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_API_KEY=sk-...
```

Start the bundled Compose stack:

```bash
docker compose up -d --build
```

Open the WebUI at:

```text
http://localhost:4747
```

Use `SERVER_API_KEY` to sign in, then create a user API key and at least one Memory Bank.

## OpenCode Plugin

Build the OpenCode plugin:

```bash
bun install
cd plugin && bun install && cd ..
bun run build:plugin
```

Configure the plugin with a user API key created in the WebUI:

```jsonc
{
  "serverUrl": "http://localhost:4747",
  "apiKey": "omnu_user_key_value",
  "autoCaptureEnabled": true,
  "memory": {
    "defaultScope": "project",
  },
}
```

On startup the plugin connects, receives the API key identity and available Memory Banks, and routes memory operations through the active bank using `X-Memory-Bank-ID`.

## Codex Plugin

Build and verify the Codex plugin:

```bash
cd plugin-codex && bun install && cd ..
bun run verify:codex-plugin
```

Configure Codex with the same user API key model. Memory operations require an active Memory Bank. If no bank exists for the API key, the Codex tools and hooks report that a Memory Bank must be created first.

## Magic Memory Bank Prompt

Clients recognize this prompt form:

```text
!opencode-memnet!New memory bank called 'new-project', create it, and activate it!
```

When present, the client creates and activates the Memory Bank without confirmation and uses description `work relating to new-project`.

## Environment

Secret values for `POSTGRES_URL`, `EMBEDDING_API_KEY`, and `MEMORY_API_KEY` support plain values, `env://OTHER_ENV_VAR`, and `file:///absolute/path/to/secret`.

| Variable                    | Required | Description                                                   |
| --------------------------- | -------- | ------------------------------------------------------------- |
| `SERVER_API_KEY`            | yes      | Admin bearer token for WebUI and admin API operations.        |
| `POSTGRES_URL`              | yes      | PostgreSQL connection string.                                 |
| `EMBEDDING_API_URL`         | yes      | OpenAI-compatible embeddings API base URL.                    |
| `EMBEDDING_MODEL`           | yes      | Embedding model name.                                         |
| `EMBEDDING_API_KEY`         | yes      | Embedding API key.                                            |
| `SERVER_HOST`               | no       | Server bind host.                                             |
| `SERVER_PORT`               | no       | Server listen port.                                           |
| `WEB_SERVER_ALLOWED_ORIGIN` | no       | CORS `Access-Control-Allow-Origin` value.                     |
| `LOG_LEVEL`                 | no       | `debug`, `info`, `warn`, or `error`.                          |
| `MEMORY_MODEL`              | no       | Chat completions model for auto-capture and profile learning. |
| `MEMORY_API_URL`            | no       | OpenAI-compatible chat completions API base URL.              |
| `MEMORY_API_KEY`            | no       | Chat completions API key.                                     |

Do not run `docker compose down -v` unless you want to delete the database volume and all stored memories.
