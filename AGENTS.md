# AGENTS.md

Guidance for coding agents working in this repository.

## Project Summary

`opencode-memnet` is a Bun/TypeScript persistent memory system for OpenCode-style
coding agents.

- `src/` is the standalone server. It serves the REST API and WebUI, initializes
  Postgres storage, runs migrations, warms the embedding service, and starts
  background maintenance jobs.
- `plugin/` is a separate OpenCode client plugin. It builds to a single
  `plugin/dist/opencode-memnet.js` bundle and talks to the server over HTTP.
- `shared/` contains client-side utilities imported by the plugin. Treat it as
  plugin-facing code, not server-only code.
- `tests/` contains Bun tests covering server config, storage behavior, privacy,
  tagging, AI provider plumbing, project scoping, and plugin bundle boundaries.
- `src/web/` is the static WebUI copied into `dist/web` by the server build.

The server and plugin are intentionally independent. Do not add server-side
storage, embedding, Postgres, or local transformer dependencies to the plugin
bundle.

## Working Rules

- Use Bun commands. Do not introduce npm/yarn/pnpm workflows unless explicitly
  requested.
- Preserve the server/plugin split. Server code can depend on Postgres,
  embeddings, and API handlers; plugin code should stay a thin remote client.
- Keep project-local changes minimal and reversible. Do not modify generated
  `dist/`, `node_modules/`, or local runtime data.
- Do not commit, push, publish, deploy, or run destructive Docker/database
  commands unless explicitly asked.
- Never write real secrets, tokens, private keys, passwords, `.env` contents, or
  API keys into source, tests, logs, docs, or summaries.
- Existing worktree changes may be user-owned. Inspect `git status --short`
  before editing and do not revert unrelated changes.

## Important Files

- Server entry point: `src/server.ts`
- Server config and env validation: `src/server-config.ts`
- Server API handlers: `src/services/api-handlers.ts`
- HTTP/WebUI server: `src/services/web-server.ts`
- Storage factory and interfaces: `src/services/storage/factory.ts`,
  `src/services/storage/types.ts`
- Postgres migrations: `src/services/storage/postgres/migrations.ts`
- Embedding service: `src/services/embedding.ts`
- Auto-capture and learning: `src/services/auto-capture-server.ts`,
  `src/services/user-memory-learning.ts`
- Privacy helpers: `src/services/privacy.ts`, `shared/privacy.ts`
- Plugin entry point: `plugin/src/plugin.ts`
- Plugin remote client: `plugin/src/services/remote-client.ts`
- Client config loading: `shared/client-config.ts`
- Plugin build script: `plugin/build.ts`

## Development Commands

Install dependencies:

```bash
bun install
cd plugin && bun install && cd ..
```

Build:

```bash
bun run build          # server only
bun run build:plugin   # plugin only
bun run build:all      # server + plugin
```

Type-check:

```bash
bun run typecheck
bun run typecheck:plugin
bun run typecheck:all
```

Test:

```bash
bun test
bun test tests/<file>.test.ts
```

Format:

```bash
bun run format:check
bun run format
```

Run the dev server:

```bash
bun run dev:server
```

## Verification Expectations

- For TypeScript changes, run the narrowest relevant Bun test first, then
  `bun run typecheck:all` when feasible.
- For plugin changes, run `bun run build:plugin` before tests that inspect
  `plugin/dist/opencode-memnet.js`.
- For server build, WebUI, or packaging changes, run `bun run build`.
- For formatting-only or documentation-only changes, run `bun run format:check`
  if the changed files are covered by the Prettier globs; otherwise inspect the
  diff directly.
- If a check cannot be run because it needs Postgres, Docker, network access, or
  secrets, report that explicitly with the command attempted or skipped.

## Database and Storage Rules

- Migrations live in `src/services/storage/postgres/migrations.ts` and are
  numbered in order. Add new migrations; do not rewrite already-applied migration
  semantics casually.
- Vector column dimensions come from `CONFIG.embeddingDimensions`. Keep
  `memories.vector` and `memories.tags_vector` using the same dimensions and
  compatible vector type.
- Keep DDL idempotent where possible. Prefer `IF NOT EXISTS` for additive schema
  changes.
- Be careful with HNSW index options and `vector` versus `halfvec`; tests cover
  some vector behavior, but production data compatibility matters.
- Storage repositories are initialized through the factory. Avoid bypassing the
  repository interfaces from unrelated service code.

## Configuration and Secrets

- Server configuration is environment-driven via `src/server-config.ts`.
  Required runtime values include `POSTGRES_URL`, `SERVER_API_KEY` unless auth is
  explicitly disabled, and embedding API settings.
- Client configuration is loaded from global and project JSON/JSONC files by
  `shared/client-config.ts`. Project config overlays global config.
- Preserve `resolveSecretValue` behavior for secret indirection.
- Do not log raw API keys, database URLs, prompt contents containing private
  material, or unredacted user secrets. Use existing redaction/privacy helpers.

## Plugin Boundary

- `plugin/src/plugin.ts` should remain remote-mode only. If client config is
  missing, it returns a noop plugin.
- The plugin build externalizes `@opencode-ai/plugin` and `@opencode-ai/sdk`.
- Keep plugin imports limited to `plugin/src/` and safe `shared/` modules.
  Importing from `src/services/embedding.ts`, storage, Postgres, or server config
  risks pulling server internals into the plugin loader bundle.
- `tests/plugin-bundle-boundary.test.ts` exists to catch accidental local
  transformer dependencies in the plugin bundle.

## Style

- TypeScript is strict. Prefer explicit types at module boundaries and exported
  APIs.
- Use ESM imports with `.js` specifiers for local TypeScript modules, matching
  the existing code.
- Follow Prettier settings: 2 spaces, semicolons, double quotes, print width 100,
  trailing commas where valid.
- Keep comments useful and sparse. Existing comments often document operational
  constraints; preserve them when editing nearby code.
- Avoid broad refactors while fixing narrow issues.

## Testing Notes

- Bun tests use `bun:test`.
- Config and provider tests often mutate process environment or module state.
  Keep tests isolated and reset state when adding similar coverage.
- Storage tests may rely on repository abstractions and vector formatting. Prefer
  testing behavior through existing public interfaces.
- Privacy and scoping tests are important for user trust. Update them when
  changing memory content, metadata, tag, or profile behavior.

## WebUI Notes

- `src/web/` contains static HTML, CSS, and JavaScript. The server build copies
  these files into `dist/web`.
- Keep WebUI changes dependency-free unless the project intentionally adopts a
  frontend build step.
- Check both API handler behavior and browser-facing output when changing WebUI
  data shapes.

## Docker and Runtime Notes

- `docker-compose.yml` runs the server plus bundled `pgvector/pgvector:pg16`.
- `docker-compose.external-db.yml` is for an externally managed Postgres.
- Do not run `docker compose down -v` unless explicitly asked; it deletes stored
  memories.
- Local server defaults are documented in `README.md`; keep README and `.env.example`
  aligned with config changes.

## Before Finishing

1. Review `git diff -- AGENTS.md` and any other files you intentionally changed.
2. Run the relevant checks listed above.
3. Report what changed, which files changed, which checks ran, and any remaining
   risk or skipped verification.
