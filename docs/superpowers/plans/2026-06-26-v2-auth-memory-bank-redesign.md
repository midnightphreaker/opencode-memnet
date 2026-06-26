# V2 Auth And Memory Bank Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace legacy profile/new-user/generated-key auth with a single required `SERVER_API_KEY`, admin-managed user API keys, and Memory Bank-scoped memory operations.

**Architecture:** Introduce a central `AuthService` that authenticates the server admin key and hashed user API keys, returning a typed principal. Add user API key and Memory Bank repositories, route every runtime memory/prompt/session/profile-learning operation through an active Memory Bank UUID, then update WebUI, OpenCode plugin, and Codex plugin clients to use the v2 connection and bank-selection contract. v2 is a clean start for data: any temporary legacy columns that remain are schema-transition residue only and must not be used for ownership, lookup, import, or compatibility.

**Tech Stack:** Bun, TypeScript, Postgres with pgvector, vanilla WebUI JavaScript/CSS, OpenCode plugin, Codex MCP/hooks.

---

## Execution Notes

- Do not commit unless the current session has explicit commit authorization. The commit steps below are checkpoints to run only when commits are allowed.
- Subagents executing any task must load exact archived skills with `load-skill` before reading code:
  - `git-repo-study`
  - `test-driven-development`
  - `verification-before-completion`
- The current working tree was dirty before this plan was written: `AGENTS.md` is modified and `.opencode/orchestrator/*` files are deleted. Do not revert those changes.
- opencode-memnet memory tools returned `Invalid JSON response` during planning. Re-attempt memory context at execution start, but do not block implementation if the same MCP error persists.

## Review Fixups Applied

The 2026-06-26 parallel review identified route, migration, authorization, and test-coverage gaps. This plan now treats the following as non-negotiable implementation requirements:

- `SERVER_API_KEY` is resolved with explicit precedence: environment `SERVER_API_KEY` wins, config-file `server.apiKey` is the fallback, and startup fails when both are missing or blank. Task 1 includes tests for all three cases.
- Destructive clean-start reset is an explicit operator action, not an ordinary startup migration. Operators must run `scripts/v2-clean-start.ts` to create and verify a `pg_dump --format=custom` backup, then remove v1 opencode-memnet runtime/auth/memory data before migration 15 runs. Migration 15 must refuse to proceed when v1 data exists and the clean-start reset has not already removed it. There is no v1-to-v2 import, backfill, runtime exposure, or upgrade path.
- Memory Bank route coverage is explicit in Task 4B. Admin nested Memory Bank routes and user `GET /api/memory-banks` / `POST /api/memory-banks` routes must exist before WebUI, OpenCode, or Codex client work begins.
- All memory and prompt operations are scoped by a resolved Memory Bank. ID-based operations such as `getById`, delete, `deleteMany`, update, pin, unpin, prompt cascades, snapshots, and changelog paths must either include `{ apiKeyId, memoryBankId }` in repository methods or enforce a post-fetch bank check before mutation.
- Admin operations never write an empty owner UUID. Admin requests resolve the target Memory Bank first, then write that bank owner's real `apiKeyId` and `memoryBankId`.
- Browser and client requests use `X-Memory-Bank-ID`; CORS preflight and JSON responses must allow that header.
- `last_used_at` writes are throttled and non-critical. Authentication must not fail because the touch update failed.
- Client connect returns the `ClientConnectResponse` contract only, with optional scoped stats only when the request sets `includeStats: true`; Codex hooks omit stats.
- Legacy tests are converted to Memory Bank isolation tests where they still exercise useful behavior. Tests centered only on removed generated-key/new-user/profile-key behavior are deleted after replacement coverage exists.

## Clean-Start Review Fixups Applied

The 2026-06-26 clean-start review identified data-safety, schema-isolation, route-contract, and performance gaps. This plan incorporates every Critical, High, and Medium finding as implementation requirements:

- Clean start is a two-step operator contract. `scripts/v2-clean-start.ts` creates `backups/opencode-memnet-v1-<utc timestamp>.dump`, runs `pg_dump --format=custom`, verifies the dump with `pg_restore --list`, then truncates or drops only the listed v1 opencode-memnet runtime/auth/memory tables. It must not run automatically on normal server startup.
- Migration 15 removes the blind destructive reset from the migration body. It first counts v1 data rows and aborts before destructive work or schema changes when rows remain. It may continue without backup only when the v1 data tables are already empty.
- v2 ownership is database-enforced after the clean-start reset. `memories`, `user_prompts`, retained profile-learning tables, `ai_sessions`, and `ai_messages` get `api_key_id` and `memory_bank_id` ownership with `NOT NULL` constraints, foreign keys, and bank-scoped indexes.
- AI session persistence is retained for v2 because existing OpenCode and Codex session features use those repositories. AI sessions and messages are owned by the active Memory Bank and tested for cross-bank isolation.
- Tags are bank-local. `memory_tags` includes `memory_bank_id` with unique `(memory_bank_id, canonical_name)`, and tag links/aliases carry `memory_bank_id` so list, alias, related-memory, and tag-migration paths cannot cross banks.
- Task 1 config-file tests use a temporary `HOME` and the existing `~/.config/opencode/opencode-memnet.jsonc` or `.json` convention. The plan does not rely on a nonexistent `CONFIG_FILE` environment variable.
- `ClientConnectResponse` scoped stats are authorized before reading stats. The repository contract adds `getClientStatsForBank(clientId, apiKeyId, memoryBankId)`, and tests cover a user API key requesting stats for another key's Memory Bank.
- Task 4B route tests cover admin update, revoke, Memory Bank update, Memory Bank delete, and refusal to delete a non-empty Memory Bank.
- `tests/v2-clean-start-no-upgrade-path.test.ts` asserts there is no v1 import, backfill, or runtime exposure path for v1 rows.
- Prompt indexes include bank-scoped queue, user-learning, linked-memory, and session paths. Vector-search acceptance includes bank-filtered pgvector validation with `hnsw.ef_search`, candidate limits, and query-plan checks.

## File Structure

Create:
- `scripts/v2-clean-start.ts` - explicit operator clean-start command; creates and verifies a backup dump, then removes v1 opencode-memnet runtime/auth/memory data.
- `src/services/auth-service.ts` - central v2 auth, API-key generation/hash/lookup, principal types, bank authorization helpers.
- `src/services/storage/postgres/user-api-key-repository.ts` - Postgres repository for admin-managed user API keys.
- `src/services/storage/postgres/memory-bank-repository.ts` - Postgres repository for Memory Banks.
- `shared/memory-bank.ts` - shared Memory Bank suggestion, active-bank state, and magic prompt parser helpers.
- `tests/auth-service.test.ts` - config-free unit tests for API key generation, hashing, and principal behavior.
- `tests/user-api-key-repository-contract.test.ts` - repository contract tests with mocked SQL for hashed key storage.
- `tests/memory-bank-repository-contract.test.ts` - repository contract tests for Memory Bank ownership and uniqueness.
- `tests/v2-clean-start-script.test.ts` - clean-start command tests for backup command shape, `pg_restore --list`, v1 table removal, and no import/backfill behavior.
- `tests/v2-clean-start-migration-guard.test.ts` - migration contract tests proving migration 15 aborts before destructive work or schema changes when v1 data exists.
- `tests/v2-ownership-not-null.test.ts` - migration contract tests proving unscoped runtime inserts fail after clean start.
- `tests/v2-clean-start-no-upgrade-path.test.ts` - source assertions proving no v1 import/backfill/runtime exposure path exists.
- `tests/v2-auth-middleware.test.ts` - route auth tests for admin and user API key principals.
- `tests/api-handlers-memory-bank-scope.test.ts` - handler tests proving active-bank isolation.
- `tests/webui-v2-auth-memory-banks.test.ts` - text/behavior tests for WebUI admin API key and Memory Bank controls.
- `tests/plugin-memory-bank-startup.test.ts` - OpenCode plugin startup behavior around no-bank and active-bank state.
- `tests/plugin-magic-memory-bank.test.ts` - OpenCode magic prompt create/activate behavior.
- `plugin-codex/tests/memory-bank.test.ts` - shared Codex helper and HTTP client Memory Bank behavior.

Modify:
- `src/server-config.ts` - require env/config `SERVER_API_KEY`; remove generated server key, `NEWUSER_API_KEY`, profile key files, and auth-disable remnants.
- `src/config.ts` - carry optional config-file `server.apiKey` into server config if the project keeps config-file support for server secrets.
- `src/services/auth.ts` - replace legacy `AuthMiddleware` logic with v2 middleware backed by `AuthService`.
- `src/services/profile-auth.ts` - remove after all imports are gone.
- `src/services/storage/types.ts` - add user API key, Memory Bank, and owner-scope repository types; update memory/prompt rows with `apiKeyId` and `memoryBankId`.
- `src/services/storage/factory.ts` - expose lazy v2 repositories and remove generated profile key repository.
- `src/services/storage/postgres/migrations.ts` - add v2 tables and columns.
- `src/services/storage/postgres/memory-repository.ts` - filter by `api_key_id` and `memory_bank_id`.
- `src/services/storage/postgres/prompt-repository.ts` - filter prompts by `api_key_id` and `memory_bank_id`.
- `src/services/storage/postgres/profile-repository.ts` - either rename public concept to bank profile or scope internal user-profile rows by `api_key_id` and `memory_bank_id`.
- `src/services/api-handlers.ts` - add admin handlers, connect response, and active Memory Bank enforcement.
- `src/services/web-server.ts` - add v2 routes, use `AuthService`, remove profile/new-user fallback auth.
- `src/server.ts` - pass only `SERVER_API_KEY`/`AuthService` into web server.
- `src/web/index.html`, `src/web/app.js`, `src/web/styles.css`, `src/web/i18n.js` - admin key management and Memory Bank management UI.
- `shared/client-config.ts`, `shared/types.ts` - remove profile config and add v2 DTOs.
- `plugin/src/services/remote-client.ts`, `plugin/src/index-remote.ts` - OpenCode v2 connect, bank activation, and memory routing.
- `plugin-codex/src/config.ts`, `plugin-codex/src/http-client.ts`, `plugin-codex/src/mcp/tools.ts`, `plugin-codex/src/mcp/server.ts`, `plugin-codex/src/hooks/runner.ts` - Codex v2 connect, bank activation, and memory routing.
- `plugin-codex/skills/opencode-memnet-memory/SKILL.md` - update user-facing instructions for Memory Banks.
- `README.md`, `.env.example`, `docker-compose.yml`, `docker-compose.external-db.yml`, `plugin-codex/README.md` - remove legacy auth docs and document v2 setup.

Delete only after imports/tests are converted and replacement Memory Bank coverage exists:
- `src/services/storage/postgres/profile-api-key-repository.ts`
- legacy tests centered only on `NEWUSER_API_KEY`, generated profile keys, static profile keys, and profile route locking.
- convert legacy cross-owner delete/update/pin/unpin, cascade, search-context, maintenance, linked-prompt, and tag-isolation tests to cross-Memory Bank equivalents instead of deleting them.

## V2 API Contract

Use these response shapes consistently across server, WebUI, OpenCode, and Codex clients:

```ts
export type AdminPrincipal = { kind: "admin" };

export type UserApiKeyPrincipal = {
  kind: "user-api-key";
  apiKeyId: string;
  apiKeyName: string;
  apiKeyDescription: string;
};

export type Principal = AdminPrincipal | UserApiKeyPrincipal;

export type UserApiKeySummary = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
};

export type CreatedUserApiKey = {
  apiKey: UserApiKeySummary;
  value: string;
};

export type MemoryBankSummary = {
  id: string;
  apiKeyId: string;
  name: string;
  description: string;
  shortcut: string;
  createdAt: string;
  updatedAt: string;
};

export type ClientConnectResponse = {
  principal: UserApiKeyPrincipal;
  memoryBanks: MemoryBankSummary[];
  requiresMemoryBank: boolean;
  stats?: {
    memoryBankId: string;
    totalMemories: number;
    memoriesToday: number;
    totalPrompts: number;
  };
};
```

HTTP routes:
- `POST /api/client/connect` with a user API key returns `ClientConnectResponse`. Request body supports `includeStats?: boolean` and `memoryBankId?: string`; stats are omitted by default and may be returned only for the requested Memory Bank.
- `GET /api/admin/api-keys` admin-only list.
- `POST /api/admin/api-keys` admin-only create; response includes generated `value` once.
- `PATCH /api/admin/api-keys/:id` admin-only name/description update.
- `POST /api/admin/api-keys/:id/revoke` admin-only revoke.
- `GET /api/admin/api-keys/:id/memory-banks` admin-only list banks for one API key.
- `POST /api/admin/api-keys/:id/memory-banks` admin-only create bank for one API key.
- `PATCH /api/admin/memory-banks/:id` admin-only bank update.
- `DELETE /api/admin/memory-banks/:id` admin-only bank delete when no memory rows exist.
- `GET /api/memory-banks` user-key route listing banks for the authenticated key.
- `POST /api/memory-banks` user-key route creating a bank for the authenticated key.
- Memory CRUD, context, capture, stats, tags, maintenance, prompts, and profile routes require `X-Memory-Bank-ID: <uuid>` for user-key requests.

---

### Task 1: Server Config Clean Break

**Files:**
- Modify: `src/server-config.ts`
- Modify: `src/config.ts`
- Test: `tests/newuser-api-key-config.test.ts` -> replace with `tests/server-api-key-config.test.ts`
- Test: `tests/profile-keys-config.test.ts` -> delete after replacement coverage exists
- Test: `tests/docs-auth-docker.test.ts`

- [ ] **Step 1: Replace legacy config tests with required SERVER_API_KEY tests**

Create `tests/server-api-key-config.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerConfig } from "../src/server-config.js";
import { validateServerConfig } from "../src/server-config.js";

function runConfigScenario(args: {
  env: Record<string, string | undefined>;
  configFile?: Record<string, unknown>;
}) {
  const home = mkdtempSync(join(tmpdir(), "omnu-server-config-"));
  const configDir = join(home, ".config", "opencode");
  if (args.configFile) {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "opencode-memnet.jsonc"),
      JSON.stringify(args.configFile),
      "utf8"
    );
  }
  const script = `
process.env.HOME = ${JSON.stringify(home)};
process.env.XDG_CONFIG_HOME = "";
process.env.CONFIG_FILE = "";
for (const [key, value] of Object.entries(${JSON.stringify(args.env)})) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
const { initServerConfig } = await import(${JSON.stringify(
    new URL("../src/server-config.js", import.meta.url).href
  )});
const config = initServerConfig();
console.log(JSON.stringify({
  serverApiKey: config.serverApiKey,
  hasNewUserApiKey: Object.prototype.hasOwnProperty.call(config, "newUserApiKey"),
  hasGeneratedFlag: Object.prototype.hasOwnProperty.call(config, "serverApiKeyGenerated"),
  hasProfileKeysFile: Object.prototype.hasOwnProperty.call(config, "profileKeysFile")
}));
`;
  const result = Bun.spawnSync({
    cmd: [process.execPath, "--eval", script],
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    return {
      exitCode: result.exitCode,
      stdout: Buffer.from(result.stdout).toString("utf8").trim(),
      stderr: Buffer.from(result.stderr).toString("utf8").trim(),
    };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    port: 4747,
    host: "0.0.0.0",
    serverApiKey: "admin-secret",
    postgres: {
      url: "postgres://localhost:5432/test",
      ssl: "require",
      maxConnections: 10,
      idleTimeoutSeconds: 30,
      connectTimeoutSeconds: 10,
      vectorType: "vector",
      hnswEfSearch: 128,
      hnswEfConstruction: 256,
    },
    embeddingModel: "text-embedding-3-small",
    embeddingApiUrl: "https://api.example.test/v1",
    embeddingApiKey: "embedding-key",
    embeddingDimensions: 1536,
    embeddingMaxTokens: { content: 2048, tags: 256, query: 512, migration: 2048 },
    embeddingTruncationSide: {
      content: "right",
      tags: "right",
      query: "right",
      migration: "right",
    },
    similarityThreshold: 0.6,
    maxMemories: 10,
    injectProfile: true,
    memoryProvider: "openai-chat",
    memoryModel: "gpt-test",
    memoryApiUrl: "https://api.example.test/v1",
    memoryApiKey: "memory-key",
    memoryTemperature: 0.3,
    autoCaptureMaxIterations: 5,
    autoCaptureIterationTimeout: 30000,
    autoCaptureLanguage: "auto",
    aiSessionRetentionDays: 7,
    userProfileAnalysisInterval: 10,
    userProfileMaxPreferences: 20,
    userProfileMaxPatterns: 15,
    userProfileMaxWorkflows: 10,
    userProfileConfidenceDecayDays: 30,
    userProfileChangelogRetentionCount: 5,
    autoCleanupRetentionDays: 90,
    webServerAllowedOrigin: "*",
    logLevel: "info",
    clientWelcomeBackThreshold: 168,
    ...overrides,
  } as ServerConfig;
}

describe("SERVER_API_KEY v2 server config", () => {
  it("fails validation when SERVER_API_KEY is missing or empty", () => {
    expect(validateServerConfig(makeConfig({ serverApiKey: "" }))).toContain(
      "SERVER_API_KEY is required"
    );
    expect(validateServerConfig(makeConfig({ serverApiKey: "   " }))).toContain(
      "SERVER_API_KEY is required"
    );
  });

  it("uses configured SERVER_API_KEY without generated key metadata", () => {
    const result = runConfigScenario({
      env: {
        SERVER_API_KEY: "configured-admin",
        POSTGRES_URL: "postgres://localhost:5432/test",
        EMBEDDING_API_URL: "https://api.example.test/v1",
        EMBEDDING_MODEL: "text-embedding-3-small",
        EMBEDDING_API_KEY: "embedding-key",
      },
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      serverApiKey: "configured-admin",
      hasNewUserApiKey: false,
      hasGeneratedFlag: false,
      hasProfileKeysFile: false,
    });
  });

  it("uses config-file server.apiKey when env SERVER_API_KEY is absent", () => {
    const result = runConfigScenario({
      env: {
        SERVER_API_KEY: undefined,
        POSTGRES_URL: "postgres://localhost:5432/test",
        EMBEDDING_API_URL: "https://api.example.test/v1",
        EMBEDDING_MODEL: "text-embedding-3-small",
        EMBEDDING_API_KEY: "embedding-key",
      },
      configFile: { server: { apiKey: "config-admin" } },
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).serverApiKey).toBe("config-admin");
  });

  it("uses env SERVER_API_KEY over config-file server.apiKey", () => {
    const result = runConfigScenario({
      env: {
        SERVER_API_KEY: "env-admin",
        POSTGRES_URL: "postgres://localhost:5432/test",
        EMBEDDING_API_URL: "https://api.example.test/v1",
        EMBEDDING_MODEL: "text-embedding-3-small",
        EMBEDDING_API_KEY: "embedding-key",
      },
      configFile: { server: { apiKey: "config-admin" } },
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).serverApiKey).toBe("env-admin");
  });
});
```

