# opencode-memnet

Persistent memory server and OpenCode plugin for coding agents.

The server stores memories, prompts, profile data, and vector embeddings in
Postgres with pgvector. The plugin is a thin HTTP client that sends project
context, searches memory, injects relevant context into chat messages, and
captures new memory from sessions.

This README documents the supported local install path:

- Server: `docker-compose.yml`
- Plugin: clone this repo, run `bun run build:plugin`, load the built local plugin
- No npm publishing workflow
- No external database container instructions outside this repository's Compose file

## Quickstart

### Requirements

- Git
- Docker with Docker Compose
- Bun
- An OpenAI-compatible embedding API
- Optional: an OpenAI-compatible chat completions API for auto-capture/profile learning

### 1. Clone

```bash
git clone https://git.phrk.org/pub/opencode-memnet.git
cd opencode-memnet
```

### 2. Create `.env`

```bash
cp .env.example .env
```

Set the required values:

```env
SERVER_API_KEY=change-me-admin-key
POSTGRES_PASSWORD=change-me-db-password

EMBEDDING_API_URL=https://api.openai.com/v1
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_API_KEY=sk-...

# Optional, required only for auto-capture/profile learning.
MEMORY_MODEL=gpt-4o-mini
MEMORY_API_URL=https://api.openai.com/v1
MEMORY_API_KEY=sk-...
```

### 3. Start the server

```bash
docker compose up -d --build
```

The Compose file starts:

- `db`: Postgres 16 with pgvector
- `server`: opencode-memnet API and WebUI

Verify:

```bash
curl -fsS http://localhost:4747/api/health
```

Open the WebUI:

```text
http://localhost:4747
```

Useful server commands:

```bash
docker compose ps
docker compose logs -f server
docker compose restart server
docker compose down
```

Do not use `docker compose down -v` unless you intend to delete the database
volume and all stored memories.

### 4. Build and install the local plugin

From the repo root:

```bash
bun install
cd plugin && bun install && cd ..
bun run build:plugin
```

Install the built plugin into OpenCode's local plugin directory:

```bash
mkdir -p ~/.config/opencode/plugins
ln -sfn "$PWD/plugin/dist/opencode-memnet.js" ~/.config/opencode/plugins/opencode-memnet.js
```

OpenCode loads local plugins from `~/.config/opencode/plugins/` and project
`.opencode/plugins/` directories.

### 5. Configure the plugin

Global config:

```bash
mkdir -p ~/.config/opencode
cat > ~/.config/opencode/opencode-memnet.jsonc <<'JSON'
{
  "serverUrl": "http://localhost:4747",
  "apiKey": "change-me-admin-key",
  "profileId": "default",
  "autoCaptureEnabled": true,
  "memory": {
    "defaultScope": "project"
  }
}
JSON
```

One-liner equivalent:

```bash
mkdir -p ~/.config/opencode && printf '%s\n' '{' '  "serverUrl": "http://localhost:4747",' '  "apiKey": "change-me-admin-key",' '  "profileId": "default",' '  "autoCaptureEnabled": true,' '  "memory": { "defaultScope": "project" }' '}' > ~/.config/opencode/opencode-memnet.jsonc
```

Project-local config override:

```bash
mkdir -p .opencode
cat > .opencode/opencode-memnet.jsonc <<'JSON'
{
  "serverUrl": "http://localhost:4747",
  "apiKey": "change-me-admin-key",
  "profileId": "work",
  "memory": {
    "defaultScope": "project"
  }
}
JSON
```

Restart OpenCode after building or changing plugin config.

## How It Works

### Components

| Component          | Path              | Responsibility                                                       |
| ------------------ | ----------------- | -------------------------------------------------------------------- |
| Server             | `src/`            | REST API, WebUI, migrations, storage initialization, background jobs |
| WebUI              | `src/web/`        | Browser UI for memories, tags, stats, profiles, and jobs             |
| Plugin             | `plugin/`         | OpenCode hooks/tools, remote API client, auto-capture client         |
| Shared client code | `shared/`         | Plugin-safe config, tags, privacy, logging helpers                   |
| Storage            | Postgres/pgvector | Memories, prompts, client records, profiles, vectors                 |

### Request Flow

1. OpenCode loads `~/.config/opencode/plugins/opencode-memnet.js`.
2. The plugin reads config from:
   - `~/.config/opencode/opencode-memnet.jsonc`
   - `~/.config/opencode/opencode-memnet.json`
   - `.opencode/opencode-memnet.jsonc`
   - `.opencode/opencode-memnet.json`
