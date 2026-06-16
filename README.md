# opencode-memnet

Persistent memory for OpenCode-style coding agents.

`opencode-memnet` has two pieces:

- a standalone server that stores memories, prompts, profiles, repository identity, tags, and
  embeddings in PostgreSQL with pgvector
- a local OpenCode plugin that talks to that server over HTTP

The supported install shape is:

- server: Docker Compose from this repository
- client plugin: clone this repository, build `plugin/dist/opencode-memnet.js` with Bun, and load
  that local file in OpenCode

There is no required npm package install flow for normal use.

## Requirements

- Git
- Docker with Docker Compose
- Bun
- PostgreSQL with pgvector, either through the bundled Compose database or an external database
- An OpenAI-compatible embeddings API
- Optional: an OpenAI-compatible chat completions API for auto-capture and profile learning

## Server Quickstart

This starts the server and a bundled PostgreSQL/pgvector database.

```bash
git clone https://git.phrk.org/pub/opencode-memnet.git
cd opencode-memnet
cp .env.example .env
```

Generate local secret values if you want to provide fixed keys yourself:

```bash
SERVER_API_KEY_VALUE="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')"
POSTGRES_PASSWORD_VALUE="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')"
```

Edit `.env` and set the required values:

```env
SERVER_API_KEY=<SERVER_API_KEY_VALUE>
POSTGRES_PASSWORD=<POSTGRES_PASSWORD_VALUE>

EMBEDDING_API_URL=https://api.openai.com/v1
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_API_KEY=sk-...
```

If you leave `SERVER_API_KEY` or `NEWUSER_API_KEY` empty, the server generates persistent keys and
writes them inside the container. Use `OPENCODEMEMNET_RESET_KEYS=TRUE` for one start to rotate those
generated keys.

Start the server:

```bash
docker compose up -d --build
```

Check it:

```bash
curl -fsS http://localhost:4747/api/health
```

Open the WebUI:

```text
http://localhost:4747
```

Use `SERVER_API_KEY` as the bearer token in the WebUI. Do not run
`docker compose down -v` unless you want to delete the database volume and all stored memories.

## Client Quickstart

Build the OpenCode plugin from the same clone:

```bash
bun install
cd plugin && bun install && cd ..
bun run build:plugin
```

Install the built local plugin:

```bash
mkdir -p ~/.config/opencode/plugins
ln -sfn "$PWD/plugin/dist/opencode-memnet.js" \
  ~/.config/opencode/plugins/opencode-memnet.js
```

Create the global plugin config:

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

Restart OpenCode after building the plugin or changing the plugin config.

## Detailed Workflow

### Runtime Pieces

| Piece              | Location   | Responsibility                                                       |
| ------------------ | ---------- | -------------------------------------------------------------------- |
| Server             | `src/`     | API, WebUI, config validation, migrations, storage, background jobs  |
| WebUI              | `src/web/` | Browser UI for memories, tags, profiles, stats, and maintenance jobs |
| Plugin             | `plugin/`  | OpenCode hooks, memory tool, remote HTTP client                      |
| Shared client code | `shared/`  | Plugin-safe config, JSONC parsing, tags, privacy, logging            |
| Database           | PostgreSQL | Durable records, profiles, repository identity, pgvector indexes     |

### Authentication

Every non-health API route requires:

```http
Authorization: Bearer <SERVER_API_KEY_OR_PROFILE_KEY>
```

SERVER_API_KEY remains the admin/all-profiles key. It can read and manage all profiles.

`PROFILE_KEYS_FILE` can define profile-scoped API keys. A profile key can only read, write, and
run maintenance jobs for its configured `profileId`. If a profile-key request supplies a different
`profileId`, the server rejects it.

Profile keys are restricted to their configured profileId.

The old keyless WebUI/client auth modes are no longer supported. Use `SERVER_API_KEY` for admin
access or profile keys for scoped access.

### Identity Model

The current identity model is a clean-start profile plus git repository model:

- `profileId` identifies the user/profile.
- `repoId` is derived from normalized git repository identity.
- The database stores these scopes in `profile_id` and `repo_id`.
- Project memory is scoped by `profileId` and `repoId`.
- Local filesystem paths and repository nicknames are stored as metadata only.
- `SERVER_API_KEY` callers may choose `profileId`; profile-key callers get the profile from the key.