This test intentionally clears `CONFIG_FILE`; implementation must not add or depend on that nonexistent override. `src/server-config.ts` should reuse the existing `src/config.ts` config-loading convention, read `server.apiKey` from `~/.config/opencode/opencode-memnet.jsonc` or `.json` under the temporary `HOME`, and pass the resolved value into `initServerConfig()` as the fallback when environment `SERVER_API_KEY` is absent.

- [ ] **Step 2: Run the new config test and confirm it fails**

Run:

```bash
bun test tests/server-api-key-config.test.ts --isolate
```

Expected: FAIL because `ServerConfig` still exposes legacy generated-key/new-user/profile fields and `initServerConfig()` still generates keys.

- [ ] **Step 3: Simplify `ServerConfig` and `initServerConfig()`**

In `src/server-config.ts`, remove:
- `randomBytes`, `chmodSync`, `existsSync`, `readFileSync`, `writeFileSync`
- `NEWUSER_API_KEY_FILE`, `SERVER_API_KEY_FILE`
- `serverApiKeyGenerated`, `serverApiKeyFile`, `newUserApiKey`, `newUserApiKeyGenerated`, `newUserApiKeyFile`
- `disableWebuiAuth`, `disableClientAuth`, `profileKeysFile`, `configuredProfiles`
- `shouldResetGeneratedKeys()`, `resolveFileBackedApiKey()`
- `loadConfiguredProfiles`, `profileKeyMatchesApiKey`, and `profileKeyMatchesServerKey` imports

Use this concrete config shape:

```ts
export interface ServerConfig {
  port: number;
  host: string;
  serverApiKey: string;
  postgres: {
    url: string;
    ssl: boolean | "require";
    maxConnections: number;
    idleTimeoutSeconds: number;
    connectTimeoutSeconds: number;
    vectorType: "vector" | "halfvec";
    hnswEfSearch: number;
    hnswEfConstruction: number;
  };
  embeddingModel: string;
  embeddingApiUrl: string;
  embeddingApiKey: string;
  embeddingDimensions: number;
  embeddingMaxTokens: { content: number; tags: number; query: number; migration: number };
  embeddingTruncationSide: {
    content: "left" | "right";
    tags: "left" | "right";
    query: "left" | "right";
    migration: "left" | "right";
  };
  similarityThreshold: number;
  maxMemories: number;
  injectProfile: boolean;
  memoryProvider: "openai-chat";
  memoryModel?: string;
  memoryApiUrl?: string;
  memoryApiKey?: string;
  memoryTemperature?: number | false;
  memoryExtraParams?: Record<string, unknown>;
  opencodeProvider?: string;
  opencodeModel?: string;
  autoCaptureMaxIterations: number;
  autoCaptureIterationTimeout: number;
  autoCaptureLanguage: string;
  aiSessionRetentionDays: number;
  userProfileAnalysisInterval: number;
  userProfileMaxPreferences: number;
  userProfileMaxPatterns: number;
  userProfileMaxWorkflows: number;
  userProfileConfidenceDecayDays: number;
  userProfileChangelogRetentionCount: number;
  autoCleanupRetentionDays: number;
  webServerAllowedOrigin: string;
  logLevel: "debug" | "info" | "warn" | "error";
  clientWelcomeBackThreshold: number;
  _tagMigrationDisabled?: boolean;
}
```

Inside `initServerConfig()`, resolve the server admin key with this exact precedence:

1. `env.SERVER_API_KEY`, after `resolveSecretValue()` and trim.
2. Config-file `server.apiKey`, after `resolveSecretValue()` and trim.
3. Empty string, which `validateServerConfig()` rejects before server startup.

Set:

```ts
const envServerApiKey = resolveSecretValue(env.SERVER_API_KEY || "")?.trim() ?? "";
const configFileServerApiKey = resolveSecretValue(configFile.server?.apiKey || "")?.trim() ?? "";
const configuredServerApiKey = envServerApiKey || configFileServerApiKey;

_config = {
  port: parseInt(env.SERVER_PORT || "4747"),
  host: env.SERVER_HOST || "0.0.0.0",
  serverApiKey: configuredServerApiKey,
  postgres: {
    url: resolveSecretValue(env.POSTGRES_URL) || "",
    ssl: env.POSTGRES_SSL === "false" ? false : (env.POSTGRES_SSL as "require") || "require",
    maxConnections: parseInt(env.POSTGRES_MAX_CONNECTIONS || "10"),
    idleTimeoutSeconds: parseInt(env.POSTGRES_IDLE_TIMEOUT_SECONDS || "30"),
    connectTimeoutSeconds: parseInt(env.POSTGRES_CONNECT_TIMEOUT_SECONDS || "10"),
    vectorType: (env.POSTGRES_VECTOR_TYPE as "vector" | "halfvec") || "vector",
    hnswEfSearch: parseInt(env.POSTGRES_HNSW_EF_SEARCH || "128"),
    hnswEfConstruction: parseInt(env.POSTGRES_HNSW_EF_CONSTRUCTION || "256"),
  },
  embeddingModel: env.EMBEDDING_MODEL || "",
  embeddingApiUrl: env.EMBEDDING_API_URL || "",
  embeddingApiKey: resolveSecretValue(env.EMBEDDING_API_KEY || "") || env.OPENAI_API_KEY || "",
  embeddingDimensions:
    parseInt(env.EMBEDDING_DIMENSIONS || "0") || getEmbeddingDimensions(env.EMBEDDING_MODEL || ""),
  embeddingMaxTokens: {
    content: parseInt(env.EMBEDDING_MAX_TOKENS_CONTENT || "2048"),
    tags: parseInt(env.EMBEDDING_MAX_TOKENS_TAGS || "256"),
    query: parseInt(env.EMBEDDING_MAX_TOKENS_QUERY || "512"),
    migration: parseInt(env.EMBEDDING_MAX_TOKENS_MIGRATION || "2048"),
  },
  embeddingTruncationSide: {
    content: (env.EMBEDDING_TRUNCATION_CONTENT as "left" | "right") || "right",
    tags: (env.EMBEDDING_TRUNCATION_TAGS as "left" | "right") || "right",
    query: (env.EMBEDDING_TRUNCATION_QUERY as "left" | "right") || "right",
    migration: (env.EMBEDDING_TRUNCATION_MIGRATION as "left" | "right") || "right",
  },
  similarityThreshold: parseFloat(env.SIMILARITY_THRESHOLD || "0.6"),
  maxMemories: parseInt(env.MAX_MEMORIES || "10"),
  injectProfile: env.INJECT_PROFILE !== "false",
  memoryProvider: "openai-chat",
  memoryModel: env.MEMORY_MODEL || undefined,
  memoryApiUrl: env.MEMORY_API_URL || undefined,
  memoryApiKey: resolveSecretValue(env.MEMORY_API_KEY || "") || undefined,
  memoryTemperature:
    env.MEMORY_TEMPERATURE === "false"
      ? false
      : env.MEMORY_TEMPERATURE
        ? parseFloat(env.MEMORY_TEMPERATURE)
        : 0.3,
  memoryExtraParams: undefined,
  opencodeProvider: env.OPENCODE_PROVIDER || undefined,
  opencodeModel: env.OPENCODE_MODEL || undefined,
  autoCaptureMaxIterations: parseInt(env.AUTO_CAPTURE_MAX_ITERATIONS || "5"),
  autoCaptureIterationTimeout: parseInt(env.AUTO_CAPTURE_ITERATION_TIMEOUT || "30000"),
  autoCaptureLanguage: env.AUTO_CAPTURE_LANGUAGE || "auto",
  aiSessionRetentionDays: parseInt(env.AI_SESSION_RETENTION_DAYS || "7"),
  userProfileAnalysisInterval: parseInt(env.USER_PROFILE_ANALYSIS_INTERVAL || "10"),
  userProfileMaxPreferences: parseInt(env.USER_PROFILE_MAX_PREFERENCES || "20"),
  userProfileMaxPatterns: parseInt(env.USER_PROFILE_MAX_PATTERNS || "15"),
  userProfileMaxWorkflows: parseInt(env.USER_PROFILE_MAX_WORKFLOWS || "10"),
  userProfileConfidenceDecayDays: parseInt(env.USER_PROFILE_CONFIDENCE_DECAY_DAYS || "30"),
  userProfileChangelogRetentionCount: parseInt(env.USER_PROFILE_CHANGELOG_RETENTION || "5"),
  autoCleanupRetentionDays: parseInt(env.AUTO_CLEANUP_RETENTION_DAYS || "90"),
  webServerAllowedOrigin: env.WEB_SERVER_ALLOWED_ORIGIN || "*",
  logLevel:
    (env.LOG_LEVEL as "debug" | "info" | "warn" | "error") ||
    (env.DEBUG === "true" || env.DEBUG === "1" ? "debug" : "info"),
  clientWelcomeBackThreshold: parseDurationString(env.CLIENT_WELCOME_BACK_THRESHOLD || "7d"),
};
```

Update `validateServerConfig()` so it only checks `SERVER_API_KEY`, Postgres, embeddings, and LLM migration config:

```ts
if (!config.serverApiKey?.trim()) {
  errors.push("SERVER_API_KEY is required");
}
```

- [ ] **Step 4: Remove old tests and run config coverage**

Run:

```bash
rm tests/newuser-api-key-config.test.ts tests/profile-keys-config.test.ts
bun test tests/server-api-key-config.test.ts tests/docs-auth-docker.test.ts --isolate
```

Expected: `server-api-key-config` PASS. `docs-auth-docker` may FAIL until Task 10 docs are updated.

- [ ] **Step 5: Commit checkpoint**

Run only with commit authorization:

```bash
git add src/server-config.ts src/config.ts tests/server-api-key-config.test.ts tests/docs-auth-docker.test.ts
git rm tests/newuser-api-key-config.test.ts tests/profile-keys-config.test.ts
git commit -m "refactor: require configured server api key"
```

---

### Task 2: V2 Storage Tables And Repositories

**Files:**
- Modify: `src/services/storage/types.ts`
- Modify: `src/services/storage/factory.ts`
- Modify: `src/services/storage/postgres/migrations.ts`
- Create: `src/services/storage/postgres/user-api-key-repository.ts`
- Create: `src/services/storage/postgres/memory-bank-repository.ts`
- Test: `tests/user-api-key-repository-contract.test.ts`
- Test: `tests/memory-bank-repository-contract.test.ts`

- [ ] **Step 1: Add repository contract tests**

Create `tests/user-api-key-repository-contract.test.ts`:

```ts
import { describe, expect, it, mock } from "bun:test";

const executed: { strings: string; values: unknown[] }[] = [];

function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  executed.push({ strings: strings.join("?"), values });
  const query = strings.join("?");
  if (query.includes("RETURNING id")) {
    return Promise.resolve([
      {
        id: values[0],
        name: values[1],
        description: values[2],
        api_key_hash: values[3],
        created_at: new Date("2026-06-26T00:00:00.000Z"),
        updated_at: new Date("2026-06-26T00:00:00.000Z"),
        last_used_at: null,
        revoked_at: null,
      },
    ]);
  }
  if (query.includes("SELECT id, name, description, api_key_hash")) {
    return Promise.resolve([
      {
        id: "key-1",
        name: "opencode",
        description: "OpenCode agent memory access",
        api_key_hash: values[0],
        created_at: new Date("2026-06-26T00:00:00.000Z"),
        updated_at: new Date("2026-06-26T00:00:00.000Z"),
        last_used_at: null,
        revoked_at: null,
      },
    ]);
  }
  return Promise.resolve([]);
}

mock.module("../src/services/storage/postgres/client.js", () => ({
  getPostgresClient: () => sql,
}));

const { PostgresUserApiKeyRepository, hashUserApiKey } = await import(
  "../src/services/storage/postgres/user-api-key-repository.js?contract"
);

describe("PostgresUserApiKeyRepository", () => {
  it("stores only the hashed user API key value", async () => {
    executed.length = 0;
    const repo = new PostgresUserApiKeyRepository();
    const row = await repo.create({
      id: "key-1",
      name: "opencode",
      description: "OpenCode agent memory access",
      apiKeyValue: "omnu_secret-value",
    });

    expect(row.name).toBe("opencode");
    expect(JSON.stringify(executed)).not.toContain("omnu_secret-value");
    expect(executed[0]!.values).toContain(hashUserApiKey("omnu_secret-value"));
  });

  it("finds non-revoked keys by hash", async () => {
    executed.length = 0;
    const repo = new PostgresUserApiKeyRepository();
    const row = await repo.findByApiKey("omnu_secret-value");

    expect(row).toEqual({
      id: "key-1",
      name: "opencode",
      description: "OpenCode agent memory access",
      apiKeyHash: hashUserApiKey("omnu_secret-value"),
      createdAt: new Date("2026-06-26T00:00:00.000Z").getTime(),
      updatedAt: new Date("2026-06-26T00:00:00.000Z").getTime(),
      lastUsedAt: null,
      revokedAt: null,
    });
    expect(executed[0]!.strings).toContain("revoked_at IS NULL");
  });
});
```

Create `tests/memory-bank-repository-contract.test.ts`:

```ts
import { describe, expect, it, mock } from "bun:test";

const executed: { strings: string; values: unknown[] }[] = [];

function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  executed.push({ strings: strings.join("?"), values });
  const query = strings.join("?");
  if (query.includes("RETURNING id")) {
    return Promise.resolve([
      {
        id: values[0],
        api_key_id: values[1],
        name: values[2],
        description: values[3],
        created_at: new Date("2026-06-26T00:00:00.000Z"),
        updated_at: new Date("2026-06-26T00:00:00.000Z"),
      },
    ]);
  }
  if (query.includes("FROM memory_banks")) {
    return Promise.resolve([
      {
        id: "bank-1",
        api_key_id: "key-1",
        api_key_name: "opencode",
        name: "vllm-setup",
        description: "Work done on vllm-setup repo",
        created_at: new Date("2026-06-26T00:00:00.000Z"),
        updated_at: new Date("2026-06-26T00:00:00.000Z"),
      },
    ]);
  }
  return Promise.resolve([]);
}

mock.module("../src/services/storage/postgres/client.js", () => ({
  getPostgresClient: () => sql,
}));

const { PostgresMemoryBankRepository } = await import(
  "../src/services/storage/postgres/memory-bank-repository.js?contract"
);

describe("PostgresMemoryBankRepository", () => {
  it("creates banks under a user API key", async () => {
    executed.length = 0;
    const repo = new PostgresMemoryBankRepository();
    const row = await repo.create({
      id: "bank-1",
      apiKeyId: "key-1",
      name: "vllm-setup",
      description: "Work done on vllm-setup repo",
    });

    expect(row.shortcut).toBe("opencode>vllm-setup");
    expect(executed[0]!.strings).toContain("INSERT INTO memory_banks");
    expect(executed[0]!.values).toEqual([
      "bank-1",
      "key-1",
      "vllm-setup",
      "Work done on vllm-setup repo",
    ]);
  });

  it("lists banks for one API key only", async () => {
    executed.length = 0;
    const repo = new PostgresMemoryBankRepository();
    const rows = await repo.listForApiKey("key-1");

    expect(rows[0]!.apiKeyId).toBe("key-1");
    expect(rows[0]!.shortcut).toBe("opencode>vllm-setup");
    expect(executed[0]!.strings).toContain("WHERE b.api_key_id = ?");
  });
});
```

- [ ] **Step 2: Run repository tests and confirm they fail**

Run:

```bash
bun test tests/user-api-key-repository-contract.test.ts tests/memory-bank-repository-contract.test.ts --isolate
```

Expected: FAIL because the repository files do not exist.

- [ ] **Step 3: Add storage types**

In `src/services/storage/types.ts`, add:

```ts
export interface UserApiKeyRow {
  id: string;
  name: string;
  description: string;
  apiKeyHash: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export interface UserApiKeyRepository {
  initialize(): Promise<void>;
  close(): Promise<void>;
  create(args: {
    id: string;
    name: string;
    description: string;
    apiKeyValue: string;
  }): Promise<UserApiKeyRow>;
  list(): Promise<UserApiKeyRow[]>;
  getById(id: string): Promise<UserApiKeyRow | null>;
  findByApiKey(apiKeyValue: string): Promise<UserApiKeyRow | null>;
  touchLastUsed(id: string): Promise<void>;
  update(args: { id: string; name?: string; description?: string }): Promise<UserApiKeyRow | null>;
  revoke(id: string): Promise<boolean>;
}

export interface MemoryBankRow {
  id: string;
  apiKeyId: string;
  apiKeyName: string;
  name: string;
  description: string;
  shortcut: string;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryBankRepository {
  initialize(): Promise<void>;
  close(): Promise<void>;
  create(args: {
    id: string;
    apiKeyId: string;
    name: string;
    description: string;
  }): Promise<MemoryBankRow>;
  listForApiKey(apiKeyId: string): Promise<MemoryBankRow[]>;
  getForApiKey(args: { apiKeyId: string; memoryBankId: string }): Promise<MemoryBankRow | null>;
  getById(memoryBankId: string): Promise<MemoryBankRow | null>;
  update(args: { id: string; name?: string; description?: string }): Promise<MemoryBankRow | null>;
  countRowsForBank(id: string): Promise<{
    memories: number;
    prompts: number;
    profileLearning: number;
    aiSessions: number;
    aiMessages: number;
  }>;
  delete(id: string): Promise<boolean>;
}

export interface ClientRepository {
  getClientStatsForBank(args: {
    clientId: string;
    apiKeyId: string;
    memoryBankId: string;
  }): Promise<{
    totalMemories: number;
    memoriesToday: number;
    totalPrompts: number;
  }>;
}
```