3. Project config overrides global config.
4. The plugin checks git repository identity:
   - repository root
   - `remote.origin.url`
   - `git user.name`
   - `git user.email`
5. The plugin connects to `POST /api/client/connect`.
6. The server authenticates the request and returns a principal:
   - admin key: all profiles
   - profile key: one profile only
7. The plugin sends memory, prompt, profile, and repo metadata to the server.
8. The server writes and searches profile/repo-scoped records in Postgres.

### Identity Model

Runtime identity is a clean-start model. Use a clean database for this identity
model.

- `SERVER_API_KEY` remains the admin/all-profiles key.
- `PROFILE_KEYS_FILE` can declare profile-scoped API keys.
- Profile keys are restricted to their configured profileId.
- Project memory is scoped by `profileId` plus `repoId`.
- `repoId` is derived from normalized git repository identity.
- The database stores these scopes in `profile_id` and `repo_id`.
- Local paths are metadata only. They are not identity.

SERVER_API_KEY remains the admin/all-profiles key. Profile keys are restricted
to their configured profileId.

Old user-email, nickname, and path-keyed identity models are not migration
targets.

### Chat Context Workflow

The plugin handles OpenCode `chat.message` events:

1. User sends a message.
2. Plugin embeds/searches related memory through `POST /api/context/inject`.
3. Server searches profile/repo-scoped memories.
4. Server returns a context block.
5. Plugin prepends that context to the chat message.

Controls:

```jsonc
{
  "chatMessage": {
    "enabled": true,
    "maxMemories": 3,
    "excludeCurrentSession": true,
    "maxAgeDays": null,
    "injectOn": "first",
  },
}
```

### Auto-Capture Workflow

The plugin handles OpenCode session events:

1. Session becomes idle.
2. Plugin sends conversation data to `POST /api/auto-capture`.
3. Server asks the configured chat model to extract durable memories.
4. Server stores accepted memories with embeddings.
5. Profile learning can update preferences, patterns, and workflows.

Auto-capture requires:

```env
MEMORY_MODEL=...
MEMORY_API_URL=...
MEMORY_API_KEY=...
```

Disable auto-capture client-side:

```jsonc
{
  "autoCaptureEnabled": false,
}
```

### Memory Tool Workflow

The plugin exposes a `memory` tool to OpenCode.

Supported modes:

- `help`: show tool usage
- `add`: store a memory manually
- `search`: search memories
- `profile`: show learned profile
- `list`: list recent memories
- `forget`: delete a memory by ID

Example tool arguments:

```json
{
  "mode": "search",
  "query": "database migration",
  "scope": "project",
  "limit": 5
}
```

Scopes:

- `project`: current repository only
- `all-projects`: current profile across repositories

### WebUI Workflow

The WebUI is served by the server at `/`.

Use it to:

- list/search memories
- add/edit/delete memories
- pin/unpin memories
- inspect learned profiles
- inspect profile changelog snapshots
- view tags and stats
- run maintenance jobs

Authentication behavior:

- Admin key: can list and switch profiles.
- Profile key: profile selector is locked to the key's profile.
- `DISABLE_WEBUI_AUTH=true`: browser routes act as admin/all-profiles.

## Server Configuration

### Required `.env` Values

| Variable            | Required                                 | Description                               |
| ------------------- | ---------------------------------------- | ----------------------------------------- |
| `SERVER_API_KEY`    | yes, unless both auth modes are disabled | Admin/all-profiles bearer token           |
| `POSTGRES_PASSWORD` | yes for `docker-compose.yml`             | Password for the bundled Compose database |
| `EMBEDDING_API_URL` | yes                                      | OpenAI-compatible embedding API base URL  |
| `EMBEDDING_MODEL`   | yes                                      | Embedding model name                      |
| `EMBEDDING_API_KEY` | yes                                      | Embedding API key                         |

### Common `.env` Values

| Variable                    | Default            | Description                           |
| --------------------------- | ------------------ | ------------------------------------- |
| `HOST_PORT`                 | `4747`             | Host port for the server              |
| `EXTERNAL_HOST`             | `localhost`        | Host bind address                     |
| `SERVER_PORT`               | `4747`             | Port inside the server container      |
| `SERVER_HOST`               | `0.0.0.0`          | Bind address inside the container     |
| `POSTGRES_USER`             | `opencode`         | Bundled database user                 |
| `POSTGRES_DB`               | `opencode_mem`     | Bundled database name                 |
| `POSTGRES_SSL`              | `false` in Compose | SSL mode for database connection      |
| `DISABLE_WEBUI_AUTH`        | `false`            | Disable auth for browser/WebUI routes |
| `DISABLE_CLIENT_AUTH`       | `false`            | Disable auth for plugin/client routes |
| `WEB_SERVER_ALLOWED_ORIGIN` | `*`                | CORS `Access-Control-Allow-Origin`    |
| `LOG_LEVEL`                 | `info`             | `debug`, `info`, `warn`, or `error`   |