Use a clean database for this model if you are coming from an older user-email, nickname, or path-keyed
database.

### Plugin Startup

1. OpenCode loads `~/.config/opencode/plugins/opencode-memnet.js`.
2. The plugin reads global config, then project config.
3. Project config overrides global config. Nested `chatMessage`, `customMessage`, and `memory`
   objects are merged one level deep.
4. If `serverUrl` or `apiKey` is missing, the plugin returns a noop plugin.
5. The plugin collects git project metadata.
6. The plugin calls `POST /api/client/connect`.
7. The server authenticates the key and returns the principal.
8. If the principal is a profile key, the plugin uses that profile. Otherwise it uses
   `profileId` from config or `default`.

### Chat Context Injection

When OpenCode emits `chat.message`:

1. The plugin reads the user message.
2. If `customMessage.enabled` is true, it injects the configured custom text.
3. If `chatMessage.enabled` is true, it calls `POST /api/context/inject`.
4. The server embeds/searches profile/repo-scoped memories.
5. The server can include learned profile context when `INJECT_PROFILE=true`.
6. The plugin prepends the returned memory context to the message parts.

`chatMessage.injectOn` controls whether the plugin injects on the first message in a session or on
every message.

### Auto-Capture

When OpenCode emits `session.idle`:

1. The plugin waits briefly so rapid events coalesce.
2. It reads the session messages from OpenCode.
3. It sends conversation content to `POST /api/auto-capture`.
4. The server uses the configured chat completions model to extract durable memories.
5. Accepted memories are stored with embeddings and scoped to the profile/repository.
6. Profile learning can update preferences, behavior patterns, workflows, and changelog snapshots.

Auto-capture needs server-side `MEMORY_MODEL`, `MEMORY_API_URL`, and `MEMORY_API_KEY`. Client-side
`autoCaptureEnabled=false` disables sending idle sessions to the server.

### Session Compaction Recovery

When OpenCode emits `session.compacted`, the plugin searches memories for the compacted session and
adds a restored memory prompt back into that session. This helps keep useful session facts available
after compaction.

### Memory Tool

The plugin exposes a `memory` tool to OpenCode.

| Mode      | Required args | Optional args    | Behavior                               |
| --------- | ------------- | ---------------- | -------------------------------------- |
| `help`    | none          | none             | Shows supported tool commands          |
| `add`     | `content`     | `type`, `tags`   | Stores a memory for the current repo   |
| `search`  | `query`       | `scope`, `limit` | Searches project or all-profile memory |
| `profile` | none          | none             | Shows the effective profile            |
| `list`    | none          | `scope`, `limit` | Lists recent memories                  |
| `forget`  | `memoryId`    | none             | Deletes one memory                     |

Scopes:

- `project`: current `profileId` plus current `repoId`
- `all-projects`: current `profileId` across repositories

## Manual Docker Compose Server Setup

### 1. Clone And Create Config

```bash
git clone https://git.phrk.org/pub/opencode-memnet.git
cd opencode-memnet
cp .env.example .env
```

Generate local secret values if you want to provide fixed keys yourself:

```bash
SERVER_API_KEY_VALUE="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')"
POSTGRES_PASSWORD_VALUE="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')"
```

Edit `.env`. At minimum, set:

```env
SERVER_API_KEY=<SERVER_API_KEY_VALUE>
POSTGRES_PASSWORD=<POSTGRES_PASSWORD_VALUE>
EMBEDDING_API_URL=https://api.openai.com/v1
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_API_KEY=sk-...
```

Paste the generated values into `.env`; do not keep the shell variables or print the values in logs.
If you leave `SERVER_API_KEY` empty, the server writes a generated admin key to
`/tmp/opencode-memnet-server-api-key`.

### 2. Optional Profile Keys

Create a read-only secrets file for profile-scoped keys:

```bash
mkdir -p secrets
cat > secrets/opencode-memnet-profile-keys.jsonc <<'JSONC'
{
  "profiles": [
    {
      "profileId": "default",
      "displayName": "Default",
      "apiKey": "env://OPENCODE_MEMNET_PROFILE_KEY_DEFAULT"
    }
  ]
}
JSONC
```