Also add `apiKeyId?: string` and `memoryBankId?: string` to `MemorySearchOptions`, `MemoryRow`, `SearchResult`, `TagInfo`, `MemoryRecord`, `UserPromptRow`, and prompt repository argument types. Keep `profileId` in types until Task 10 cleanup, but stop using it in new code paths.

- [ ] **Step 4: Add explicit clean-start command and guarded migration 15**

Clean-start policy for this branch:
- v2 has no upgrade path from v1. Existing opencode-memnet data is backed up to a file, removed from the active database by an explicit operator command, and replaced with fresh v2 structures.
- The backup is for manual recovery only. v2 code must not read from it.
- Destructive reset must never be part of normal server startup. Migration 15 is auto-run by startup, so it must only create v2 schema after proving v1 data tables are empty.
- New v2 writes use `api_key_id` and `memory_bank_id` only; they do not write deterministic legacy placeholders.
- Temporary legacy columns, if retained during the transition, are nullable schema-transition residue only. They cannot be used for ownership, lookup, import, or compatibility.
- Memory Bank deletion uses a preflight count and refuses to delete when memory, prompt, profile-learning, AI session, or AI message rows exist.

Create `tests/v2-clean-start-script.test.ts` before implementing the script. It must assert all of these source-level and command-builder requirements:

```ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const script = readFileSync(join(import.meta.dir, "../scripts/v2-clean-start.ts"), "utf8");

describe("v2 clean-start script contract", () => {
  it("creates a timestamped custom-format backup and verifies it", () => {
    expect(script).toContain("backups/opencode-memnet-v1-");
    expect(script).toContain("pg_dump");
    expect(script).toContain("--format=custom");
    expect(script).toContain("pg_restore --list");
  });

  it("removes only the v1 runtime/auth/memory data after backup verification", () => {
    for (const table of [
      "memory_tag_links",
      "memory_tag_aliases",
      "memory_tags",
      "user_profile_changelogs",
      "user_profiles",
      "user_prompts",
      "memories",
      "profile_repo_links",
      "git_repositories",
      "ai_messages",
      "ai_sessions",
      "clients",
      "profile_api_keys",
    ]) {
      expect(script).toContain(table);
    }
    expect(script).toContain("RESTART IDENTITY CASCADE");
  });

  it("does not contain v1 readback or transfer behavior", () => {
    expect(script).not.toMatch(/\bINSERT\s+INTO\s+memories\b/i);
    expect(script).not.toMatch(/\bINSERT\s+INTO\s+user_prompts\b/i);
    expect(script).not.toMatch(/backfill|import.*v1|copy.*v1/i);
  });
});
```

Implement `scripts/v2-clean-start.ts` as a project-local operator script:
- Create `backups/` when missing.
- Generate `backups/opencode-memnet-v1-<utc timestamp>.dump`, where the timestamp is UTC and sortable, for example `20260626T153000Z`.
- For bundled Compose, run `docker compose exec -T db pg_dump -U "${POSTGRES_USER:-opencode}" -d "${POSTGRES_DB:-opencode_mem}" --format=custom --file=-` and write stdout to the backup file.
- For external Postgres, run `pg_dump --format=custom --file <backup-file> "$POSTGRES_URL"`.
- Run `pg_restore --list <backup-file>` and abort if it fails.
- Only after `pg_restore --list` succeeds, execute one transaction that removes v1 opencode-memnet runtime/auth/memory data from exactly these tables when they exist: `memory_tag_links`, `memory_tag_aliases`, `memory_tags`, `user_profile_changelogs`, `user_profiles`, `user_prompts`, `memories`, `profile_repo_links`, `git_repositories`, `ai_messages`, `ai_sessions`, `clients`, and `profile_api_keys`.
- Print the backup path and the tables reset. Do not print secrets, connection strings, or row contents.
- Do not create v2 tables, do not run migrations, and do not run automatically from server startup.

Create `tests/v2-clean-start-migration-guard.test.ts` before changing migrations. It must prove migration 15 aborts before destructive work or schema changes when v1 data exists and the clean-start reset has not run:

```ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrations = readFileSync(
  join(import.meta.dir, "../src/services/storage/postgres/migrations.ts"),
  "utf8"
);

describe("migration 15 clean-start guard", () => {
  it("counts v1 data rows before schema changes and throws when rows remain", () => {
    const v15 = migrations.slice(migrations.indexOf("version: 15"));
    expect(v15).toContain("v1DataRowCount");
    expect(v15).toContain("throw new Error");
    expect(v15.indexOf("v1DataRowCount")).toBeLessThan(v15.indexOf("CREATE TABLE IF NOT EXISTS user_api_keys"));
  });

  it("does not perform the clean-start reset inside the startup migration", () => {
    const v15 = migrations.slice(migrations.indexOf("version: 15"));
    expect(v15).not.toContain("RESTART IDENTITY CASCADE");
    expect(v15).not.toMatch(/\bDROP\s+TABLE\b/i);
  });
});
```

Migration 15 implementation requirements:
- At the start of the migration, query row counts from the v1 data tables listed for `scripts/v2-clean-start.ts`.
- Store the sum in a named variable such as `v1DataRowCount`.
- If `v1DataRowCount > 0`, throw an error before any schema DDL. The error must say the operator must run `scripts/v2-clean-start.ts` first and must include no row contents.
- If all v1 data tables are empty, create the v2 schema and indexes.
- Add `user_api_keys` and `memory_banks` as shown in this task, with UUID primary keys, hashed API-key storage, `UNIQUE (api_key_id, name)` for Memory Banks, and no generated key files.
- Add `api_key_id UUID NOT NULL` and `memory_bank_id UUID NOT NULL` to `memories`, `user_prompts`, retained profile-learning tables such as `user_profiles` and `user_profile_changelogs`, `ai_sessions`, and `ai_messages`.
- Add foreign keys from every v2-owned runtime table to `user_api_keys(id)` and `memory_banks(id)`.
- Relax incompatible legacy `profile_id` and `repo_id` `NOT NULL` constraints only if those columns remain temporarily. These columns must not appear in new insert or ownership predicates.
- Convert tag registry schema to bank-local tags: `memory_tags.memory_bank_id UUID NOT NULL`, unique `(memory_bank_id, canonical_name)`, and `memory_tag_links.memory_bank_id UUID NOT NULL`. Apply the same ownership to tag aliases if aliases are retained.
- Add prompt indexes for queue and learning hot paths:
  - `(memory_bank_id, captured, created_at ASC)`
  - `(memory_bank_id, user_learning_captured, created_at ASC)`
  - `(memory_bank_id, linked_memory_id)`
  - `(memory_bank_id, session_id, created_at DESC)`
- Add AI session indexes:
  - `(memory_bank_id, updated_at DESC)` on `ai_sessions`
  - `(memory_bank_id, session_id, created_at ASC)` on `ai_messages`
- Add memory search/list indexes:
  - `(memory_bank_id, scope, scope_hash, created_at DESC)`
  - `(memory_bank_id, container_tag, created_at DESC)`
  - `(memory_bank_id, created_at DESC)`

Create `tests/v2-ownership-not-null.test.ts` before changing repositories. It must assert the migration contains `NOT NULL` ownership for `memories`, `user_prompts`, retained profile-learning rows, `ai_sessions`, and `ai_messages`, and it must include a SQL contract case showing unscoped inserts fail after clean start:

```ts
expect(insertMemoryWithoutBank()).rejects.toThrow(/api_key_id|memory_bank_id|not null/i);
expect(insertPromptWithoutBank()).rejects.toThrow(/api_key_id|memory_bank_id|not null/i);
expect(insertAiSessionWithoutBank()).rejects.toThrow(/api_key_id|memory_bank_id|not null/i);
```

Add migration or source contract assertions that prove:
- migration 15 aborts before schema changes if v1 rows remain;
- `scripts/v2-clean-start.ts` is the only path that removes v1 runtime/auth/memory data;
- Task 10 docs contain both backup commands and `pg_restore --list` verification;
- new v2 memory, prompt, profile-learning, tag, and AI session insert SQL includes real `api_key_id` and `memory_bank_id`;
- no code path reads v1 rows into v2 runtime APIs;
- deleting a Memory Bank with existing memory, prompt, profile-learning, AI session, or AI message rows returns a refusal error and does not execute `DELETE FROM memory_banks`.

Add vector-search acceptance criteria to the migration/repository tests:
- bank-filtered pgvector search includes `WHERE memory_bank_id = $bank` before returning results;
- benchmark or integration fixture covers multiple small banks and one larger bank;
- test captures `EXPLAIN` or logged query plan text and verifies the bank filter is present;
- tune and document `hnsw.ef_search` for recall when global HNSW indexes are filtered by Memory Bank, including the accepted candidate limit and latency budget.

- [ ] **Step 5: Implement user API key repository**

Create `src/services/storage/postgres/user-api-key-repository.ts`:

```ts
import crypto from "node:crypto";
import type { UserApiKeyRepository, UserApiKeyRow } from "../types.js";
import type { SqlClient } from "./client.js";
import { getPostgresClient } from "./client.js";
import { logDebug } from "../../logger.js";

export function hashUserApiKey(apiKey: string): string {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

function toMillis(value: unknown): number | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
  return Number.isFinite(time) ? time : null;
}

function rowToUserApiKey(row: any): UserApiKeyRow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    apiKeyHash: row.api_key_hash,
    createdAt: toMillis(row.created_at) ?? Date.now(),
    updatedAt: toMillis(row.updated_at) ?? Date.now(),
    lastUsedAt: toMillis(row.last_used_at),
    revokedAt: toMillis(row.revoked_at),
  };
}

export class PostgresUserApiKeyRepository implements UserApiKeyRepository {
  private sql(): SqlClient {
    return getPostgresClient();
  }

  async initialize(): Promise<void> {
    logDebug("[user-api-key-repository] initialized");
  }

  async close(): Promise<void> {
    // Connection pool is shared.
  }

  async create(args: {
    id: string;
    name: string;
    description: string;
    apiKeyValue: string;
  }): Promise<UserApiKeyRow> {
    const rows = await this.sql()`
      INSERT INTO user_api_keys (id, name, description, api_key_hash)
      VALUES (${args.id}, ${args.name}, ${args.description}, ${hashUserApiKey(args.apiKeyValue)})
      RETURNING id, name, description, api_key_hash, created_at, updated_at, last_used_at, revoked_at
    `;
    return rowToUserApiKey(rows[0]);
  }

  async list(): Promise<UserApiKeyRow[]> {
    const rows = await this.sql()`
      SELECT id, name, description, api_key_hash, created_at, updated_at, last_used_at, revoked_at
      FROM user_api_keys
      ORDER BY created_at DESC
    `;
    return rows.map(rowToUserApiKey);
  }

  async getById(id: string): Promise<UserApiKeyRow | null> {
    const rows = await this.sql()`
      SELECT id, name, description, api_key_hash, created_at, updated_at, last_used_at, revoked_at
      FROM user_api_keys
      WHERE id = ${id}
      LIMIT 1
    `;
    return rows[0] ? rowToUserApiKey(rows[0]) : null;
  }

  async findByApiKey(apiKeyValue: string): Promise<UserApiKeyRow | null> {
    const hash = hashUserApiKey(apiKeyValue);
    const rows = await this.sql()`
      SELECT id, name, description, api_key_hash, created_at, updated_at, last_used_at, revoked_at
      FROM user_api_keys
      WHERE api_key_hash = ${hash} AND revoked_at IS NULL
      LIMIT 1
    `;
    return rows[0] ? rowToUserApiKey(rows[0]) : null;
  }

  async touchLastUsed(id: string): Promise<void> {
    try {
      await this.sql()`
        UPDATE user_api_keys
        SET last_used_at = now()
        WHERE id = ${id}
          AND (last_used_at IS NULL OR last_used_at < now() - interval '5 minutes')
      `;
    } catch (error) {
      logDebug("[user-api-key-repository] failed to touch last_used_at", { id, error: String(error) });
    }
  }

  async update(args: {
    id: string;
    name?: string;
    description?: string;
  }): Promise<UserApiKeyRow | null> {
    const existing = await this.getById(args.id);
    if (!existing) return null;
    const rows = await this.sql()`
      UPDATE user_api_keys
      SET name = ${args.name ?? existing.name},
          description = ${args.description ?? existing.description},
          updated_at = now()
      WHERE id = ${args.id}
      RETURNING id, name, description, api_key_hash, created_at, updated_at, last_used_at, revoked_at
    `;
    return rows[0] ? rowToUserApiKey(rows[0]) : null;
  }

  async revoke(id: string): Promise<boolean> {
    const rows = await this.sql()`
      UPDATE user_api_keys
      SET revoked_at = COALESCE(revoked_at, now()), updated_at = now()
      WHERE id = ${id}
      RETURNING id
    `;
    return rows.length > 0;
  }
}
```

- [ ] **Step 6: Implement Memory Bank repository**

Create `src/services/storage/postgres/memory-bank-repository.ts`:

```ts
import type { MemoryBankRepository, MemoryBankRow } from "../types.js";
import type { SqlClient } from "./client.js";
import { getPostgresClient } from "./client.js";
import { logDebug } from "../../logger.js";

function toMillis(value: unknown): number {
  const time = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
  return Number.isFinite(time) ? time : Date.now();
}

function rowToMemoryBank(row: any): MemoryBankRow {
  const apiKeyName = row.api_key_name ?? row.apiKeyName ?? "";
  return {
    id: row.id,
    apiKeyId: row.api_key_id,
    apiKeyName,
    name: row.name,
    description: row.description,
    shortcut: `${apiKeyName}>${row.name}`,
    createdAt: toMillis(row.created_at),
    updatedAt: toMillis(row.updated_at),
  };
}

export class PostgresMemoryBankRepository implements MemoryBankRepository {
  private sql(): SqlClient {
    return getPostgresClient();
  }

  async initialize(): Promise<void> {
    logDebug("[memory-bank-repository] initialized");
  }

  async close(): Promise<void> {
    // Connection pool is shared.
  }

  async create(args: {
    id: string;
    apiKeyId: string;
    name: string;
    description: string;
  }): Promise<MemoryBankRow> {
    const rows = await this.sql()`
      INSERT INTO memory_banks (id, api_key_id, name, description)
      VALUES (${args.id}, ${args.apiKeyId}, ${args.name}, ${args.description})
      RETURNING id, api_key_id, name, description, created_at, updated_at
    `;
    const apiKeyRows = await this.sql()`SELECT name FROM user_api_keys WHERE id = ${args.apiKeyId}`;
    return rowToMemoryBank({ ...rows[0], api_key_name: apiKeyRows[0]?.name ?? "" });
  }

  async listForApiKey(apiKeyId: string): Promise<MemoryBankRow[]> {
    const rows = await this.sql()`
      SELECT b.id, b.api_key_id, k.name AS api_key_name, b.name, b.description, b.created_at, b.updated_at
      FROM memory_banks b
      JOIN user_api_keys k ON k.id = b.api_key_id
      WHERE b.api_key_id = ${apiKeyId}
      ORDER BY b.name ASC
    `;
    return rows.map(rowToMemoryBank);
  }

  async getForApiKey(args: {
    apiKeyId: string;
    memoryBankId: string;
  }): Promise<MemoryBankRow | null> {
    const rows = await this.sql()`
      SELECT b.id, b.api_key_id, k.name AS api_key_name, b.name, b.description, b.created_at, b.updated_at
      FROM memory_banks b
      JOIN user_api_keys k ON k.id = b.api_key_id
      WHERE b.api_key_id = ${args.apiKeyId} AND b.id = ${args.memoryBankId}
      LIMIT 1
    `;
    return rows[0] ? rowToMemoryBank(rows[0]) : null;
  }

  async getById(memoryBankId: string): Promise<MemoryBankRow | null> {
    const rows = await this.sql()`
      SELECT b.id, b.api_key_id, k.name AS api_key_name, b.name, b.description, b.created_at, b.updated_at
      FROM memory_banks b
      JOIN user_api_keys k ON k.id = b.api_key_id
      WHERE b.id = ${memoryBankId}
      LIMIT 1
    `;
    return rows[0] ? rowToMemoryBank(rows[0]) : null;
  }

  async update(args: {
    id: string;
    name?: string;
    description?: string;
  }): Promise<MemoryBankRow | null> {
    const existing = await this.getById(args.id);
    if (!existing) return null;
    const rows = await this.sql()`
      UPDATE memory_banks
      SET name = ${args.name ?? existing.name},
          description = ${args.description ?? existing.description},
          updated_at = now()
      WHERE id = ${args.id}
      RETURNING id, api_key_id, name, description, created_at, updated_at
    `;
    return rows[0] ? rowToMemoryBank({ ...rows[0], api_key_name: existing.apiKeyName }) : null;
  }

  async countRowsForBank(id: string): Promise<{
    memories: number;
    prompts: number;
    profileLearning: number;
    aiSessions: number;
    aiMessages: number;
  }> {
    const memoryRows = await this.sql()`SELECT COUNT(*)::int AS count FROM memories WHERE memory_bank_id = ${id}`;
    const promptRows = await this.sql()`SELECT COUNT(*)::int AS count FROM user_prompts WHERE memory_bank_id = ${id}`;
    const profileRows = await this.sql()`SELECT COUNT(*)::int AS count FROM user_profiles WHERE memory_bank_id = ${id}`;
    const aiSessionRows = await this.sql()`SELECT COUNT(*)::int AS count FROM ai_sessions WHERE memory_bank_id = ${id}`;
    const aiMessageRows = await this.sql()`SELECT COUNT(*)::int AS count FROM ai_messages WHERE memory_bank_id = ${id}`;
    return {
      memories: Number(memoryRows[0]?.count ?? 0),
      prompts: Number(promptRows[0]?.count ?? 0),
      profileLearning: Number(profileRows[0]?.count ?? 0),
      aiSessions: Number(aiSessionRows[0]?.count ?? 0),
      aiMessages: Number(aiMessageRows[0]?.count ?? 0),
    };
  }

  async delete(id: string): Promise<boolean> {
    const counts = await this.countRowsForBank(id);
    if (Object.values(counts).some((count) => count > 0)) {
      throw new Error("Memory Bank is not empty and cannot be deleted");
    }
    const rows = await this.sql()`DELETE FROM memory_banks WHERE id = ${id} RETURNING id`;
    return rows.length > 0;
  }
}
```