### Profile Keys

`PROFILE_KEYS_FILE` points to a JSONC file with profile-scoped API keys.

Example:

```jsonc
{
  "profiles": [
    {
      "profileId": "phrkr",
      "displayName": "Phrkr",
      "apiKey": "env://OPENCODE_MEMNET_PROFILE_KEY_PHRKR",
    },
  ],
}
```

Rules:

- `profiles` must be an array.
- `profileId` is required and unique.
- `apiKey` is required and unique after secret resolution.
- `displayName` is optional.
- Supported key indirection:
  - plain value
  - `env://NAME`
  - `file:///absolute/path`
- Profile API keys must not equal `SERVER_API_KEY`.
- Profile keys cannot read or write other profiles.

Example `.env`:

```env
PROFILE_KEYS_FILE=/run/secrets/opencode-memnet-profile-keys.jsonc
OPENCODE_MEMNET_PROFILE_KEY_PHRKR=profile-secret
```

Plugin config with a profile key can omit `profileId`:

```jsonc
{
  "serverUrl": "http://localhost:4747",
  "apiKey": "profile-secret",
}
```

The server returns the authenticated profile principal during client connect, and
the plugin uses that profile as the effective profile.

## Plugin Configuration

Config files are JSONC or JSON.

Lookup order:

1. Global `~/.config/opencode/opencode-memnet.jsonc`
2. Global `~/.config/opencode/opencode-memnet.json`
3. Project `.opencode/opencode-memnet.jsonc`
4. Project `.opencode/opencode-memnet.json`

Project config overrides global config.

Full example:

```jsonc
{
  "serverUrl": "http://localhost:4747",
  "apiKey": "change-me-admin-key",
  "profileId": "default",
  "autoCaptureEnabled": true,
  "showAutoCaptureToasts": true,
  "showErrorToasts": true,
  "chatMessage": {
    "enabled": true,
    "maxMemories": 3,
    "excludeCurrentSession": true,
    "maxAgeDays": null,
    "injectOn": "first",
  },
  "customMessage": {
    "enabled": false,
    "frequency": "first",
    "text": "",
  },
  "memory": {
    "defaultScope": "project",
  },
  "logLevel": "info",
}
```

Fields:

| Field                               | Description                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| `serverUrl`                         | Server URL. Required.                                                                  |
| `apiKey`                            | Server API key or profile key. Required unless client auth is disabled.                |
| `profileId`                         | Admin-key profile ID. Optional for profile keys. Defaults to `default` for admin keys. |
| `autoCaptureEnabled`                | Enable idle-session auto-capture.                                                      |
| `showAutoCaptureToasts`             | Show auto-capture status toasts.                                                       |
| `showErrorToasts`                   | Show plugin error toasts.                                                              |
| `chatMessage.enabled`               | Enable memory context injection.                                                       |
| `chatMessage.maxMemories`           | Max memories in injected context.                                                      |
| `chatMessage.excludeCurrentSession` | Exclude current session from context search.                                           |
| `chatMessage.maxAgeDays`            | Optional age limit for context memories.                                               |
| `chatMessage.injectOn`              | `first` or `always`.                                                                   |
| `customMessage.enabled`             | Inject configured custom text into chat messages.                                      |
| `customMessage.frequency`           | `first` or `always`.                                                                   |
| `customMessage.text`                | Custom text to inject.                                                                 |
| `memory.defaultScope`               | `project` or `all-projects`.                                                           |
| `logLevel`                          | `debug`, `info`, `warn`, or `error`.                                                   |

## Operations

### Start

```bash
docker compose up -d --build
```

### Stop

```bash
docker compose down
```

### Logs

```bash
docker compose logs -f server
docker compose logs -f db
```

### Health

```bash
curl -fsS http://localhost:4747/api/health
```

### Backup

```bash
docker compose exec db pg_dump -U "${POSTGRES_USER:-opencode}" "${POSTGRES_DB:-opencode_mem}" > opencode-memnet.sql
```

### Restore

Stop the server first, then restore into the running `db` service:

```bash
docker compose stop server
cat opencode-memnet.sql | docker compose exec -T db psql -U "${POSTGRES_USER:-opencode}" "${POSTGRES_DB:-opencode_mem}"
docker compose start server
```