Then set:

```env
PROFILE_KEYS_FILE=/run/secrets/opencode-memnet-profile-keys.jsonc
OPENCODE_MEMNET_PROFILE_KEY_DEFAULT=<generated-profile-key>
```

Generate static profile keys the same way as `SERVER_API_KEY`:

```bash
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
```

Compose mounts `./secrets` at `/run/secrets` read-only. `secrets/.gitignore` keeps secret files out
of git.

### 2a. Bootstrap Profile Enrollment

`NEWUSER_API_KEY` is a one-step enrollment key for creating a profile API key from the plugin.
Configure the plugin with `apiKey` set to `NEWUSER_API_KEY` and a non-empty `profileId`. On the
first successful `POST /api/client/connect`, the server generates a persistent profile key, stores
only its SHA-256 hash, returns the key once, and the plugin rewrites the same config file that
provided the bootstrap `apiKey`.

Enrollment is allowed only when the requested profile has no static key in `PROFILE_KEYS_FILE` and
no generated key in Postgres. After enrollment, configure clients with the generated profile key
instead of `NEWUSER_API_KEY`.

To use a fixed bootstrap key, generate one:

```bash
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
```

Then paste it into `.env`:

```env
NEWUSER_API_KEY=<generated-newuser-bootstrap-key>
```

To use a generated bootstrap key instead, leave `NEWUSER_API_KEY` empty in `.env`.

If `NEWUSER_API_KEY` is empty, the server generates or reuses a persistent bootstrap key at:

```text
/tmp/opencode-memnet-newuser-api-key
```

For Docker Compose, read it inside the server container:

```bash
docker compose exec server cat /tmp/opencode-memnet-newuser-api-key
```

The generated bootstrap key is reused on later server starts. The key value is never printed in logs.
Set `OPENCODEMEMNET_RESET_KEYS=TRUE` for one server start to rotate both generated `SERVER_API_KEY`
and `NEWUSER_API_KEY` file-backed keys, then set it back to `false` or remove it.

### 3. Start With The Bundled Database

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f server
```

The default Compose file starts:

- `db`: `pgvector/pgvector:pg16`
- `server`: the opencode-memnet API and WebUI

The server waits for the database health check before it starts.

### 4. Start With An External Database

Use this when PostgreSQL already exists elsewhere:

```bash
docker compose -f docker-compose.external-db.yml up -d --build
```

Required external database setup:

- PostgreSQL 16 or compatible
- pgvector extension available
- database and user already created
- `POSTGRES_URL` points to that database
- `POSTGRES_SSL` set to `require` for managed TLS databases, or `false` for trusted local networks

### 5. Server Operations

```bash
docker compose logs -f server
docker compose restart server
docker compose down
```

Backup bundled database:

```bash
docker compose exec db pg_dump \
  -U "${POSTGRES_USER:-opencode}" \
  "${POSTGRES_DB:-opencode_mem}" > opencode-memnet.sql
```

Restore bundled database:

```bash
docker compose stop server
cat opencode-memnet.sql | docker compose exec -T db psql \
  -U "${POSTGRES_USER:-opencode}" \
  "${POSTGRES_DB:-opencode_mem}"
docker compose start server
```

Upgrade:

```bash
git pull --ff-only
bun install
cd plugin && bun install && cd ..
bun run build:plugin
docker compose up -d --build
```

Restart OpenCode after rebuilding the plugin.

### Server Environment Options

Secret values for `POSTGRES_URL`, `EMBEDDING_API_KEY`, and `MEMORY_API_KEY` support:

- plain values
- `env://OTHER_ENV_VAR`
- `file:///absolute/path/to/secret`