- [ ] **Step 7: Wire factory**

In `src/services/storage/factory.ts`:
- Import `UserApiKeyRepository` and `MemoryBankRepository` types.
- Add singleton variables `userApiKeyRepo` and `memoryBankRepo`.
- Add lazy proxy classes mirroring `PostgresProfileApiKeyRepositoryLazy`.
- Add:

```ts
export function createUserApiKeyRepository(): UserApiKeyRepository {
  if (userApiKeyRepo) return userApiKeyRepo;
  userApiKeyRepo = new PostgresUserApiKeyRepositoryLazy();
  return userApiKeyRepo;
}

export function createMemoryBankRepository(): MemoryBankRepository {
  if (memoryBankRepo) return memoryBankRepo;
  memoryBankRepo = new PostgresMemoryBankRepositoryLazy();
  return memoryBankRepo;
}
```

Update `initializeStorage()` to initialize both repositories.

- [ ] **Step 8: Run storage tests**

Run:

```bash
bun test tests/user-api-key-repository-contract.test.ts tests/memory-bank-repository-contract.test.ts --isolate
bun run typecheck
```

Expected: PASS for both tests and typecheck.

- [ ] **Step 9: Commit checkpoint**

Run only with commit authorization:

```bash
git add src/services/storage/types.ts src/services/storage/factory.ts src/services/storage/postgres/migrations.ts src/services/storage/postgres/user-api-key-repository.ts src/services/storage/postgres/memory-bank-repository.ts tests/user-api-key-repository-contract.test.ts tests/memory-bank-repository-contract.test.ts
git commit -m "feat: add v2 auth storage repositories"
```

---

### Task 3: Central AuthService And Middleware

**Files:**
- Create: `src/services/auth-service.ts`
- Modify: `src/services/auth.ts`
- Modify: `src/services/web-server.ts`
- Modify: `src/server.ts`
- Test: `tests/auth-service.test.ts`
- Test: `tests/v2-auth-middleware.test.ts`
- Delete after conversion: `tests/profile-auth.test.ts`, `tests/auth-middleware-profile-key.test.ts`, `tests/newuser-api-key-auth.test.ts`

- [ ] **Step 1: Add AuthService unit tests**

Create `tests/auth-service.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { AuthService, generateUserApiKeyValue, timingSafeEqualString } from "../src/services/auth-service.js";

function makeRepos() {
  const userKeys = new Map<string, any>();
  const banks = new Map<string, any>();
  return {
    userApiKeyRepo: {
      initialize: async () => {},
      close: async () => {},
      create: async (args: any) => {
        const row = {
          id: args.id,
          name: args.name,
          description: args.description,
          apiKeyHash: "hash",
          createdAt: 1,
          updatedAt: 1,
          lastUsedAt: null,
          revokedAt: null,
          apiKeyValue: args.apiKeyValue,
        };
        userKeys.set(args.apiKeyValue, row);
        return row;
      },
      list: async () => Array.from(userKeys.values()),
      getById: async (id: string) => Array.from(userKeys.values()).find((row) => row.id === id) ?? null,
      findByApiKey: async (value: string) => userKeys.get(value) ?? null,
      touchLastUsed: async () => {},
      update: async () => null,
      revoke: async () => false,
    },
    memoryBankRepo: {
      initialize: async () => {},
      close: async () => {},
      create: async (args: any) => {
        const row = {
          id: args.id,
          apiKeyId: args.apiKeyId,
          apiKeyName: "opencode",
          name: args.name,
          description: args.description,
          shortcut: `opencode>${args.name}`,
          createdAt: 1,
          updatedAt: 1,
        };
        banks.set(row.id, row);
        return row;
      },
      listForApiKey: async (apiKeyId: string) =>
        Array.from(banks.values()).filter((bank) => bank.apiKeyId === apiKeyId),
      getForApiKey: async (args: any) => {
        const bank = banks.get(args.memoryBankId);
        return bank?.apiKeyId === args.apiKeyId ? bank : null;
      },
      getById: async (id: string) => banks.get(id) ?? null,
      update: async () => null,
      delete: async () => false,
    },
  };
}

describe("AuthService", () => {
  it("generates prefixed user API keys", () => {
    const value = generateUserApiKeyValue();
    expect(value.startsWith("omnu_")).toBe(true);
    expect(value.length).toBeGreaterThan(40);
  });

  it("compares strings through digest equality", () => {
    expect(timingSafeEqualString("same", "same")).toBe(true);
    expect(timingSafeEqualString("same", "different")).toBe(false);
  });

  it("authenticates SERVER_API_KEY as admin", async () => {
    const repos = makeRepos();
    const service = new AuthService({ serverApiKey: "admin-secret", ...repos });
    await expect(service.authenticateBearer("admin-secret")).resolves.toEqual({ kind: "admin" });
  });

  it("creates user API keys and returns the value once", async () => {
    const repos = makeRepos();
    const service = new AuthService({ serverApiKey: "admin-secret", ...repos });
    const created = await service.createUserApiKey({
      name: "opencode",
      description: "OpenCode agent memory access",
    });

    expect(created.value.startsWith("omnu_")).toBe(true);
    expect(created.apiKey.name).toBe("opencode");
    await expect(service.authenticateBearer(created.value)).resolves.toEqual({
      kind: "user-api-key",
      apiKeyId: created.apiKey.id,
      apiKeyName: "opencode",
      apiKeyDescription: "OpenCode agent memory access",
    });
  });

  it("rejects empty names and descriptions", async () => {
    const repos = makeRepos();
    const service = new AuthService({ serverApiKey: "admin-secret", ...repos });

    await expect(service.createUserApiKey({ name: "", description: "desc" })).rejects.toThrow(
      "API key name is required"
    );
    await expect(service.createUserApiKey({ name: "opencode", description: "" })).rejects.toThrow(
      "API key description is required"
    );
  });
});
```

- [ ] **Step 2: Add v2 middleware tests**

Create `tests/v2-auth-middleware.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { AuthMiddleware } from "../src/services/auth.js";

function requestWithBearer(key?: string): Request {
  const headers = new Headers();
  if (key !== undefined) headers.set("Authorization", `Bearer ${key}`);
  return new Request("http://localhost/api/memories", { headers });
}

describe("v2 AuthMiddleware", () => {
  it("authenticates SERVER_API_KEY as admin", async () => {
    const auth = new AuthMiddleware({
      authenticateBearer: async (key: string) => (key === "admin-secret" ? { kind: "admin" } : null),
    } as any);

    const result = await auth.authenticate(requestWithBearer("admin-secret"));

    expect(result instanceof Response).toBe(false);
    expect(result).toEqual({ principal: { kind: "admin" } });
  });

  it("authenticates user API keys as user principals", async () => {
    const auth = new AuthMiddleware({
      authenticateBearer: async (key: string) =>
        key === "user-secret"
          ? {
              kind: "user-api-key",
              apiKeyId: "key-1",
              apiKeyName: "opencode",
              apiKeyDescription: "OpenCode agent memory access",
            }
          : null,
    } as any);

    const result = await auth.authenticate(requestWithBearer("user-secret"));

    expect(result instanceof Response).toBe(false);
    expect(result).toEqual({
      principal: {
        kind: "user-api-key",
        apiKeyId: "key-1",
        apiKeyName: "opencode",
        apiKeyDescription: "OpenCode agent memory access",
      },
    });
  });

  it("rejects missing and invalid bearer tokens", async () => {
    const auth = new AuthMiddleware({ authenticateBearer: async () => null } as any);

    const missing = await auth.authenticate(requestWithBearer(undefined));
    expect(missing).toBeInstanceOf(Response);
    expect((missing as Response).status).toBe(401);

    const invalid = await auth.authenticate(requestWithBearer("wrong"));
    expect(invalid).toBeInstanceOf(Response);
    expect((invalid as Response).status).toBe(401);
  });
});
```

- [ ] **Step 3: Run auth tests and confirm failure**

Run:

```bash
bun test tests/auth-service.test.ts tests/v2-auth-middleware.test.ts --isolate
```

Expected: FAIL because `auth-service.ts` does not exist and `AuthMiddleware` still has the old constructor.

- [ ] **Step 4: Implement `AuthService`**

Create `src/services/auth-service.ts`:

```ts
import crypto, { randomBytes, randomUUID } from "node:crypto";
import type {
  MemoryBankRepository,
  MemoryBankRow,
  UserApiKeyRepository,
  UserApiKeyRow,
} from "./storage/types.js";

export type AdminPrincipal = { kind: "admin" };

export type UserApiKeyPrincipal = {
  kind: "user-api-key";
  apiKeyId: string;
  apiKeyName: string;
  apiKeyDescription: string;
};

export type Principal = AdminPrincipal | UserApiKeyPrincipal;

export type CreatedUserApiKey = {
  apiKey: Omit<UserApiKeyRow, "apiKeyHash">;
  value: string;
};

export function timingSafeEqualString(actual: string, expected: string): boolean {
  const actualDigest = crypto.createHash("sha256").update(actual).digest();
  const expectedDigest = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(actualDigest, expectedDigest);
}

export function generateUserApiKeyValue(): string {
  return `omnu_${randomBytes(32).toString("base64url")}`;
}

function requireNonEmpty(value: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(message);
  return trimmed;
}

function publicApiKey(row: UserApiKeyRow): Omit<UserApiKeyRow, "apiKeyHash"> {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
  };
}

export class AuthService {
  private readonly serverApiKey: string;
  private readonly userApiKeyRepo: UserApiKeyRepository;
  private readonly memoryBankRepo: MemoryBankRepository;

  constructor(args: {
    serverApiKey: string;
    userApiKeyRepo: UserApiKeyRepository;
    memoryBankRepo: MemoryBankRepository;
  }) {
    this.serverApiKey = requireNonEmpty(args.serverApiKey, "SERVER_API_KEY is required");
    this.userApiKeyRepo = args.userApiKeyRepo;
    this.memoryBankRepo = args.memoryBankRepo;
  }

  async authenticateBearer(key: string): Promise<Principal | null> {
    if (timingSafeEqualString(key, this.serverApiKey)) return { kind: "admin" };
    const row = await this.userApiKeyRepo.findByApiKey(key);
    if (!row) return null;
    await this.userApiKeyRepo.touchLastUsed(row.id);
    return {
      kind: "user-api-key",
      apiKeyId: row.id,
      apiKeyName: row.name,
      apiKeyDescription: row.description,
    };
  }

  async createUserApiKey(args: { name: string; description: string }): Promise<CreatedUserApiKey> {
    const name = requireNonEmpty(args.name, "API key name is required");
    const description = requireNonEmpty(args.description, "API key description is required");
    const value = generateUserApiKeyValue();
    const row = await this.userApiKeyRepo.create({
      id: randomUUID(),
      name,
      description,
      apiKeyValue: value,
    });
    return { apiKey: publicApiKey(row), value };
  }

  async listUserApiKeys(): Promise<Omit<UserApiKeyRow, "apiKeyHash">[]> {
    return (await this.userApiKeyRepo.list()).map(publicApiKey);
  }

  async listMemoryBanks(principal: UserApiKeyPrincipal): Promise<MemoryBankRow[]> {
    return this.memoryBankRepo.listForApiKey(principal.apiKeyId);
  }

  async requireBankForPrincipal(
    principal: Principal,
    memoryBankId: string | undefined
  ): Promise<MemoryBankRow> {
    const id = requireNonEmpty(memoryBankId ?? "", "X-Memory-Bank-ID is required");
    if (principal.kind === "admin") {
      const bank = await this.memoryBankRepo.getById(id);
      if (!bank) throw new Error("Memory Bank not found");
      return bank;
    }
    const bank = await this.memoryBankRepo.getForApiKey({
      apiKeyId: principal.apiKeyId,
      memoryBankId: id,
    });
    if (!bank) throw new Error("Memory Bank not found for API key");
    return bank;
  }
}
```

- [ ] **Step 5: Replace `AuthMiddleware`**

Replace `src/services/auth.ts` with:

```ts
import type { AuthService, Principal } from "./auth-service.js";

export interface AuthResult {
  principal: Principal;
}

export class AuthMiddleware {
  private readonly authService: Pick<AuthService, "authenticateBearer">;

  constructor(authService: Pick<AuthService, "authenticateBearer">) {
    this.authService = authService;
  }

  async authenticate(req: Request): Promise<AuthResult | Response> {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return this.unauthorized("Missing Authorization header");

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer" || !parts[1]) {
      return this.unauthorized("Invalid Authorization format. Use: Bearer <key>");
    }

    const principal = await this.authService.authenticateBearer(parts[1]);
    if (!principal) return this.unauthorized("Invalid API key");
    return { principal };
  }

  private unauthorized(message: string): Response {
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
}
```

- [ ] **Step 6: Inject `AuthService` into server startup**

This step must clean up every old call site in the same change:
- remove the `RouteKind` type, imports, and route-kind branching from `src/services/auth.ts` and `src/services/web-server.ts`;
- replace every `authenticate(req, routeKind)` call with `await authenticate(req)`;
- update `startWebServer()` to accept `(config, authService)` and remove `apiKey`, `profileKeys`, `newUserApiKey`, `disableWebuiAuth`, and generated-key constructor arguments;
- update `WebServer` tests that instantiate the constructor so they pass an `AuthService`-compatible object;
- remove generated profile fallback lookup from `authenticateApiRequest()`;
- remove `profileKeyMatchesApiKey`, `profileKeyMatchesServerKey`, and `ProfileAuthService` imports after replacement.

In `src/server.ts`, create repositories and service before `startWebServer()`:

```ts
const { createUserApiKeyRepository, createMemoryBankRepository } = await import(
  "./services/storage/factory.js"
);
const { AuthService } = await import("./services/auth-service.js");
const authService = new AuthService({
  serverApiKey: config.serverApiKey,
  userApiKeyRepo: createUserApiKeyRepository(),
  memoryBankRepo: createMemoryBankRepository(),
});
```

Then call `startWebServer(..., authService)` instead of passing `config.serverApiKey` and legacy profile options.

In `src/services/web-server.ts`, export:

```ts
export async function startWebServer(config: WebServerConfig, authService: AuthService) {
  const server = new WebServer(config, authService);
  return server.start();
}
```

In `src/services/web-server.ts`, constructor shape becomes:

```ts
constructor(config: WebServerConfig, authService: AuthService) {
  this.config = config;
  this.allowedOrigin = config.allowedOrigin ?? "*";
  this.auth = new AuthMiddleware(authService);
  this.authService = authService;
}
```

Add a private field:

```ts
private readonly authService: AuthService;
```

Remove generated profile key fallback lookup from `authenticateApiRequest()`.

- [ ] **Step 7: Remove old auth tests and run new auth coverage**

Run:

```bash
rm tests/profile-auth.test.ts tests/auth-middleware-profile-key.test.ts tests/newuser-api-key-auth.test.ts
bun test tests/auth-service.test.ts tests/v2-auth-middleware.test.ts --isolate
bun run typecheck
```

Expected: PASS for new auth tests and typecheck.

- [ ] **Step 8: Commit checkpoint**

Run only with commit authorization:

```bash
git add src/services/auth-service.ts src/services/auth.ts src/services/web-server.ts src/server.ts tests/auth-service.test.ts tests/v2-auth-middleware.test.ts
git rm tests/profile-auth.test.ts tests/auth-middleware-profile-key.test.ts tests/newuser-api-key-auth.test.ts
git commit -m "feat: centralize v2 auth service"
```

---

### Task 4: Admin API And Client Connect Contract

**Files:**
- Modify: `src/services/api-handlers.ts`
- Modify: `src/services/web-server.ts`
- Test: `tests/v2-admin-api.test.ts`
- Test: `tests/newuser-client-connect.test.ts` -> replace with `tests/client-connect-memory-banks.test.ts`

- [ ] **Step 1: Add failing admin API and connect tests**

Create `tests/client-connect-memory-banks.test.ts`:

```ts
import { describe, expect, it, mock } from "bun:test";

mock.module("../src/services/storage/factory.js", () => ({
  createMemoryRepository: () => ({ initialize: async () => {} }),
  createUserPromptRepository: () => ({ initialize: async () => {} }),
  createUserProfileRepository: () => ({ initialize: async () => {} }),
  createClientRepository: () => ({
    initialize: async () => {},
    upsertClient: async () => ({ firstTime: true, previousLastSeen: null, row: { id: "client-1" } }),
    getClientStatsForBank: async (args: any) => {
      if (args.apiKeyId !== "key-1" || args.memoryBankId !== "bank-1") {
        throw new Error("Memory Bank not found for API key");
      }
      return { totalMemories: 0, memoriesToday: 0, totalPrompts: 0 };
    },
  }),
  createUserApiKeyRepository: () => ({ initialize: async () => {} }),
  createMemoryBankRepository: () => ({
    initialize: async () => {},
    listForApiKey: async () => [],
  }),
  createTagRegistry: () => ({}),
}));

const { handleClientConnect } = await import("../src/services/api-handlers.js?client-connect-v2");

const authService = {
  requireBankForPrincipal: async (principal: any, memoryBankId: string) => {
    if (principal.apiKeyId !== "key-1" || memoryBankId !== "bank-1") {
      throw new Error("Memory Bank not found for API key");
    }
    return { id: "bank-1", apiKeyId: "key-1" };
  },
};

describe("v2 client connect", () => {
  it("returns API key identity and empty Memory Bank list without enrollment", async () => {
    const result = await handleClientConnect(
      { clientId: "client-1", metadata: { projectName: "vllm-setup" } },
      {
        kind: "user-api-key",
        apiKeyId: "key-1",
        apiKeyName: "opencode",
        apiKeyDescription: "OpenCode agent memory access",
      },
      authService as any
    );

    expect(result.success).toBe(true);
    expect(result.data?.principal).toEqual({
      kind: "user-api-key",
      apiKeyId: "key-1",
      apiKeyName: "opencode",
      apiKeyDescription: "OpenCode agent memory access",
    });
    expect(result.data?.memoryBanks).toEqual([]);
    expect(result.data?.requiresMemoryBank).toBe(true);
    expect(result.data?.stats).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("enrollment");
    expect(JSON.stringify(result)).not.toContain("profileId");
    expect(JSON.stringify(result)).not.toContain("firstTime");
    expect(JSON.stringify(result)).not.toContain("welcomeBack");
  });

  it("authorizes requested stats Memory Bank before reading scoped stats", async () => {
    const result = await handleClientConnect(
      {
        clientId: "client-1",
        includeStats: true,
        memoryBankId: "other-key-bank",
      },
      {
        kind: "user-api-key",
        apiKeyId: "key-1",
        apiKeyName: "opencode",
        apiKeyDescription: "OpenCode agent memory access",
      },
      authService as any
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Memory Bank");
  });
});
```

Create `tests/v2-admin-api.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { WebServer } from "../src/services/web-server.js";

function makeAuthService() {
  const keys: any[] = [];
  const banks: any[] = [];
  return {
    authenticateBearer: async (key: string) =>
      key === "admin"
        ? { kind: "admin" }
        : key === "user"
          ? {
              kind: "user-api-key",
              apiKeyId: "key-1",
              apiKeyName: "opencode",
              apiKeyDescription: "OpenCode agent memory access",
            }
          : null,
    createUserApiKey: async (args: any) => {
      const apiKey = {
        id: "key-1",
        name: args.name,
        description: args.description,
        createdAt: 1,
        updatedAt: 1,
        lastUsedAt: null,
        revokedAt: null,
      };
      keys.push(apiKey);
      return { apiKey, value: "omnu_created-secret" };
    },
    listUserApiKeys: async () => keys,
    listMemoryBanks: async () => banks,
  };
}

describe("v2 admin routes", () => {
  it("creates user API keys with admin auth and reveals value once", async () => {
    const server = new WebServer(
      { port: 0, host: "127.0.0.1", enabled: false },
      makeAuthService() as any
    ) as any;

    const response = await server._handleRequest(
      new Request("http://localhost/api/admin/api-keys", {
        method: "POST",
        headers: { Authorization: "Bearer admin" },
        body: JSON.stringify({
          name: "opencode",
          description: "OpenCode agent memory access",
        }),
      })
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.data.value).toBe("omnu_created-secret");
    expect(json.data.apiKey.name).toBe("opencode");
  });

  it("forbids admin routes for user API keys", async () => {
    const server = new WebServer(
      { port: 0, host: "127.0.0.1", enabled: false },
      makeAuthService() as any
    ) as any;

    const response = await server._handleRequest(
      new Request("http://localhost/api/admin/api-keys", {
        method: "GET",
        headers: { Authorization: "Bearer user" },
      })
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Admin key required",
    });
  });
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
bun test tests/client-connect-memory-banks.test.ts tests/v2-admin-api.test.ts --isolate
```

Expected: FAIL because handlers/routes do not expose v2 data.

- [ ] **Step 3: Add handler helpers in `api-handlers.ts`**

Add imports:

```ts
import type { AuthService, Principal, UserApiKeyPrincipal } from "./auth-service.js";
import type { MemoryBankRow } from "./storage/types.js";
import { createMemoryBankRepository, createUserApiKeyRepository } from "./storage/factory.js";
```

Add repository singletons:

```ts
let userApiKeyRepo: UserApiKeyRepository | null = null;
let memoryBankRepo: MemoryBankRepository | null = null;
```

Initialize them inside `ensureInit()`.

Add response mapper:

```ts
function formatMemoryBank(bank: MemoryBankRow) {
  return {
    id: bank.id,
    apiKeyId: bank.apiKeyId,
    name: bank.name,
    description: bank.description,
    shortcut: bank.shortcut,
    createdAt: safeToISOString(bank.createdAt),
    updatedAt: safeToISOString(bank.updatedAt),
  };
}
```

Replace `handleClientConnect()` behavior with:

```ts
export async function handleClientConnect(
  body: {
    clientId?: string;
    metadata?: Record<string, unknown>;
    includeStats?: boolean;
    memoryBankId?: string;
  },
  principal: Principal,
  authService: AuthService
): Promise<ApiResponse<any>> {
  try {
    await ensureInit();
    if (principal.kind === "admin") {
      return { success: false, error: "User API key required for client connect" };
    }
    if (!body.clientId) return { success: false, error: "clientId is required" };

    await clientRepo!.upsertClient(body.clientId, body.metadata ?? {});
    const banks = await memoryBankRepo!.listForApiKey(principal.apiKeyId);
    let stats:
      | { totalMemories: number; memoriesToday: number; totalPrompts: number }
      | undefined;
    if (body.includeStats && body.memoryBankId) {
      let requestedBank: MemoryBankRow;
      try {
        requestedBank = await authService.requireBankForPrincipal(principal, body.memoryBankId);
      } catch {
        return { success: false, error: "Memory Bank not found for API key" };
      }
      stats = await clientRepo!.getClientStatsForBank({
        clientId: body.clientId,
        apiKeyId: requestedBank.apiKeyId,
        memoryBankId: requestedBank.id,
      });
    }

    return {
      success: true,
      data: {
        principal,
        memoryBanks: banks.map(formatMemoryBank),
        requiresMemoryBank: banks.length === 0,
        ...(stats
          ? {
              stats: {
                memoryBankId: body.memoryBankId,
                totalMemories: stats.totalMemories,
                memoriesToday: stats.memoriesToday,
                totalPrompts: stats.totalPrompts,
              },
            }
          : {}),
      },
    };
  } catch (error) {
    log("handleClientConnect: error", { error: String(error) });
    return { success: false, error: "Internal server error" };
  }
}
```

Add admin handlers:

```ts
export async function handleAdminCreateUserApiKey(
  authService: AuthService,
  body: { name?: string; description?: string }
): Promise<ApiResponse<any>> {
  try {
    const created = await authService.createUserApiKey({
      name: body.name ?? "",
      description: body.description ?? "",
    });
    return { success: true, data: created };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function handleAdminListUserApiKeys(
  authService: AuthService
): Promise<ApiResponse<any>> {
  return { success: true, data: { apiKeys: await authService.listUserApiKeys() } };
}
```

- [ ] **Step 4: Add admin route guard in `web-server.ts`**

Add helper:

```ts
private requireAdmin(principal: Principal): Response | null {
  if (principal.kind === "admin") return null;
  return this.jsonResponse({ success: false, error: "Admin key required" }, 403);
}
```

Add routes before memory routes:

```ts
if (path === "/api/admin/api-keys" && method === "GET") {
  const forbidden = this.requireAdmin(principal);
  if (forbidden) return forbidden;
  const result = await handleAdminListUserApiKeys(this.authService);
  return this.jsonResponse(result);
}

if (path === "/api/admin/api-keys" && method === "POST") {
  const forbidden = this.requireAdmin(principal);
  if (forbidden) return forbidden;
  const body = await this.parseBody(req);
  const result = await handleAdminCreateUserApiKey(this.authService, body);
  return this.jsonResponse(result);
}
```

Do not log `result.data.value`.

- [ ] **Step 5: Run focused route tests**

Run:

```bash
bun test tests/client-connect-memory-banks.test.ts tests/v2-admin-api.test.ts --isolate
bun run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit checkpoint**

Run only with commit authorization:

```bash
git add src/services/api-handlers.ts src/services/web-server.ts tests/client-connect-memory-banks.test.ts tests/v2-admin-api.test.ts
git rm tests/newuser-client-connect.test.ts
git commit -m "feat: expose v2 admin and connect APIs"
```

---

### Task 4B: Memory Bank Routes And Handlers

**Files:**
- Modify: `src/services/api-handlers.ts`
- Modify: `src/services/web-server.ts`
- Test: `tests/v2-memory-bank-routes.test.ts`

- [ ] **Step 1: Add failing Memory Bank route tests**

Create `tests/v2-memory-bank-routes.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { WebServer } from "../src/services/web-server.js";

function makeAuthService() {
  const banks = [
    {
      id: "bank-1",
      apiKeyId: "key-1",
      apiKeyName: "opencode",
      name: "vllm-setup",
      description: "Work done on vllm-setup repo",
      shortcut: "opencode>vllm-setup",
      createdAt: 1,
      updatedAt: 1,
    },
  ];
  return {
    authenticateBearer: async (key: string) =>
      key === "admin"
        ? { kind: "admin" }
        : key === "user"
          ? {
              kind: "user-api-key",
              apiKeyId: "key-1",
              apiKeyName: "opencode",
              apiKeyDescription: "OpenCode agent memory access",
            }
          : null,
    listMemoryBanksForApiKey: async (apiKeyId: string) => banks.filter((bank) => bank.apiKeyId === apiKeyId),
    createMemoryBankForApiKey: async (args: any) => ({
      id: "bank-2",
      apiKeyId: args.apiKeyId,
      apiKeyName: "opencode",
      name: args.name,
      description: args.description,
      shortcut: `opencode>${args.name}`,
      createdAt: 2,
      updatedAt: 2,
    }),
    updateUserApiKey: async (args: any) => ({
      id: args.id,
      name: args.name ?? "opencode",
      description: args.description ?? "OpenCode agent memory access",
      createdAt: 1,
      updatedAt: 3,
      lastUsedAt: null,
      revokedAt: null,
    }),
    revokeUserApiKey: async () => true,
    updateMemoryBank: async (args: any) => ({
      id: args.id,
      apiKeyId: "key-1",
      apiKeyName: "opencode",
      name: args.name ?? "vllm-setup",
      description: args.description ?? "Work done on vllm-setup repo",
      shortcut: `opencode>${args.name ?? "vllm-setup"}`,
      createdAt: 1,
      updatedAt: 3,
    }),
    deleteMemoryBank: async (id: string) => id !== "non-empty-bank",
  };
}

async function route(method: string, path: string, bearer: string, body?: unknown) {
  const server = new WebServer(
    { port: 0, host: "127.0.0.1", enabled: false },
    makeAuthService() as any
  ) as any;
  return server._handleRequest(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${bearer}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  );
}

describe("v2 Memory Bank routes", () => {
  it("lists and creates Memory Banks for the authenticated user API key", async () => {
    const listResponse = await route("GET", "/api/memory-banks", "user");
    expect(listResponse.status).toBe(200);
    const listJson = await listResponse.json();
    expect(listJson.data.memoryBanks[0].shortcut).toBe("opencode>vllm-setup");

    const createResponse = await route("POST", "/api/memory-banks", "user", {
      name: "new-project",
      description: "work relating to new-project",
    });
    expect(createResponse.status).toBe(200);
    const createJson = await createResponse.json();
    expect(createJson.data.memoryBank.name).toBe("new-project");
  });

  it("lists and creates Memory Banks through admin nested API key routes", async () => {
    const listResponse = await route("GET", "/api/admin/api-keys/key-1/memory-banks", "admin");
    expect(listResponse.status).toBe(200);

    const createResponse = await route("POST", "/api/admin/api-keys/key-1/memory-banks", "admin", {
      name: "ops",
      description: "Work done on ops repo",
    });
    expect(createResponse.status).toBe(200);
    const json = await createResponse.json();
    expect(json.data.memoryBank.apiKeyId).toBe("key-1");
  });

  it("allows the X-Memory-Bank-ID header in CORS preflight", async () => {
    const response = await route("OPTIONS", "/api/memories", "user");
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("X-Memory-Bank-ID");
  });

  it("updates and revokes user API keys through admin routes", async () => {
    const updateResponse = await route("PATCH", "/api/admin/api-keys/key-1", "admin", {
      name: "codex",
      description: "Codex agent memory access",
    });
    expect(updateResponse.status).toBe(200);
    const updateJson = await updateResponse.json();
    expect(updateJson.data.apiKey.name).toBe("codex");

    const revokeResponse = await route("POST", "/api/admin/api-keys/key-1/revoke", "admin");
    expect(revokeResponse.status).toBe(200);
    const revokeJson = await revokeResponse.json();
    expect(revokeJson.data.revoked).toBe(true);
  });

  it("updates Memory Banks and refuses to delete non-empty banks", async () => {
    const updateResponse = await route("PATCH", "/api/admin/memory-banks/bank-1", "admin", {
      name: "renamed",
      description: "Renamed bank",
    });
    expect(updateResponse.status).toBe(200);
    const updateJson = await updateResponse.json();
    expect(updateJson.data.memoryBank.name).toBe("renamed");

    const deleteResponse = await route("DELETE", "/api/admin/memory-banks/non-empty-bank", "admin");
    expect(deleteResponse.status).toBe(409);
    const deleteJson = await deleteResponse.json();
    expect(deleteJson.error).toContain("not empty");
  });
});
```

- [ ] **Step 2: Run route tests and confirm failure**

Run:

```bash
bun test tests/v2-memory-bank-routes.test.ts --isolate
```

Expected: FAIL because the Memory Bank routes and CORS header are not implemented.

- [ ] **Step 3: Add AuthService Memory Bank methods**

In `src/services/auth-service.ts`, add:

```ts
async listMemoryBanksForApiKey(apiKeyId: string): Promise<MemoryBankRow[]> {
  return this.memoryBankRepo.listForApiKey(apiKeyId);
}

async createMemoryBankForApiKey(args: {
  apiKeyId: string;
  name: string;
  description: string;
}): Promise<MemoryBankRow> {
  const name = requireNonEmpty(args.name, "Memory Bank name is required");
  const description = requireNonEmpty(args.description, "Memory Bank description is required");
  return this.memoryBankRepo.create({
    id: randomUUID(),
    apiKeyId: args.apiKeyId,
    name,
    description,
  });
}

async updateUserApiKey(args: { id: string; name?: string; description?: string }) {
  return this.userApiKeyRepo.update(args);
}

async revokeUserApiKey(id: string): Promise<boolean> {
  return this.userApiKeyRepo.revoke(id);
}

async updateMemoryBank(args: { id: string; name?: string; description?: string }) {
  return this.memoryBankRepo.update(args);
}

async deleteMemoryBank(id: string): Promise<boolean> {
  return this.memoryBankRepo.delete(id);
}
```

- [ ] **Step 4: Add route handlers**

In `src/services/api-handlers.ts`, add:

```ts
export async function handleListMemoryBanksForApiKey(
  authService: AuthService,
  apiKeyId: string
): Promise<ApiResponse<any>> {
  const banks = await authService.listMemoryBanksForApiKey(apiKeyId);
  return { success: true, data: { memoryBanks: banks.map(formatMemoryBank) } };
}