### Upgrade

```bash
git pull --ff-only
bun install
cd plugin && bun install && cd ..
bun run build:plugin
docker compose up -d --build
```

Restart OpenCode after rebuilding the plugin.

## API Summary

All API routes except public health routes require authentication unless disabled
by `DISABLE_WEBUI_AUTH` or `DISABLE_CLIENT_AUTH`.

Header:

```http
Authorization: Bearer <SERVER_API_KEY_OR_PROFILE_KEY>
```

Common routes:

| Method   | Path                          | Description                    |
| -------- | ----------------------------- | ------------------------------ |
| `GET`    | `/api/health`                 | Public health check            |
| `GET`    | `/api/health/details`         | Detailed health                |
| `GET`    | `/api/tags`                   | Project tags                   |
| `GET`    | `/api/stats`                  | Memory stats                   |
| `GET`    | `/api/memories`               | List memories                  |
| `POST`   | `/api/memories`               | Add memory                     |
| `PUT`    | `/api/memories/:id`           | Update memory                  |
| `DELETE` | `/api/memories/:id`           | Delete memory                  |
| `POST`   | `/api/memories/bulk-delete`   | Bulk delete                    |
| `GET`    | `/api/search`                 | Search memories/prompts        |
| `POST`   | `/api/context/inject`         | Build chat context             |
| `POST`   | `/api/auto-capture`           | Capture memory from a session  |
| `GET`    | `/api/user-profile`           | Read profile                   |
| `GET`    | `/api/user-profiles`          | List visible profiles          |
| `POST`   | `/api/user-profile/learn`     | Trigger profile learning       |
| `POST`   | `/api/user-profile/refresh`   | Refresh profile                |
| `GET`    | `/api/user-profile/changelog` | Profile changelog              |
| `GET`    | `/api/user-profile/snapshot`  | Profile snapshot               |
| `POST`   | `/api/client/connect`         | Register/connect plugin client |
| `GET`    | `/api/client/stats`           | Plugin client stats            |

Profile-key requests are scoped server-side. A profile key may omit `profileId`;
the server injects the authenticated profile. A profile key that supplies another
`profileId` receives `403`.

## Development

### Install Dependencies

```bash
bun install
cd plugin && bun install && cd ..
```

### Build

```bash
bun run build
bun run build:plugin
bun run build:all
```

### Typecheck

```bash
bun run typecheck
bun run typecheck:plugin
bun run typecheck:all
```

### Test

```bash
bun test
bun run test
bun test tests/profile-auth.test.ts
```

### Format

```bash
bun run format
bun run format:check
```

## Project Layout

```text
.
├── docker-compose.yml
├── Dockerfile
├── src/
│   ├── server.ts
│   ├── server-config.ts
│   ├── services/
│   └── web/
├── plugin/
│   ├── build.ts
│   ├── src/
│   └── dist/
├── shared/
├── tests/
└── scripts/
```

## Troubleshooting

### Server does not start

Check required environment variables:

```bash
docker compose config
docker compose logs server
```

Most startup failures are missing:

- `POSTGRES_PASSWORD`
- `SERVER_API_KEY`
- `EMBEDDING_API_URL`
- `EMBEDDING_MODEL`
- `EMBEDDING_API_KEY`

### Health check fails

```bash
docker compose ps
docker compose logs db
docker compose logs server
```

Confirm the port:

```bash
docker compose port server 4747
```

### Plugin does not load

Check the local plugin file:

```bash
ls -l ~/.config/opencode/plugins/opencode-memnet.js
```

Rebuild and relink:

```bash
bun run build:plugin
ln -sfn "$PWD/plugin/dist/opencode-memnet.js" ~/.config/opencode/plugins/opencode-memnet.js
```

Restart OpenCode.

### Plugin connects but memory is disabled

The plugin requires a valid git repository identity for project memory.

Check:

```bash
git rev-parse --show-toplevel
git remote get-url origin
git config user.name
git config user.email
```

Set missing values:

```bash
git config user.name "Your Name"
git config user.email "you@example.com"
```

Restart OpenCode after changing git identity.

### Auth failures

Admin key:

```bash
curl -fsS -H "Authorization: Bearer $SERVER_API_KEY" http://localhost:4747/api/user-profiles
```

Profile key:

```bash
curl -fsS -H "Authorization: Bearer profile-secret" http://localhost:4747/api/user-profiles
```

Expected profile-key behavior: only the configured profile is returned.

### Data reset

This deletes all stored memories:

```bash
docker compose down -v
docker compose up -d --build
```

Use only when you intentionally want a clean database.

## License

MIT