| Variable                             | Required | Default                                  | Description                                                                              |
| ------------------------------------ | -------- | ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `SERVER_API_KEY`                     | no       | generated file-backed key                | Admin bearer token for all non-health API routes and all profiles.                       |
| `NEWUSER_API_KEY`                    | no       | generated file-backed key                | Bootstrap key accepted only by `POST /api/client/connect` for first profile enrollment.  |
| `OPENCODEMEMNET_RESET_KEYS`          | no       | `false`                                  | Set to `TRUE` for one start to rotate generated file-backed server and bootstrap keys.   |
| `PROFILE_KEYS_FILE`                  | no       | empty                                    | JSONC file containing profile-scoped API keys.                                           |
| `WEB_SERVER_ALLOWED_ORIGIN`          | no       | `*`                                      | CORS `Access-Control-Allow-Origin` value.                                                |
| `SERVER_HOST`                        | no       | `0.0.0.0`                                | Interface the server binds to inside Docker or direct Bun runtime.                       |
| `SERVER_PORT`                        | no       | `4747`                                   | Port the server listens on inside Docker or direct Bun runtime.                          |
| `EXTERNAL_HOST`                      | no       | `127.0.0.1`                              | Host-side bind address for Docker port mapping. Use `0.0.0.0` for LAN exposure.          |
| `HOST_PORT`                          | no       | `4747`                                   | Host-side port for Docker port mapping.                                                  |
| `LOG_LEVEL`                          | no       | `info`                                   | Console log level: `debug`, `info`, `warn`, or `error`.                                  |
| `DEBUG`                              | no       | `false`                                  | Shortcut for debug logging when `LOG_LEVEL` is unset.                                    |
| `OPENCODE_MEM_LOG_FILE`              | no       | `~/.opencode-memnet/opencode-memnet.log` | Log file path used by server/shared loggers.                                             |
| `CLIENT_WELCOME_BACK_THRESHOLD`      | no       | `7d`                                     | Client inactivity threshold before welcome-back messaging. Supports `h`, `d`, `w`.       |
| `DRAIN_TIMEOUT_SECONDS`              | no       | `10`                                     | Shutdown drain timeout used by the server process.                                       |
| `POSTGRES_URL`                       | yes      | bundled Compose URL                      | PostgreSQL connection string. Required for external database Compose.                    |
| `POSTGRES_SSL`                       | no       | `false` bundled, `require` external      | Database SSL mode. Use `false` for local Compose, `require` for managed DBs.             |
| `POSTGRES_USER`                      | bundled  | `opencode`                               | Bundled database user.                                                                   |
| `POSTGRES_PASSWORD`                  | bundled  | empty                                    | Bundled database password. Required by `docker-compose.yml`.                             |
| `POSTGRES_DB`                        | bundled  | `opencode_mem`                           | Bundled database name.                                                                   |
| `POSTGRES_MAX_CONNECTIONS`           | no       | `10`                                     | Maximum database pool connections.                                                       |
| `POSTGRES_IDLE_TIMEOUT_SECONDS`      | no       | `30`                                     | How long idle DB connections remain open.                                                |
| `POSTGRES_CONNECT_TIMEOUT_SECONDS`   | no       | `10`                                     | How long to wait for a DB connection attempt.                                            |
| `POSTGRES_VECTOR_TYPE`               | no       | `vector`                                 | pgvector storage type: `vector` or `halfvec`. Changing after data exists needs rebuilds. |
| `POSTGRES_HNSW_EF_SEARCH`            | no       | `128`                                    | Query-time HNSW search breadth. Higher improves recall and costs latency.                |
| `POSTGRES_HNSW_EF_CONSTRUCTION`      | no       | `256`                                    | HNSW index build quality. Changing after index creation requires rebuilding indexes.     |
| `EMBEDDING_API_URL`                  | yes      | empty                                    | OpenAI-compatible embeddings API base URL.                                               |
| `EMBEDDING_MODEL`                    | yes      | empty                                    | Embedding model name.                                                                    |
| `EMBEDDING_API_KEY`                  | yes      | `OPENAI_API_KEY` fallback                | Embedding API key.                                                                       |
| `EMBEDDING_DIMENSIONS`               | no       | auto                                     | Vector dimension override. Leave `0` unless using an unknown custom model.               |
| `EMBEDDING_MAX_TOKENS_CONTENT`       | no       | `2048`                                   | Max tokens embedded from memory content.                                                 |
| `EMBEDDING_MAX_TOKENS_TAGS`          | no       | `256`                                    | Max tokens embedded from tag text.                                                       |
| `EMBEDDING_MAX_TOKENS_QUERY`         | no       | `512`                                    | Max tokens embedded from search queries.                                                 |
| `EMBEDDING_MAX_TOKENS_MIGRATION`     | no       | `2048`                                   | Max tokens embedded per memory during migration/backfill work.                           |
| `EMBEDDING_TRUNCATION_CONTENT`       | no       | `right`                                  | Keep `left` or `right` side when memory content is too long.                             |
| `EMBEDDING_TRUNCATION_TAGS`          | no       | `right`                                  | Keep `left` or `right` side when tag text is too long.                                   |
| `EMBEDDING_TRUNCATION_QUERY`         | no       | `right`                                  | Keep `left` or `right` side when search query text is too long.                          |
| `EMBEDDING_TRUNCATION_MIGRATION`     | no       | `right`                                  | Keep `left` or `right` side during migration/backfill embedding.                         |
| `SIMILARITY_THRESHOLD`               | no       | `0.6`                                    | Minimum vector similarity for search/context results.                                    |
| `MAX_MEMORIES`                       | no       | `10`                                     | Server default maximum memories for injected context.                                    |
| `INJECT_PROFILE`                     | no       | `true`                                   | Include learned profile context in context injection unless set to `false`.              |
| `MEMORY_MODEL`                       | no       | empty                                    | Chat completions model for auto-capture and profile learning.                            |
| `MEMORY_API_URL`                     | no       | empty                                    | OpenAI-compatible chat completions API base URL.                                         |
| `MEMORY_API_KEY`                     | no       | empty                                    | Chat completions API key for memory extraction/profile learning.                         |
| `MEMORY_TEMPERATURE`                 | no       | `0.3`                                    | Memory extraction temperature. Set `false` to omit the temperature parameter.            |
| `OPENCODE_PROVIDER`                  | no       | empty                                    | Optional provider identifier passed into server behavior.                                |
| `OPENCODE_MODEL`                     | no       | empty                                    | Optional model identifier passed into server behavior.                                   |
| `AUTO_CAPTURE_MAX_ITERATIONS`        | no       | `5`                                      | Maximum extraction iterations per auto-capture run.                                      |
| `AUTO_CAPTURE_ITERATION_TIMEOUT`     | no       | `30000`                                  | Timeout in milliseconds for one extraction iteration.                                    |
| `AUTO_CAPTURE_LANGUAGE`              | no       | `auto`                                   | Memory output language, such as `auto`, `en`, or another language code.                  |
| `AI_SESSION_RETENTION_DAYS`          | no       | `7`                                      | Retention period for AI session records.                                                 |
| `AUTO_CLEANUP_RETENTION_DAYS`        | no       | `90`                                     | Cleanup age for unpinned, non-prompt-linked memories. `0` disables cleanup.              |
| `USER_PROFILE_ANALYSIS_INTERVAL`     | no       | `10`                                     | Sessions between profile learning runs.                                                  |
| `USER_PROFILE_MAX_PREFERENCES`       | no       | `20`                                     | Maximum learned profile preferences.                                                     |
| `USER_PROFILE_MAX_PATTERNS`          | no       | `15`                                     | Maximum learned behavior patterns.                                                       |
| `USER_PROFILE_MAX_WORKFLOWS`         | no       | `10`                                     | Maximum learned workflows.                                                               |
| `USER_PROFILE_CONFIDENCE_DECAY_DAYS` | no       | `30`                                     | Days used for profile confidence decay.                                                  |
| `USER_PROFILE_CHANGELOG_RETENTION`   | no       | `5`                                      | Number of profile changelog snapshots to keep.                                           |