export async function handleCreateMemoryBankForApiKey(
  authService: AuthService,
  apiKeyId: string,
  body: { name?: string; description?: string }
): Promise<ApiResponse<any>> {
  try {
    const memoryBank = await authService.createMemoryBankForApiKey({
      apiKeyId,
      name: body.name ?? "",
      description: body.description ?? "",
    });
    return { success: true, data: { memoryBank: formatMemoryBank(memoryBank) } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
```

- [ ] **Step 5: Add web-server routes and CORS header**

In `src/services/web-server.ts`, ensure both preflight and JSON responses include:

```ts
"Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-ID, X-Opencode-Memnet-Client, X-Memory-Bank-ID"
```

Add routes before memory CRUD routes:

```ts
if (path === "/api/memory-banks" && method === "GET") {
  if (principal.kind !== "user-api-key") {
    return this.jsonResponse({ success: false, error: "User API key required" }, 403);
  }
  const result = await handleListMemoryBanksForApiKey(this.authService, principal.apiKeyId);
  return this.jsonResponse(result);
}

if (path === "/api/memory-banks" && method === "POST") {
  if (principal.kind !== "user-api-key") {
    return this.jsonResponse({ success: false, error: "User API key required" }, 403);
  }
  const body = await this.parseBody(req);
  const result = await handleCreateMemoryBankForApiKey(this.authService, principal.apiKeyId, body);
  return this.jsonResponse(result);
}

const adminBankMatch = path.match(/^\/api\/admin\/api-keys\/([^/]+)\/memory-banks$/);
if (adminBankMatch && (method === "GET" || method === "POST")) {
  const forbidden = this.requireAdmin(principal);
  if (forbidden) return forbidden;
  const apiKeyId = decodeURIComponent(adminBankMatch[1]!);
  const result =
    method === "GET"
      ? await handleListMemoryBanksForApiKey(this.authService, apiKeyId)
      : await handleCreateMemoryBankForApiKey(this.authService, apiKeyId, await this.parseBody(req));
  return this.jsonResponse(result);
}
```

Also implement the admin contract routes declared earlier in the plan:
- `PATCH /api/admin/api-keys/:id` calls `authService.updateUserApiKey()`.
- `POST /api/admin/api-keys/:id/revoke` calls `authService.revokeUserApiKey()`.
- `PATCH /api/admin/memory-banks/:id` calls `authService.updateMemoryBank()`.
- `DELETE /api/admin/memory-banks/:id` calls `authService.deleteMemoryBank()` and returns HTTP 409 with an error containing `not empty` when the repository preflight finds memory, prompt, profile-learning, AI session, or AI message rows.

- [ ] **Step 6: Run Memory Bank route tests**

Run:

```bash
bun test tests/v2-memory-bank-routes.test.ts tests/v2-admin-api.test.ts tests/client-connect-memory-banks.test.ts --isolate
bun run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit checkpoint**

Run only with commit authorization:

```bash
git add src/services/auth-service.ts src/services/api-handlers.ts src/services/web-server.ts tests/v2-memory-bank-routes.test.ts tests/v2-admin-api.test.ts tests/client-connect-memory-banks.test.ts
git commit -m "feat: add v2 memory bank routes"
```

---

### Task 5: Route Memory Operations Through Active Memory Bank

**Files:**
- Modify: `src/services/api-handlers.ts`
- Modify: `src/services/web-server.ts`
- Modify: `src/services/storage/postgres/memory-repository.ts`
- Modify: `src/services/storage/postgres/prompt-repository.ts`
- Modify: `src/services/storage/postgres/profile-repository.ts`
- Modify: `src/services/memory-maintenance-job-service.ts`
- Test: `tests/api-handlers-memory-bank-scope.test.ts`
- Test: replace `tests/api-handlers-principal-filter.test.ts`
- Test: replace `tests/profile-key-api-ownership.test.ts`

- [ ] **Step 1: Add failing Memory Bank isolation test**

Create `tests/api-handlers-memory-bank-scope.test.ts`:

```ts
import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Principal } from "../src/services/auth-service.js";

const inserted: any[] = [];
const listedArgs: any[] = [];

const memoryRepo = {
  initialize: async () => {},
  insert: async (record: any) => inserted.push(record),
  list: async (args: any) => {
    listedArgs.push(args);
    return [];
  },
  count: async () => 0,
  countByType: async () => ({}),
  getDistinctTags: async () => [],
  getById: async () => null,
};

mock.module("../src/services/embedding.js", () => ({
  embeddingService: {
    warmup: async () => {},
    embedWithTimeout: async () => new Float32Array([0.1, 0.2, 0.3]),
  },
}));

mock.module("../src/services/storage/factory.js", () => ({
  createMemoryRepository: () => memoryRepo,
  createUserPromptRepository: () => ({ initialize: async () => {}, getCapturedPrompts: async () => [] }),
  createUserProfileRepository: () => ({ initialize: async () => {} }),
  createClientRepository: () => ({ initialize: async () => {} }),
  createUserApiKeyRepository: () => ({ initialize: async () => {} }),
  createMemoryBankRepository: () => ({ initialize: async () => {} }),
  createTagRegistry: () => ({ linkMemoryTags: async () => {} }),
}));

const { handleAddMemory, handleListMemories } = await import(
  "../src/services/api-handlers.js?bank-scope"
);

const principal: Principal = {
  kind: "user-api-key",
  apiKeyId: "key-1",
  apiKeyName: "opencode",
  apiKeyDescription: "OpenCode agent memory access",
};
const bank = {
  id: "bank-1",
  apiKeyId: "key-1",
  apiKeyName: "opencode",
  name: "vllm-setup",
  description: "Work done on vllm-setup repo",
  shortcut: "opencode>vllm-setup",
  createdAt: 1,
  updatedAt: 1,
};

beforeEach(() => {
  inserted.length = 0;
  listedArgs.length = 0;
});

describe("Memory Bank-scoped handlers", () => {
  it("writes apiKeyId and memoryBankId on added memories", async () => {
    const result = await handleAddMemory(
      {
        content: "Remember the vLLM launch command",
        containerTag: "opencode_project_repo",
        type: "fact",
        tags: ["vllm"],
      },
      { principal, memoryBank: bank }
    );

    expect(result.success).toBe(true);
    expect(inserted[0].apiKeyId).toBe("key-1");
    expect(inserted[0].memoryBankId).toBe("bank-1");
    expect(inserted[0].profileId).toBeUndefined();
  });

  it("lists memories only inside the active Memory Bank", async () => {
    await handleListMemories(
      undefined,
      1,
      20,
      true,
      { principal, memoryBank: bank }
    );

    expect(listedArgs[0].apiKeyId).toBe("key-1");
    expect(listedArgs[0].memoryBankId).toBe("bank-1");
  });
});
```

- [ ] **Step 2: Run bank-scope test and confirm failure**

Run:

```bash
bun test tests/api-handlers-memory-bank-scope.test.ts --isolate
```

Expected: FAIL because handlers still take `profileId` positional arguments.

- [ ] **Step 3: Add request scope type**

In `src/services/api-handlers.ts`, add:

```ts
type MemoryBankRequestScope = {
  principal: Principal;
  memoryBank: MemoryBankRow;
};

function ownerScope(scope: MemoryBankRequestScope): { apiKeyId: string; memoryBankId: string } {
  return {
    apiKeyId: scope.memoryBank.apiKeyId,
    memoryBankId: scope.memoryBank.id,
  };
}
```

Change handler signatures:
- `handleAddMemory(data, scope: MemoryBankRequestScope)`
- `handleListMemories(tag, page, pageSize, includePrompts, scope: MemoryBankRequestScope)`
- `handleSearch(query, tag, page, pageSize, scope: MemoryBankRequestScope)`
- `handleStats(scope?: MemoryBankRequestScope)`
- `handleContextInject(data & { memoryBankId?: string }, scope)`
- `handleAutoCapture(data & { memoryBankId?: string }, scope)`
- `handleUserProfileLearn(data, scope)`

Set records with:

```ts
const owner = ownerScope(scope);
const record: MemoryRecord = {
  id,
  content: filteredContent,
  vector,
  tagsVector,
  containerTag: data.containerTag,
  tags: tags.length > 0 ? tags.join(",") : undefined,
  type: data.type,
  createdAt: now,
  updatedAt: now,
  metadata: JSON.stringify({ source: "api" }),
  apiKeyId: owner.apiKeyId,
  memoryBankId: owner.memoryBankId,
};
```

- [ ] **Step 4: Resolve Memory Bank in `web-server.ts`**

Add:

```ts
private async memoryBankScope(req: Request, principal: Principal): Promise<MemoryBankRequestScope> {
  const bankId = req.headers.get("X-Memory-Bank-ID") || new URL(req.url).searchParams.get("memoryBankId") || undefined;
  const bank = await this.authService.requireBankForPrincipal(principal, bankId);
  return { principal, memoryBank: bank };
}
```

For memory routes, call:

```ts
const scope = await this.memoryBankScope(req, principal);
```

Then pass `scope` into handlers instead of `profileId`/`repoId`.

- [ ] **Step 5: Update repository SQL filters**

In `src/services/storage/postgres/memory-repository.ts`, add `api_key_id` and `memory_bank_id` to inserts/updates and require both filters for user and admin memory operations. Do not use optional `OR` ownership filters; every handler must resolve a Memory Bank first and pass its real owner `apiKeyId`.

Use direct filters like:

```ts
AND api_key_id = ${args.apiKeyId}
AND memory_bank_id = ${args.memoryBankId}
```

Do the same in:
- `search()`
- `list()`
- `count()`
- `countByType()`
- `getById()`
- `delete()`
- `deleteMany()`
- `update()`
- `pin()`
- `unpin()`
- `getDistinctTags()`
- `getDistinctTagValues()`
- `listOlderThan()`
- `getAllWithVectors()`

In `src/services/storage/postgres/prompt-repository.ts`, add `api_key_id` and `memory_bank_id` to prompt insert/select/search/delete filters used by auto-capture and WebUI timeline. Convert prompt ID paths and cascades so `getById`, delete, captured-prompt lookup, unanalyzed prompt lookup, linked prompt cleanup, and session queries all accept `{ apiKeyId, memoryBankId }` or enforce a post-fetch bank check before mutating.

In `src/services/storage/postgres/profile-repository.ts`, scope internal profile-learning rows by `api_key_id` and `memory_bank_id`. Profile snapshot, changelog, active-profile lookup, and cleanup paths must not read or mutate rows outside the active Memory Bank.

In AI session repositories, retain v2 AI session persistence and scope both `ai_sessions` and `ai_messages` by `api_key_id` and `memory_bank_id`. Session create, append-message, list, get, cleanup, and retention queries must filter on the active Memory Bank and include bank-owned indexes from Task 2.

In tag registry code, implement the bank-local schema from Task 2. `memory_tags`, `memory_tag_links`, and retained alias tables must read and write `memory_bank_id`; `canonical_name` uniqueness is per bank, not global. Related-memory and alias lookup queries must join through bank-local links and reject cross-bank matches.

- [ ] **Step 6: Convert route inventory to bank-scoped behavior**

Add this route inventory near the top of `src/services/web-server.ts` as comments or tests in `tests/api-handlers-memory-bank-scope.test.ts`, then implement the listed behavior:

| Route family | Auth kind | Scope rule |
| --- | --- | --- |
| `/api/admin/*` | admin-only | global admin metadata; memory rows require explicit bank ID when touched |
| `/api/client/connect` | user API key | no active bank required; returns `ClientConnectResponse` |
| `/api/memory-banks` | user API key | API key-owned bank list/create |
| `/api/memories`, `/api/search`, `/api/context`, `/api/capture` | user or admin | require `X-Memory-Bank-ID`; resolve bank before handler call |
| `/api/tags`, `/api/tag-values` | user or admin | require `X-Memory-Bank-ID`; return bank-local tags only |
| `/api/prompts`, prompt capture/cascade routes | user or admin | require `X-Memory-Bank-ID`; mutate only bank-local prompt rows |
| `/api/profile`, profile learning, profile snapshots | user or admin | require `X-Memory-Bank-ID`; treat profile as bank-local learning state |
| `/api/maintenance/*` | admin-only | require explicit `memoryBankId` for bank jobs, or run global jobs only when the endpoint name is explicitly global |
| `/health` | public | no auth, no bank |

Update `handleListTags`, tag registry reads, tag migration service, `memory-maintenance-job-service.ts`, profile learning, auto-capture, context injection, scoped stats, and maintenance queue handlers so they accept `MemoryBankRequestScope` and use direct bank filters.

Maintenance and tag migration rules:
- add `memoryBank` job scope with `{ apiKeyId, memoryBankId }`;
- keep global maintenance admin-only and name global routes explicitly;
- tag lists and tag registry links are bank-local for normal memory requests;
- tag migration must never call unscoped memory repository list/update methods from a user-key request.

Stats rules:
- `handleStats(scope)` returns totals for one Memory Bank when `scope` is present;
- unscoped aggregate stats are admin-only and must not run during plugin or Codex startup;
- `GET /api/stats` from a user API key requires `X-Memory-Bank-ID`.

- [ ] **Step 7: Convert legacy ownership tests instead of deleting them**

Replace `tests/api-handlers-principal-filter.test.ts` and `tests/profile-key-api-ownership.test.ts` with Memory Bank isolation coverage that proves:
- cross-bank `getById` returns not found;
- cross-bank delete, `deleteMany`, update, pin, and unpin are denied or no-op;
- prompt cascade delete cannot delete prompts or linked memories from another Memory Bank;
- AI session list/get/message/cleanup paths cannot read or mutate `ai_sessions` or `ai_messages` from another Memory Bank;
- tag registry list, alias lookup, related-memory lookup, and tag migration are bank-local, including two banks that use the same `canonical_name`;
- search, list, tag list, context injection, auto-capture, profile learning, profile snapshots, maintenance, and tag migration return only rows for the active Memory Bank;
- admin requests still write the selected bank owner's real `apiKeyId` and never write `""` to UUID columns.

- [ ] **Step 8: Run bank-scope and legacy ownership replacements**

Run:

```bash
bun test tests/api-handlers-memory-bank-scope.test.ts --isolate
bun test tests/api-handlers-principal-filter.test.ts tests/profile-key-api-ownership.test.ts --isolate
bun run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit checkpoint**

Run only with commit authorization:

```bash
git add src/services/api-handlers.ts src/services/web-server.ts src/services/storage/postgres/memory-repository.ts src/services/storage/postgres/prompt-repository.ts src/services/storage/postgres/profile-repository.ts src/services/memory-maintenance-job-service.ts tests/api-handlers-memory-bank-scope.test.ts
git rm tests/api-handlers-principal-filter.test.ts tests/profile-key-api-ownership.test.ts
git commit -m "feat: scope memory operations by memory bank"
```

---

### Task 6: WebUI Admin API Key And Memory Bank Management

**Files:**
- Modify: `src/web/index.html`
- Modify: `src/web/app.js`
- Modify: `src/web/styles.css`
- Modify: `src/web/i18n.js`
- Test: `tests/webui-v2-auth-memory-banks.test.ts`
- Replace: `tests/webui-profile-key-lock.test.ts`
- Replace: `tests/webui-strict-identity.test.ts`

- [ ] **Step 1: Add failing WebUI text/structure tests**

Create `tests/webui-v2-auth-memory-banks.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const app = readFileSync(join(import.meta.dir, "../src/web/app.js"), "utf-8");
const html = readFileSync(join(import.meta.dir, "../src/web/index.html"), "utf-8");
const css = readFileSync(join(import.meta.dir, "../src/web/styles.css"), "utf-8");
const i18n = readFileSync(join(import.meta.dir, "../src/web/i18n.js"), "utf-8");

describe("WebUI v2 auth and Memory Bank controls", () => {
  it("uses admin API key and Memory Bank state instead of profile state", () => {
    expect(app).toContain("apiKeys: []");
    expect(app).toContain("memoryBanks: []");
    expect(app).toContain("activeMemoryBankId");
    expect(app).not.toContain("activeProfileId");
    expect(app).not.toContain("profileLocked");
  });

  it("calls v2 admin API key and Memory Bank routes", () => {
    expect(app).toContain('fetchAPI("/api/admin/api-keys"');
    expect(app).toContain("/api/admin/api-keys/");
    expect(app).toContain("/memory-banks");
    expect(app).toContain("X-Memory-Bank-ID");
    expect(app).toContain("No active Memory Bank");
    expect(app).toContain("activeMemoryBankId");
  });

  it("renders key and bank management panels", () => {
    expect(html).toContain("api-key-admin-section");
    expect(html).toContain("memory-bank-admin-section");
    expect(html).toContain("generated-key-modal");
    expect(css).toContain(".generated-key-value");
  });

  it("has v2 labels and removes legacy profile wording", () => {
    expect(i18n).toContain("Memory Bank");
    expect(i18n).toContain("API Key Description");
    expect(i18n).not.toContain("Profile key");
  });
});
```

- [ ] **Step 2: Run WebUI test and confirm failure**

Run:

```bash
bun test tests/webui-v2-auth-memory-banks.test.ts --isolate
```

Expected: FAIL because UI still uses profile state and lacks admin/bank panels.

- [ ] **Step 3: Update WebUI state and fetch helper**

In `src/web/app.js`, replace profile state with:

```js
const state = {
  tags: { project: [] },
  memories: [],
  currentPage: 1,
  pageSize: 20,
  totalPages: 1,
  totalItems: 0,
  selectedTag: "",
  currentView: "project",
  searchQuery: "",
  isSearching: false,
  selectedMemories: new Set(),
  autoRefreshInterval: null,
  userProfile: null,
  authKey: localStorage.getItem("opencode-memnet-apikey") || "",
  apiKeys: [],
  memoryBanks: [],
  activeApiKeyId: localStorage.getItem("opencode-memnet-active-api-key") || "",
  activeMemoryBankId: localStorage.getItem("opencode-memnet-active-memory-bank") || "",
  principal: null,
  lastJobStatus: {
    activity: { active: false, text: "Idle", queuedCount: 0 },
    current: null,
    queued: [],
    history: [],
  },
  jobPollTimer: null,
  jobPollInterval: 5000,
};
```

Update `fetchAPI()`:

```js
if (state.activeMemoryBankId) {
  headers["X-Memory-Bank-ID"] = state.activeMemoryBankId;
}
```

- [ ] **Step 4: Add admin API key functions**

Add:

```js
async function loadApiKeys() {
  const result = await fetchAPI("/api/admin/api-keys");
  if (!result.success) {
    showToast(result.error || t("toast-api-keys-failed"), "error");
    return;
  }
  state.apiKeys = result.data.apiKeys || [];
  renderApiKeys();
}

async function createApiKey(e) {
  e.preventDefault();
  const name = document.getElementById("api-key-name").value.trim();
  const description = document.getElementById("api-key-description").value.trim();
  const result = await fetchAPI("/api/admin/api-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description }),
  });
  if (!result.success) {
    showToast(result.error || t("toast-api-key-create-failed"), "error");
    return;
  }
  showGeneratedKey(result.data.value);
  document.getElementById("api-key-form").reset();
  await loadApiKeys();
}

function showGeneratedKey(value) {
  const modal = document.getElementById("generated-key-modal");
  document.getElementById("generated-key-value").textContent = value;
  modal.classList.remove("hidden");
}

function renderApiKeys() {
  const container = document.getElementById("api-key-list");
  container.innerHTML = state.apiKeys
    .map(
      (key) => `
        <button class="api-key-row ${state.activeApiKeyId === key.id ? "active" : ""}" data-api-key-id="${escapeAttr(key.id)}">
          <span>${escapeHtml(key.name)}</span>
          <small>${escapeHtml(key.description)}</small>
        </button>`
    )
    .join("");
  container.querySelectorAll("[data-api-key-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.activeApiKeyId = button.dataset.apiKeyId;
      localStorage.setItem("opencode-memnet-active-api-key", state.activeApiKeyId);
      await loadMemoryBanksForActiveKey();
      renderApiKeys();
    });
  });
}
```

- [ ] **Step 5: Add Memory Bank functions**

Add:

```js
async function loadMemoryBanksForActiveKey() {
  if (!state.activeApiKeyId) {
    state.memoryBanks = [];
    renderMemoryBanks();
    return;
  }
  const result = await fetchAPI(`/api/admin/api-keys/${encodeURIComponent(state.activeApiKeyId)}/memory-banks`);
  if (!result.success) {
    showToast(result.error || t("toast-memory-banks-failed"), "error");
    return;
  }
  state.memoryBanks = result.data.memoryBanks || [];
  if (!state.memoryBanks.some((bank) => bank.id === state.activeMemoryBankId)) {
    state.activeMemoryBankId = state.memoryBanks[0]?.id || "";
    localStorage.setItem("opencode-memnet-active-memory-bank", state.activeMemoryBankId);
  }
  renderMemoryBanks();
  if (state.activeMemoryBankId) {
    await loadTags();
    await loadMemories();
  } else {
    state.tags = { project: [] };
    state.memories = [];
    showToast(t("toast-no-active-memory-bank"), "error");
  }
}