Known embedding dimensions:

| Model                             | Dimensions |
| --------------------------------- | ---------- |
| `text-embedding-3-small`          | 1536       |
| `text-embedding-3-large`          | 3072       |
| `text-embedding-ada-002`          | 1536       |
| `embed-english-v3.0`              | 1024       |
| `embed-multilingual-v3.0`         | 1024       |
| `embed-english-light-v3.0`        | 384        |
| `embed-multilingual-light-v3.0`   | 384        |
| `text-embedding-004`              | 768        |
| `text-multilingual-embedding-002` | 768        |
| `voyage-3`                        | 1024       |
| `voyage-3-lite`                   | 512        |
| `voyage-code-3`                   | 1024       |

Unknown embedding models default to 1024 dimensions unless `EMBEDDING_DIMENSIONS` is set.

## Manual Plugin Setup

### 1. Clone And Install

```bash
git clone https://git.phrk.org/pub/opencode-memnet.git
cd opencode-memnet
bun install
cd plugin && bun install && cd ..
```

### 2. Build

```bash
bun run build:plugin
```

This writes:

- `plugin/dist/opencode-memnet.js`
- `plugin/dist/package.json`

The plugin bundle externalizes `@opencode-ai/plugin` and `@opencode-ai/sdk` so it stays a thin
remote client.