async function createMemoryBank(e) {
  e.preventDefault();
  if (!state.activeApiKeyId) {
    showToast(t("toast-select-api-key"), "error");
    return;
  }
  const name = document.getElementById("memory-bank-name").value.trim();
  const description = document.getElementById("memory-bank-description").value.trim();
  const result = await fetchAPI(`/api/admin/api-keys/${encodeURIComponent(state.activeApiKeyId)}/memory-banks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description }),
  });
  if (!result.success) {
    showToast(result.error || t("toast-memory-bank-create-failed"), "error");
    return;
  }
  state.activeMemoryBankId = result.data.memoryBank.id;
  localStorage.setItem("opencode-memnet-active-memory-bank", state.activeMemoryBankId);
  document.getElementById("memory-bank-form").reset();
  await loadMemoryBanksForActiveKey();
}

function renderMemoryBanks() {
  const select = document.getElementById("memory-bank-select");
  select.innerHTML = state.memoryBanks
    .map(
      (bank) =>
        `<option value="${escapeAttr(bank.id)}" ${bank.id === state.activeMemoryBankId ? "selected" : ""}>${escapeHtml(bank.shortcut)}</option>`
    )
    .join("");
}

function requireActiveMemoryBank() {
  if (state.activeMemoryBankId) return true;
  showToast(t("toast-no-active-memory-bank"), "error");
  return false;
}
```

Call `requireActiveMemoryBank()` at the start of `loadTags()`, `loadMemories()`, memory search, add-memory, delete, pin, unpin, context, capture, stats, tag list, and profile-learning requests. These requests must not be sent without `X-Memory-Bank-ID`.

Attach events in initialization:

```js
document.getElementById("api-key-form").addEventListener("submit", createApiKey);
document.getElementById("memory-bank-form").addEventListener("submit", createMemoryBank);
document.getElementById("memory-bank-select").addEventListener("change", async (event) => {
  state.activeMemoryBankId = event.target.value;
  localStorage.setItem("opencode-memnet-active-memory-bank", state.activeMemoryBankId);
  await loadTags();
  await loadMemories();
});
```

- [ ] **Step 6: Add HTML panels and CSS**

In `src/web/index.html`, add sections near settings:

```html
<section id="api-key-admin-section" class="admin-section">
  <h2 data-i18n="section-api-keys">User API Keys</h2>
  <form id="api-key-form" class="admin-form">
    <input id="api-key-name" type="text" data-i18n-placeholder="placeholder-api-key-name" required />
    <input id="api-key-description" type="text" data-i18n-placeholder="placeholder-api-key-description" required />
    <button type="submit" class="btn-primary"><i data-lucide="key" class="icon"></i> Create API Key</button>
  </form>
  <div id="api-key-list" class="admin-list"></div>
</section>

<section id="memory-bank-admin-section" class="admin-section">
  <h2 data-i18n="section-memory-banks">Memory Banks</h2>
  <select id="memory-bank-select"></select>
  <form id="memory-bank-form" class="admin-form">
    <input id="memory-bank-name" type="text" data-i18n-placeholder="placeholder-memory-bank-name" required />
    <input id="memory-bank-description" type="text" data-i18n-placeholder="placeholder-memory-bank-description" required />
    <button type="submit" class="btn-primary"><i data-lucide="database" class="icon"></i> Create Memory Bank</button>
  </form>
</section>

<div id="generated-key-modal" class="modal hidden">
  <div class="modal-content">
    <div class="modal-header">
      <h3 data-i18n="modal-generated-key-title">Generated User API Key</h3>
      <button class="modal-close" id="generated-key-close"><i data-lucide="x" class="icon"></i></button>
    </div>
    <p data-i18n="modal-generated-key-desc">Copy this key now. It will not be shown again.</p>
    <pre id="generated-key-value" class="generated-key-value"></pre>
  </div>
</div>
```

In `src/web/styles.css`, add:

```css
.admin-section {
  border-top: 1px solid var(--border-color);
  padding: 16px 0;
}

.admin-form {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) minmax(240px, 2fr) auto;
  gap: 8px;
  align-items: center;
}

.admin-list {
  display: grid;
  gap: 6px;
  margin-top: 10px;
}

.api-key-row {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) minmax(180px, 2fr);
  gap: 8px;
  text-align: left;
  border: 1px solid var(--border-color);
  background: var(--surface-color);
  padding: 8px;
  border-radius: 6px;
}

.api-key-row.active {
  border-color: var(--accent-color);
}

.generated-key-value {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  border: 1px solid var(--border-color);
  padding: 12px;
  border-radius: 6px;
}
```

- [ ] **Step 7: Update i18n labels**

Add English keys in `src/web/i18n.js`:

```js
"section-api-keys": "User API Keys",
"section-memory-banks": "Memory Banks",
"placeholder-api-key-name": "API Key Name",
"placeholder-api-key-description": "API Key Description",
"placeholder-memory-bank-name": "Memory Bank Name",
"placeholder-memory-bank-description": "Memory Bank Description",
"modal-generated-key-title": "Generated User API Key",
"modal-generated-key-desc": "Copy this key now. It will not be shown again.",
"toast-api-keys-failed": "Failed to load API keys",
"toast-api-key-create-failed": "Failed to create API key",
"toast-memory-banks-failed": "Failed to load Memory Banks",
"toast-memory-bank-create-failed": "Failed to create Memory Bank",
"toast-select-api-key": "Select an API key first",
"toast-no-active-memory-bank": "No active Memory Bank",
```

- [ ] **Step 8: Run WebUI test**

Run:

```bash
bun test tests/webui-v2-auth-memory-banks.test.ts --isolate
bun run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit checkpoint**

Run only with commit authorization:

```bash
git add src/web/index.html src/web/app.js src/web/styles.css src/web/i18n.js tests/webui-v2-auth-memory-banks.test.ts
git rm tests/webui-profile-key-lock.test.ts tests/webui-strict-identity.test.ts
git commit -m "feat: add webui api key and memory bank management"
```

---

### Task 7: Shared Memory Bank Helpers And Magic Prompt Parser

**Files:**
- Create: `shared/memory-bank.ts`
- Modify: `shared/types.ts`
- Test: `tests/shared-memory-bank.test.ts`

- [ ] **Step 1: Add failing helper tests**

Create `tests/shared-memory-bank.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
  parseMagicMemoryBankPrompt,
  suggestMemoryBank,
  stateKeyForMemoryBank,
} from "../shared/memory-bank.js";

describe("shared Memory Bank helpers", () => {
  it("suggests a bank from the current directory", () => {
    expect(suggestMemoryBank("/home/phrkr/Workspace/vllm-setup")).toEqual({
      name: "vllm-setup",
      description: "Work done on vllm-setup repo",
    });
  });

  it("parses the magic Memory Bank creation prompt", () => {
    expect(
      parseMagicMemoryBankPrompt(
        "!opencode-memnet!New memory bank called 'new-project', create it, and activate it!"
      )
    ).toEqual({
      name: "new-project",
      description: "work relating to new-project",
    });
  });

  it("ignores normal prompts", () => {
    expect(parseMagicMemoryBankPrompt("create a database migration")).toBeNull();
  });

  it("builds a stable state key without using the secret API key value", () => {
    expect(
      stateKeyForMemoryBank({
        serverUrl: "https://memory.example",
        apiKeyName: "opencode",
        cwd: "/home/phrkr/Workspace/vllm-setup",
      })
    ).toBe("https://memory.example|opencode|/home/phrkr/Workspace/vllm-setup");
  });
});
```

- [ ] **Step 2: Run helper test and confirm failure**

Run:

```bash
bun test tests/shared-memory-bank.test.ts --isolate
```

Expected: FAIL because `shared/memory-bank.ts` does not exist.

- [ ] **Step 3: Implement shared helper**

Create `shared/memory-bank.ts`:

```ts
import { basename, resolve } from "node:path";

export interface SuggestedMemoryBank {
  name: string;
  description: string;
}

export interface MemoryBankStateKeyInput {
  serverUrl: string;
  apiKeyName: string;
  cwd: string;
}

const MAGIC_RE =
  /^!opencode-memnet!New memory bank called ['"]([^'"]+)['"], create it, and activate it!$/i;

function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, "-").toLowerCase();
}

export function suggestMemoryBank(cwd: string): SuggestedMemoryBank {
  const name = cleanName(basename(resolve(cwd)) || "workspace");
  return {
    name,
    description: `Work done on ${name} repo`,
  };
}

export function parseMagicMemoryBankPrompt(input: string): SuggestedMemoryBank | null {
  const match = input.trim().match(MAGIC_RE);
  if (!match) return null;
  const name = cleanName(match[1] ?? "");
  if (!name) return null;
  return {
    name,
    description: `work relating to ${name}`,
  };
}

export function stateKeyForMemoryBank(input: MemoryBankStateKeyInput): string {
  return `${input.serverUrl.replace(/\/+$/, "")}|${input.apiKeyName}|${resolve(input.cwd)}`;
}
```

In `shared/types.ts`, add the DTO types from the V2 API Contract section.

- [ ] **Step 4: Run helper tests**

Run:

```bash
bun test tests/shared-memory-bank.test.ts --isolate
bun run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit checkpoint**

Run only with commit authorization:

```bash
git add shared/memory-bank.ts shared/types.ts tests/shared-memory-bank.test.ts
git commit -m "feat: add shared memory bank helpers"
```

---

### Task 8: OpenCode Plugin V2 Startup And Bank Routing

**Files:**
- Modify: `shared/client-config.ts`
- Modify: `plugin/src/services/remote-client.ts`
- Modify: `plugin/src/index-remote.ts`
- Test: `tests/plugin-memory-bank-startup.test.ts`
- Test: `tests/plugin-magic-memory-bank.test.ts`
- Replace: `tests/plugin-newuser-enrollment-config.test.ts`
- Replace: `tests/plugin-profile-key.test.ts`
- Modify: `tests/plugin-remote-client-scope.test.ts`

- [ ] **Step 1: Add failing OpenCode startup tests**

Create `tests/plugin-memory-bank-startup.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const remoteClient = readFileSync(
  join(import.meta.dir, "../plugin/src/services/remote-client.ts"),
  "utf-8"
);
const plugin = readFileSync(join(import.meta.dir, "../plugin/src/index-remote.ts"), "utf-8");
const config = readFileSync(join(import.meta.dir, "../shared/client-config.ts"), "utf-8");

describe("OpenCode plugin v2 Memory Bank startup", () => {
  it("removes profile and NEWUSER enrollment config behavior", () => {
    expect(config).not.toContain("profileId");
    expect(config).not.toContain("rewriteClientApiKeySource");
    expect(remoteClient).not.toContain("enrollment");
  });

  it("stores and sends an active Memory Bank ID", () => {
    expect(plugin).toContain("activeMemoryBank");
    expect(plugin).toContain("requiresMemoryBank");
    expect(remoteClient).toContain("ClientConnectResponse");
    expect(remoteClient).toContain("X-Memory-Bank-ID");
    expect(plugin).toContain("No active Memory Bank");
    expect(plugin).not.toContain("profileId");
  });
});
```

Create `tests/plugin-magic-memory-bank.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const plugin = readFileSync(join(import.meta.dir, "../plugin/src/index-remote.ts"), "utf-8");

describe("OpenCode plugin magic Memory Bank prompt", () => {
  it("parses magic prompt and creates then activates a Memory Bank", () => {
    expect(plugin).toContain("parseMagicMemoryBankPrompt");
    expect(plugin).toContain("createMemoryBank");
    expect(plugin).toContain("Created and activated");
    expect(plugin).toContain("work relating to");
  });
});
```

- [ ] **Step 2: Run plugin tests and confirm failure**

Run:

```bash
bun test tests/plugin-memory-bank-startup.test.ts tests/plugin-magic-memory-bank.test.ts --isolate
```

Expected: FAIL because plugin still uses profile/new-user flow.

- [ ] **Step 3: Remove legacy profile config**

In `shared/client-config.ts`:
- Remove `profileId?: string` from `ClientConfig`.
- Remove `CLIENT_CONFIG_SOURCES` handling that uses `profileId` as an API key source fallback.
- Remove `rewriteClientApiKeySource()` and helper functions used only by generated profile key enrollment.

Keep:
- `serverUrl`
- `apiKey`
- memory/chat/capture settings
- custom message settings

- [ ] **Step 4: Update OpenCode remote client**

In `plugin/src/services/remote-client.ts`, change `request()` to accept `memoryBankId`:

```ts
private async request<T>(
  method: string,
  path: string,
  body?: unknown,
  query?: Record<string, string | undefined>,
  options: RequestOptions & { memoryBankId?: string } = {}
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Client-ID": this.clientId,
    "X-Opencode-Memnet-Client": "plugin",
  };
  if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
  if (options.memoryBankId) headers["X-Memory-Bank-ID"] = options.memoryBankId;
```

Change `clientConnect()` response:

```ts
async clientConnect(
  clientId: string,
  metadata: Record<string, unknown>
): Promise<ApiResponse<ClientConnectResponse>> {
  return this.request<ClientConnectResponse>("POST", "/api/client/connect", {
    clientId,
    metadata,
    includeStats: false,
  });
}
```

Add:

```ts
async createMemoryBank(args: { name: string; description: string }): Promise<ApiResponse<{ memoryBank: MemoryBankSummary }>> {
  return this.request("POST", "/api/memory-banks", args);
}
```

Pass `memoryBankId` in `getContext`, `autoCapture`, `searchMemories`, `addMemory`, `listMemories`, and `searchMemoriesBySessionID`.

- [ ] **Step 5: Update OpenCode plugin startup**

In `plugin/src/index-remote.ts`:
- Import `parseMagicMemoryBankPrompt`, `suggestMemoryBank`, and `stateKeyForMemoryBank`.
- Replace `effectiveProfileId` with:

```ts
let activeMemoryBank: MemoryBankSummary | null = null;
```

After successful connect:

```ts
const banks = connectionInfo.memoryBanks ?? [];
const stateKey = stateKeyForMemoryBank({
  serverUrl: CLIENT_CONFIG.serverUrl,
  apiKeyName: connectionInfo.principal.apiKeyName,
  cwd: directory,
});
activeMemoryBank = chooseActiveMemoryBank(stateKey, banks);
if (!activeMemoryBank && connectionInfo.requiresMemoryBank) {
  const suggestion = suggestMemoryBank(directory);
  await ctx.client?.session.prompt({
    path: { id: "current" },
    body: {
      parts: [
        {
          id: `prt-memory-bank-${Date.now()}`,
          type: "text",
          text: `No Memory Bank is active for ${connectionInfo.principal.apiKeyName}. Create one named ${suggestion.name} with description: ${suggestion.description}`,
        },
      ],
      noReply: true,
    },
  }).catch(() => undefined);
}
```

Define a small chooser in this file:

```ts
function chooseActiveMemoryBank(_stateKey: string, banks: MemoryBankSummary[]): MemoryBankSummary | null {
  return banks[0] ?? null;
}
```

In `chat.message`, before context injection, parse magic:

```ts
const magic = parseMagicMemoryBankPrompt(userMessage);
if (magic) {
  const created = await client.createMemoryBank(magic);
  if (created.success && created.data?.memoryBank) {
    activeMemoryBank = created.data.memoryBank;
    const responsePart: Part = {
      id: `prt-memory-bank-created-${Date.now()}`,
      sessionID: input.sessionID,
      messageID: output.message.id,
      type: "text",
      text: `Created and activated the \`${magic.name}\` Memory Bank. I set its description to \`${magic.description}\`. You should consider changing the description to make it more identifiable; ask me anytime to change it.`,
      synthetic: true,
    } as any;
    output.parts.unshift(responsePart);
  }
  return;
}
```

For every memory call, pass `activeMemoryBank.id`; if missing, return a user-visible JSON error from the memory tool:

```ts
if (!activeMemoryBank) {
  return JSON.stringify({ success: false, error: "No active Memory Bank" });
}
```

OpenCode acceptance checks:
- no config or request path contains `profileId`;
- `clientConnect()` consumes `ClientConnectResponse` and does not expect `firstTime`, `welcomeBack`, `daysSinceLastSeen`, or unscoped `stats`;
- every memory, prompt, context, capture, search, tag, and profile-learning request includes `X-Memory-Bank-ID`;
- no raw user API key value appears in thrown errors, logs, generated prompts, or toast text;
- magic prompt creates the bank through `POST /api/memory-banks`, activates the returned bank, and does not ask for confirmation.

- [ ] **Step 6: Run OpenCode tests**

Run:

```bash
bun test tests/plugin-memory-bank-startup.test.ts tests/plugin-magic-memory-bank.test.ts tests/plugin-remote-client-scope.test.ts --isolate
bun run typecheck:plugin
```

Expected: PASS.

- [ ] **Step 7: Commit checkpoint**

Run only with commit authorization:

```bash
git add shared/client-config.ts plugin/src/services/remote-client.ts plugin/src/index-remote.ts tests/plugin-memory-bank-startup.test.ts tests/plugin-magic-memory-bank.test.ts tests/plugin-remote-client-scope.test.ts
git rm tests/plugin-newuser-enrollment-config.test.ts tests/plugin-profile-key.test.ts
git commit -m "feat: route opencode plugin through memory banks"
```

---

### Task 9: Codex Plugin And Hooks V2 Memory Bank Routing

**Files:**
- Modify: `plugin-codex/src/config.ts`
- Modify: `plugin-codex/src/http-client.ts`
- Modify: `plugin-codex/src/mcp/tools.ts`
- Modify: `plugin-codex/src/mcp/server.ts`
- Modify: `plugin-codex/src/hooks/runner.ts`
- Modify: `plugin-codex/skills/opencode-memnet-memory/SKILL.md`
- Test: `plugin-codex/tests/memory-bank.test.ts`
- Modify: `plugin-codex/tests/config.test.ts`
- Modify: `plugin-codex/tests/http-client.test.ts`
- Modify: `plugin-codex/tests/mcp-tools.test.ts`
- Modify: `plugin-codex/tests/hooks.test.ts`

- [ ] **Step 1: Add failing Codex Memory Bank test**

Create `plugin-codex/tests/memory-bank.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { mergeConfig } from "../src/config";
import { RemoteMemoryClient } from "../src/http-client";