### 3. Install Into OpenCode

Global install:

```bash
mkdir -p ~/.config/opencode/plugins
ln -sfn "$PWD/plugin/dist/opencode-memnet.js" \
  ~/.config/opencode/plugins/opencode-memnet.js
```

Project-local install:

```bash
mkdir -p .opencode/plugins
ln -sfn "$PWD/plugin/dist/opencode-memnet.js" \
  .opencode/plugins/opencode-memnet.js
```

Use a symlink while developing so rebuilds take effect without copying files. Restart OpenCode after
each rebuild.

### 4. Configure The Plugin

Config file lookup order:

1. `~/.config/opencode/opencode-memnet.jsonc`
2. `~/.config/opencode/opencode-memnet.json`
3. `<project>/.opencode/opencode-memnet.jsonc`
4. `<project>/.opencode/opencode-memnet.json`

Global config is loaded first. Project config overrides global config. Nested `chatMessage`,
`customMessage`, and `memory` objects are merged one level deep.

Full JSONC example:

```jsonc
{
  "serverUrl": "http://localhost:4747",
  "apiKey": "change-me-admin-key-or-profile-key",
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

Minimal profile-key config:

```jsonc
{
  "serverUrl": "http://localhost:4747",
  "apiKey": "change-me-profile-key",
}
```

When `apiKey` is a profile key, the server returns the effective `profileId`; the plugin does not
need `profileId` in config.

Minimal bootstrap enrollment config:

```jsonc
{
  "serverUrl": "http://localhost:4747",
  "apiKey": "NEWUSER_API_KEY",
  "profileId": "default",
}
```

After enrollment succeeds, the plugin replaces `apiKey` in the config file that supplied it with the
generated profile key. The generated key is not logged or shown in a toast.

### Plugin Config Options

| JSONC field                         | Required | Default                 | Allowed values                   | Description                                                                                                |
| ----------------------------------- | -------- | ----------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `serverUrl`                         | yes      | `http://localhost:4747` | URL string                       | Base URL of the opencode-memnet server.                                                                    |
| `apiKey`                            | yes      | empty                   | string                           | `SERVER_API_KEY`, a profile key, or `NEWUSER_API_KEY` for enrollment. Missing/empty makes the plugin noop. |
| `profileId`                         | no       | `default` for admin key | string                           | Profile to use with `SERVER_API_KEY`; required with `NEWUSER_API_KEY`; ignored for profile keys.           |
| `autoCaptureEnabled`                | no       | `true`                  | boolean                          | Enables `session.idle` auto-capture requests to the server.                                                |
| `showAutoCaptureToasts`             | no       | `true`                  | boolean                          | Shows success toasts when auto-capture stores memory.                                                      |
| `showErrorToasts`                   | no       | `true`                  | boolean                          | Reserved for surfacing plugin errors through OpenCode toasts.                                              |
| `chatMessage.enabled`               | no       | `true`                  | boolean                          | Enables memory context injection for chat messages.                                                        |
| `chatMessage.maxMemories`           | no       | `3`                     | number                           | Maximum memories requested for one injected context block.                                                 |
| `chatMessage.excludeCurrentSession` | no       | `true`                  | boolean                          | Excludes current session memories from context search.                                                     |
| `chatMessage.maxAgeDays`            | no       | unset                   | number or `null`                 | Maximum age for memories used in context injection.                                                        |
| `chatMessage.injectOn`              | no       | `first`                 | `first`, `always`                | Injection frequency for chat messages.                                                                     |
| `customMessage.enabled`             | no       | `false`                 | boolean                          | Enables injection of static custom text into chat messages.                                                |
| `customMessage.frequency`           | no       | `first`                 | `first`, `always`                | Injection frequency for `customMessage.text`.                                                              |
| `customMessage.text`                | no       | empty                   | string                           | Static custom text to add to chat messages when enabled.                                                   |
| `memory.defaultScope`               | no       | `project`               | `project`, `all-projects`        | Default scope for the memory tool's `search` and `list` modes.                                             |
| `logLevel`                          | no       | env/default logger      | `debug`, `info`, `warn`, `error` | Plugin/shared logger level.                                                                                |