describe("Codex v2 Memory Bank contract", () => {
  test("config no longer exposes profileId", () => {
    const config = mergeConfig({}, {}, { OPENCODE_MEMNET_PROFILE_ID: "legacy" });
    expect("profileId" in config).toBe(false);
  });

  test("memory requests include X-Memory-Bank-ID", async () => {
    const requests: Request[] = [];
    const client = new RemoteMemoryClient({
      baseUrl: "https://memory.example",
      apiKey: "secret",
      clientId: "codex-client",
      fetcher: async (input, init) => {
        requests.push(new Request(input, init));
        return new Response(JSON.stringify({ success: true, data: { id: "mem-1" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    await client.addMemory(
      {
        content: "remember this",
        containerTag: "opencode_project_repo",
        type: "fact",
      },
      { memoryBankId: "bank-1" }
    );

    expect(requests[0]!.headers.get("X-Memory-Bank-ID")).toBe("bank-1");
  });

  test("connect uses ClientConnectResponse without legacy lifecycle fields", async () => {
    const requests: Request[] = [];
    const client = new RemoteMemoryClient({
      baseUrl: "https://memory.example",
      apiKey: "secret",
      clientId: "codex-client",
      fetcher: async (input, init) => {
        requests.push(new Request(input, init));
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              principal: {
                kind: "user-api-key",
                apiKeyId: "key-1",
                apiKeyName: "opencode",
                apiKeyDescription: "OpenCode agent memory access",
              },
              memoryBanks: [],
              requiresMemoryBank: true,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      },
    });

    const response = await client.clientConnect({ includeStats: false });
    expect(response.data?.requiresMemoryBank).toBe(true);
    expect(JSON.stringify(response)).not.toContain("profileId");
    expect(JSON.stringify(response)).not.toContain("firstTime");
    expect(await requests[0]!.json()).toMatchObject({ includeStats: false });
  });
});
```

- [ ] **Step 2: Run Codex test and confirm failure**

Run:

```bash
cd plugin-codex && bun test tests/memory-bank.test.ts
```

Expected: FAIL because config still exposes profileId and HTTP client lacks memoryBankId options.

- [ ] **Step 3: Update Codex config**

In `plugin-codex/src/config.ts`:
- Remove `profileId?: string` from `CodexMemnetConfig`.
- Remove `OPENCODE_MEMNET_PROFILE_ID` merge logic.
- Keep `serverUrl`, `apiKey`, `nickname`, timeout, memory, context, and capture.

- [ ] **Step 4: Update Codex HTTP client**

In `plugin-codex/src/http-client.ts`, add:

```ts
type RequestOptions = { timeoutMs?: number; memoryBankId?: string };
```

Set header:

```ts
...(options.memoryBankId ? { "X-Memory-Bank-ID": options.memoryBankId } : {}),
```

Update methods that operate on memory:

```ts
addMemory(body: AddMemoryBody, options: { memoryBankId: string }) {
  return this.request<{ id: string }>("POST", "/api/memories", body, undefined, {
    memoryBankId: options.memoryBankId,
  });
}
```

Apply the same options to `getContext`, `listMemories`, `searchMemories`, `getUserProfile`, and `autoCapture`. Change `clientConnect()` response to `ClientConnectResponse`.

`clientConnect()` must send `includeStats: false` from MCP startup and hook code. Do not call unscoped startup stats from Codex hooks.

- [ ] **Step 5: Update Codex MCP tools**

In `plugin-codex/src/mcp/tools.ts`:
- Import shared Memory Bank helpers.
- Remove `ProjectScope` `profileId`.
- Add a helper that connects, picks an active bank, and returns `{ http, tags, memoryBank }`.
- For `memory_connect`, return the connect response plus suggested Memory Bank if none exists.
- For memory operations, fail with:

```ts
return fail("No active Memory Bank. Create one before using memory operations.");
```

when no bank is active.

Remove or redefine `memory_profile` so it describes bank state instead of profile state.

- [ ] **Step 6: Update Codex hooks**

In `plugin-codex/src/hooks/runner.ts`:
- Remove `profileId` from `HookRuntime`.
- After `clientConnect()`, choose active Memory Bank from response.
- If no bank exists, skip context/capture with reason `context-failed` or a new reason `missing-memory-bank`.
- Send `memoryBankId` to `getContext()` and `autoCapture()`.
- Do not request stats during hook connect; hook startup body must include `includeStats: false`.
- Do not log the raw user API key in hook errors or skipped-reason diagnostics.

Update `RunHookResult` skipped reasons:

```ts
| "missing-memory-bank"
```

Codex acceptance checks:
- `plugin-codex/tests/config.test.ts` no longer asserts `profileId` config and rejects `OPENCODE_MEMNET_PROFILE_ID` as a runtime field;
- `plugin-codex/tests/http-client.test.ts` asserts `X-Memory-Bank-ID` on add/list/search/context/capture/profile requests;
- `plugin-codex/tests/mcp-tools.test.ts` asserts missing bank returns `No active Memory Bank. Create one before using memory operations.`;
- `plugin-codex/tests/hooks.test.ts` asserts no-bank startup skips context/capture with `missing-memory-bank` and that connect uses `includeStats: false`;
- all Codex tests assert raw API keys are absent from logs, thrown errors, and tool responses.

- [ ] **Step 7: Update Codex skill doc**

In `plugin-codex/skills/opencode-memnet-memory/SKILL.md`, replace profile wording with:

```markdown
Use a configured user API key to connect to the memory server. Memory operations require an active Memory Bank. If the server reports no Memory Banks for this API key, ask the user to create one with a name based on the current repository and a description in the form `Work done on <directory name> repo`.
```

Add magic prompt wording exactly:

```markdown
When the user prompt contains `!opencode-memnet!New memory bank called 'new-project', create it, and activate it!`, create and activate that Memory Bank without confirmation. Use description `work relating to new-project`.
```

- [ ] **Step 8: Run Codex checks**

Run:

```bash
cd plugin-codex && bun test tests/memory-bank.test.ts tests/config.test.ts tests/http-client.test.ts tests/mcp-tools.test.ts tests/hooks.test.ts
cd ..
bun run typecheck:codex-plugin
```

Expected: PASS.

- [ ] **Step 9: Commit checkpoint**

Run only with commit authorization:

```bash
git add plugin-codex/src/config.ts plugin-codex/src/http-client.ts plugin-codex/src/mcp/tools.ts plugin-codex/src/mcp/server.ts plugin-codex/src/hooks/runner.ts plugin-codex/skills/opencode-memnet-memory/SKILL.md plugin-codex/tests/memory-bank.test.ts plugin-codex/tests/config.test.ts plugin-codex/tests/http-client.test.ts plugin-codex/tests/mcp-tools.test.ts plugin-codex/tests/hooks.test.ts
git commit -m "feat: route codex plugin through memory banks"
```

---

### Task 10: Legacy Cleanup, Docs, And Verification

**Files:**
- Delete: `src/services/profile-auth.ts`
- Delete: `src/services/storage/postgres/profile-api-key-repository.ts`
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `docker-compose.yml`
- Modify: `docker-compose.external-db.yml`
- Modify: `plugin-codex/README.md`
- Modify: legacy tests that still cover isolation behavior, including cross-owner memory operations, prompt cascades, tags, search context, maintenance, and linked prompt behavior.
- Create: `tests/v2-clean-start-no-upgrade-path.test.ts`
- Delete: tests whose only assertion is removed generated-key, new-user, static profile-key, or profile-route-lock behavior.

- [ ] **Step 1: Search remaining legacy symbols**

Run:

```bash
rg -n "NEWUSER_API_KEY|PROFILE_KEYS_FILE|profileId|profile key|generated profile|DISABLE_WEBUI_AUTH|DISABLE_CLIENT_AUTH|OPENCODE_MEMNET_PROFILE_ID|serverApiKeyGenerated|newUserApiKey" src shared plugin plugin-codex tests README.md .env.example docker-compose.yml docker-compose.external-db.yml
```

Expected before cleanup: matches only in files targeted by this task.

- [ ] **Step 2: Remove legacy files once imports are gone**

Run:

```bash
rg -n "profile-auth|profile-api-key-repository" src tests plugin plugin-codex shared
```

Expected: no output.

Then remove files:

```bash
rm src/services/profile-auth.ts src/services/storage/postgres/profile-api-key-repository.ts
```

- [ ] **Step 3: Update `.env.example` and docker docs**

`.env.example` must include:

```bash
SERVER_API_KEY=replace-with-a-long-random-admin-key
POSTGRES_URL=postgresql://opencode_memnet:opencode_memnet@localhost:5432/opencode_memnet
EMBEDDING_API_URL=
EMBEDDING_MODEL=
EMBEDDING_API_KEY=
```

It must not include:
- `NEWUSER_API_KEY`
- `PROFILE_KEYS_FILE`
- generated key file paths
- auth disable variables

`docker-compose.yml` and `docker-compose.external-db.yml` must pass only `SERVER_API_KEY` for server auth.

- [ ] **Step 4: Update README**

README auth section must state:

```markdown
Before starting v2 against an existing opencode-memnet database, run the explicit clean-start command. It creates a verified backup file at `backups/opencode-memnet-v1-<timestamp>.dump`. For bundled Compose, the command uses `docker compose exec -T db pg_dump ... --format=custom --file=-`, then verifies the dump with `pg_restore --list`. For external Postgres, it uses `pg_dump --format=custom --file backups/opencode-memnet-v1-<timestamp>.dump "$POSTGRES_URL"` and verifies with `pg_restore --list`.

v2 is a clean start. After the backup is verified, `scripts/v2-clean-start.ts` removes old opencode-memnet runtime/auth/memory data. Normal server startup does not perform destructive reset. Migration 15 refuses to run while v1 rows remain and creates the new v2 structure only after the explicit clean-start reset has already emptied v1 data tables. There is no v1-to-v2 upgrade, import, or backfill path.

`SERVER_API_KEY` is required. The server never generates it. If it is missing or empty, startup fails before the HTTP server starts.

The WebUI is administered with `SERVER_API_KEY`. From the WebUI, create user API keys with a required name and description. The generated user API key value is shown once at creation time and stored server-side only as a hash.

Each user API key starts with no Memory Banks. Create a Memory Bank before using OpenCode or Codex memory operations. The user-facing bank shortcut is `<api-key-name>><memory-bank-name>`, for example `opencode>vllm-setup`.
```

- [ ] **Step 5: Convert useful legacy tests to Memory Bank scope**

Before deleting any test file matched by `tests/profile*`, `tests/newuser*`, `tests/plugin-profile-key.test.ts`, or `tests/docs-strict-identity.test.ts`, classify it:

| Legacy coverage | Required v2 treatment |
| --- | --- |
| generated server key, `NEWUSER_API_KEY`, static profile key, auth-disable flags | delete after Task 1, Task 3, and docs replacement tests pass |
| cross-owner memory delete/update/pin/unpin | convert to cross-Memory Bank denial tests |
| prompt cascade and linked prompt behavior | convert to bank-scoped cascade boundary tests |
| search, context injection, tag list, tag registry, maintenance | convert to bank-local list/search/tag/maintenance tests |
| plugin `profileId` config and request behavior | convert to no `profileId`, active bank, and `X-Memory-Bank-ID` tests |
| docs strict identity | convert to `SERVER_API_KEY`, one-time key reveal, and `<api-key-name>><memory-bank-name>` docs tests |

Converted tests must assert both positive same-bank behavior and negative cross-bank behavior where the legacy test previously asserted cross-profile isolation.

- [ ] **Step 6: Replace docs tests**

Update `tests/docs-auth-docker.test.ts` so it asserts:

```ts
expect(readme).toContain("SERVER_API_KEY is required");
expect(readme).toContain("pg_dump");
expect(readme).toContain("pg_restore --list");
expect(readme).toContain("There is no v1-to-v2 upgrade");
expect(readme).toContain("shown once");
expect(readme).toContain("<api-key-name>><memory-bank-name>");
expect(env).toContain("SERVER_API_KEY=");
expect(env).not.toContain("NEWUSER_API_KEY");
expect(env).not.toContain("PROFILE_KEYS_FILE");
```

Update or delete `tests/docs-strict-identity.test.ts` so no test expects profile/repo ownership as the primary auth model.

- [ ] **Step 7: Add no-upgrade-path source assertion**

Create `tests/v2-clean-start-no-upgrade-path.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sourceFiles = [
  "src/services/storage/postgres/migrations.ts",
  "src/services/storage/postgres/memory-repository.ts",
  "src/services/storage/postgres/prompt-repository.ts",
  "src/services/storage/postgres/profile-repository.ts",
  "src/services/api-handlers.ts",
  "src/services/web-server.ts",
  "scripts/v2-clean-start.ts",
];

function readProjectFile(path: string) {
  return readFileSync(join(import.meta.dir, "..", path), "utf8");
}

describe("v2 clean start has no v1 upgrade path", () => {
  it("keeps reset separate from migration and exposes no v1 transfer path", () => {
    for (const path of sourceFiles) {
      const text = readProjectFile(path);
      expect(text).not.toMatch(/v1.*(import|backfill|compatibility)/i);
      expect(text).not.toMatch(/profile_id\s*=.*api_key_id/i);
      expect(text).not.toMatch(/repo_id\s*=.*memory_bank_id/i);
    }
  });

  it("requires v2 ownership before runtime rows are exposed", () => {
    const handlers = readProjectFile("src/services/api-handlers.ts");
    expect(handlers).toContain("memoryBankId");
    expect(handlers).toContain("apiKeyId");
    expect(handlers).not.toMatch(/WHERE\s+profile_id\s*=/i);
  });
});
```

Run:

```bash
bun test tests/v2-clean-start-no-upgrade-path.test.ts --isolate
```

Expected: PASS after Task 10 cleanup.

- [ ] **Step 8: Run full verification**

Run:

```bash
bun run typecheck:all
bun test --isolate
bun run test:codex-plugin
bun run build:all
rg -n "NEWUSER_API_KEY|PROFILE_KEYS_FILE|profile key|generated profile|DISABLE_WEBUI_AUTH|DISABLE_CLIENT_AUTH|OPENCODE_MEMNET_PROFILE_ID|serverApiKeyGenerated|newUserApiKey" src shared plugin plugin-codex tests README.md .env.example docker-compose.yml docker-compose.external-db.yml
rg -n "profileId|profile_id" src/services plugin plugin-codex shared tests
rg -n "import.*v1|backfill.*v1|compatibility.*v1|profile_id\\s*=|repo_id\\s*=" src/services plugin plugin-codex shared tests scripts
```

Expected:
- Typecheck PASS.
- Server tests PASS.
- Codex plugin tests PASS.
- Build PASS.
- Final `rg` has no output, except intentional historical text in archived docs if those docs are explicitly retained outside the searched paths.
- `profile_id` matches are limited to migration compatibility code and Task 10-approved cleanup remnants; no runtime handler, repository query, plugin, Codex hook, or test expectation depends on `profileId`.

- [ ] **Step 9: Commit checkpoint**

Run only with commit authorization:

```bash
git add README.md .env.example docker-compose.yml docker-compose.external-db.yml plugin-codex/README.md tests/docs-auth-docker.test.ts tests/docs-strict-identity.test.ts
git rm src/services/profile-auth.ts src/services/storage/postgres/profile-api-key-repository.ts
git add -u tests src shared plugin plugin-codex
git commit -m "chore: remove legacy profile and new-user auth"
```

---

## Self-Review

Spec coverage:
- Single required `SERVER_API_KEY`: Task 1.
- No generated server/admin/new-user/profile keys: Tasks 1, 3, 10.
- Admin-created user API keys with required name/description, UUID, random value, hashed storage, one-time reveal: Tasks 2, 3, 4, 6.
- Memory Banks with UUID/name/description and `<api-key-name>><memory-bank-name>` shortcut: Tasks 2, 4B, 6.
- New user API key starts with no Memory Banks and client asks/suggests: Tasks 4, 7, 8, 9.
- Magic prompt string creates and activates bank without confirmation: Tasks 7, 8, 9.
- Memory operations route through active Memory Bank: Tasks 5, 8, 9.
- WebUI admin management: Task 6.
- OpenCode and Codex client updates: Tasks 8 and 9.
- Legacy cleanup and docs: Task 10.

Placeholder scan:
- No placeholder markers, deferred validation, or unspecified test commands are present.
- Large existing-file edits are decomposed by exact functions, routes, and concrete snippets rather than broad refactor instructions.

Type consistency:
- `Principal.kind` uses `"admin"` and `"user-api-key"` throughout.
- Memory Bank route/header uses `X-Memory-Bank-ID` throughout.
- DTO names match across `shared/types.ts`, HTTP clients, server handlers, and tests.

Plan complete and saved to `docs/superpowers/plans/2026-06-26-v2-auth-memory-bank-redesign.md`. Two execution options:

**1. Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