### Plugin Behavior Notes

- `serverUrl` has its trailing slash removed before requests.
- The plugin sends `Authorization: Bearer <apiKey>` on every API request.
- The plugin sends `X-Client-ID` and `X-Opencode-Memnet-Client: plugin` headers.
- Private content markers are stripped before manual `memory add` stores content.
- Fully private content is blocked from manual storage.
- The plugin reads git metadata to build a stable repository identity.

## API Summary

All API routes except public health routes require bearer authentication.

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

## Development

Install dependencies:

```bash
bun install
cd plugin && bun install && cd ..
```

Build:

```bash
bun run build
bun run build:plugin
bun run build:all
```

Typecheck:

```bash
bun run typecheck
bun run typecheck:plugin
bun run typecheck:all
```

Test:

```bash
bun test
bun run test
bun test tests/profile-auth.test.ts
```

Format:

```bash
bun run format
bun run format:check
```

Project layout:

```text
.
├── docker-compose.yml
├── docker-compose.external-db.yml
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

### Server Does Not Start

Check config and logs:

```bash
docker compose --env-file .env config
docker compose logs server
```

Common missing values:

- `SERVER_API_KEY`
- `NEWUSER_API_KEY` if using bootstrap enrollment
- `POSTGRES_PASSWORD` when using bundled database Compose
- `POSTGRES_URL` when using external database Compose
- `EMBEDDING_API_URL`
- `EMBEDDING_MODEL`
- `EMBEDDING_API_KEY` or `OPENAI_API_KEY`

### Docker Config Says `localhost` Is Invalid

Docker port mappings need an IP address, not the hostname `localhost`. Use:

```env
EXTERNAL_HOST=127.0.0.1
```

Use `0.0.0.0` only when you intentionally want the server reachable from other machines on the
network.

### Plugin Does Nothing

The plugin returns a noop plugin when either `serverUrl` or `apiKey` is missing. Check:

```bash
cat ~/.config/opencode/opencode-memnet.jsonc
cat .opencode/opencode-memnet.jsonc
```

Then rebuild and restart OpenCode:

```bash
bun run build:plugin
```

### Profile Key File Fails In Docker

For Docker Compose, the host file must be under `./secrets` and the server must read it from
`/run/secrets`:

```text
./secrets/opencode-memnet-profile-keys.jsonc
```

```env
PROFILE_KEYS_FILE=/run/secrets/opencode-memnet-profile-keys.jsonc
```

### Bootstrap Enrollment Key In Docker

When `SERVER_API_KEY` is blank, the server writes a persistent generated admin key inside the
container:

```bash
docker compose exec server cat /tmp/opencode-memnet-server-api-key
```

When `NEWUSER_API_KEY` is blank, the server writes a persistent bootstrap key inside the container:

```bash
docker compose exec server cat /tmp/opencode-memnet-newuser-api-key
```

Use that value as the plugin `apiKey` with a `profileId` for the first connection. The plugin
rewrites the config to the generated profile key after enrollment.

To rotate generated file-backed keys, set `OPENCODEMEMNET_RESET_KEYS=TRUE` for one server start,
read the new files, then unset it or set it back to `false`.

### Auto-Capture Does Not Store Memories

Check server-side memory model config:

```env
MEMORY_MODEL=gpt-4o-mini
MEMORY_API_URL=https://api.openai.com/v1
MEMORY_API_KEY=sk-...
```

Also check the client config:

```jsonc
{
  "autoCaptureEnabled": true,
}
```
