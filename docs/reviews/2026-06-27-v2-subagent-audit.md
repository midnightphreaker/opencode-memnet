# V2 Auth And Memory Bank Subagent Audit

Date: 2026-06-27
Base: `ad3bdaa691b2961f4f7cb11bb17cfc04615a27b5`
Head: `748e14b1e9190301e8ec5c1251c2871f97755558`

## Summary

Three parallel subagents reviewed the v2 clean-start auth and Memory Bank redesign:

- Debugging/reliability audit: `FAIL`
- Architecture/security code review: `FAIL`
- Optimization/performance audit: `PARTIAL`

The implementation passed typecheck, full tests, Codex plugin tests, and build before review, but the agents found one critical authorization/isolation bug and several important follow-up issues.

opencode-memnet memory tools failed for every subagent with `Invalid JSON response`; no memories were read or captured.

## Critical

### 1. Lazy memory repository proxy drops Memory Bank owner filters

Files:

- `src/services/storage/factory.ts`
- `src/services/storage/types.ts`
- `src/services/storage/postgres/memory-repository.ts`
- `src/services/api-handlers.ts`

Finding:

The lazy `MemoryRepository` proxy in `src/services/storage/factory.ts` forwards only memory IDs for methods such as `getById`, `delete`, `deleteMany`, `pin`, and `unpin`. The interface and Postgres implementation accept `owner?: MemoryBankOwner`, and handlers pass ownership scopes, but the lazy proxy discards those owner arguments.

Why it matters:

A user API key with any valid Memory Bank can potentially fetch, delete, pin, or unpin a memory outside its active Memory Bank if the memory ID is known or guessed. Existing handler tests use mocks and did not exercise the real lazy proxy.

Recommended fix:

Forward `owner?: MemoryBankOwner` through every lazy proxy method that accepts it. Add a factory-level contract test proving cross-bank `getById`, `delete`, `deleteMany`, `pin`, and `unpin` preserve owner arguments through `createMemoryRepository()`.

## Important

### 1. `/api/user-profiles` exposes legacy global profile listing

Files:

- `src/services/web-server.ts`
- `src/services/api-handlers.ts`
- `src/services/storage/postgres/profile-repository.ts`

Finding:

`/api/user-profiles` is still exposed to any authenticated principal and returns all active profile IDs via `profileRepo.getAllActiveProfiles()`.

Why it matters:

This violates the v2 model where user API keys should operate through active Memory Banks, and it leaks cross-user bank/profile existence.

Recommended fix:

Remove the route or make it admin-only. Add a negative route test proving user API keys receive `403` or `404`.

### 2. `/api/client/stats` returns global counts without Memory Bank scope

Files:

- `src/services/web-server.ts`
- `src/services/api-handlers.ts`
- `src/services/storage/postgres/client-repository.ts`
- `plugin/src/services/remote-client.ts`
- `plugin-codex/src/http-client.ts`

Finding:

`/api/client/stats` still returns global memory/prompt counts by `clientId` for any authenticated key. The route does not require admin authorization or `X-Memory-Bank-ID`, and clients still expose `getClientStats()` methods for the legacy route.

Why it matters:

This contradicts the scoped stats contract already added to `/api/client/connect` and can leak cross-bank aggregate activity.

Recommended fix:

Delete the legacy route/client methods, or require bank authorization and route to `getClientStatsForBank`. Prefer removal if no v2 caller needs the legacy endpoint.

### 3. AI session uniqueness ignores Memory Bank ownership

Files:

- `src/services/storage/postgres/migrations.ts`
- `src/services/storage/postgres/ai-session-repository.ts`

Finding:

AI session uniqueness is still `(session_id, provider)`, and `createSession()` upserts on that pair without `api_key_id` and `memory_bank_id`.

Why it matters:

Two Memory Banks using the same provider and session ID can collide, overwrite metadata, and break bank isolation.

Recommended fix:

Make AI session uniqueness bank-scoped, for example `(api_key_id, memory_bank_id, session_id, provider)`. Add tests proving the same `session_id/provider` can exist independently in two Memory Banks.

### 4. Active Memory Bank selection is unstable

Files:

- `plugin/src/index-remote.ts`
- `plugin-codex/src/mcp/tools.ts`
- `plugin-codex/src/hooks/runner.ts`

Finding:

OpenCode and Codex currently choose the first returned Memory Bank. OpenCode constructs a state key but does not persist or use it. Codex similarly falls back to `memoryBanks[0]`.

Why it matters:

When one API key owns multiple banks, memory operations can be routed to the wrong bank.

Recommended fix:

Add explicit active Memory Bank selection. Low-risk options:

- support configured `memoryBankId` in OpenCode/Codex config;
- persist per-project active bank by state key;
- expose a tool or magic prompt path to activate a specific bank.

### 5. Codex MCP tools reconnect on every memory operation

Files:

- `plugin-codex/src/mcp/tools.ts`
- `src/services/api-handlers.ts`

Finding:

Most Codex MCP memory operations call `/api/client/connect`, which upserts client metadata and lists banks each time.

Why it matters:

Agent loops can turn memory use into repeated DB writes and bank-list reads.

Recommended fix:

Cache active Memory Bank context per MCP server process with a short TTL or refresh only on explicit `memory_connect`.

### 6. WebUI duplicates initial/admin data loads

File:

- `src/web/app.js`

Finding:

`loadAdminState()` calls `loadMemoryBanksForActiveKey()`, which hydrates tags, memories, and stats. Startup and settings save also trigger the same loads.

Why it matters:

Startup/settings can double-hit `/api/tags`, `/api/memories`, and `/api/stats`.

Recommended fix:

Split bank-list loading from active-bank hydration, or add a `hydrate=false` option.

### 7. Bank-filtered vector search still relies on global HNSW indexes

Files:

- `src/services/storage/postgres/memory-repository.ts`
- `src/services/storage/postgres/migrations.ts`

Finding:

Vector search filters by `memory_bank_id` but uses global HNSW indexes plus btree bank indexes.

Why it matters:

Large multi-bank datasets may degrade in latency or recall depending on planner behavior and bank selectivity.

Recommended fix:

Add `EXPLAIN ANALYZE` fixtures with many banks. Consider partitioning by bank or a scoped candidate strategy for large tenants.

### 8. Prompt search uses `%LIKE%` within bank scope

File:

- `src/services/storage/postgres/prompt-repository.ts`

Finding:

Prompt search uses `%LIKE%` on prompt content.

Why it matters:

`/api/search` also searches prompts, so large Memory Banks can scan prompt content.

Recommended fix:

Add `pg_trgm` GIN indexing on `user_prompts.content` or migrate prompt search to full-text search.

## Minor

### 1. Memory Bank deletion emptiness check runs sequential counts

File:

- `src/services/storage/postgres/memory-bank-repository.ts`

Recommended fix:

Combine emptiness checks with one SQL query or run independent counts concurrently.

### 2. Bundle-boundary test builds plugin inside the test

File:

- `tests/plugin-bundle-boundary.test.ts`

Recommended fix:

Make the plugin build an explicit precheck or move the test to an integration category to reduce suite variance.

### 3. Codex MCP tools test emits a fatal tag-migration log while passing

File:

- `plugin-codex/tests/mcp-tools.test.ts`

Recommended fix:

Mock all required storage factory exports or isolate the side effect that starts tag migration logic.

## Recommended Implementation Order

1. Fix the lazy memory repository proxy owner forwarding and add factory-level contract tests.
2. Remove or admin-gate `/api/user-profiles`; add user-key negative tests.
3. Remove or bank-scope `/api/client/stats`; remove stale client methods if route is deleted.
4. Make AI session uniqueness bank-scoped and add cross-bank tests.
5. Add explicit active Memory Bank selection for OpenCode and Codex.
6. Apply low-risk optimizations for Codex reconnects and WebUI duplicate loads.
7. Track larger database performance work separately: vector-search strategy and prompt content indexing.

## Verification Baseline

Before audit, commit `748e14b` passed:

- `bun run typecheck:all`
- `bun test --isolate` (`373 pass, 0 fail`)
- `bun run test:codex-plugin` (`59 pass, 0 fail`)
- `bun run build:all`
- `git diff --check`

## Resolution

Implemented in the follow-up fix pass:

- Fixed the lazy `MemoryRepository` proxy in `src/services/storage/factory.ts` so `getById`, `delete`, `deleteMany`, `pin`, and `unpin` forward `owner?: MemoryBankOwner`. Added a factory-level forwarding contract test.
- Admin-gated `/api/user-profiles` at both handler and route layers. User API keys now receive `403`.
- Bank-scoped `/api/client/stats`: the route now requires a user API key plus `X-Memory-Bank-ID`/`memoryBankId`, then calls `getClientStatsForBank`. Plugin client helpers no longer call the legacy global stats route.
- Scoped AI session uniqueness to `(api_key_id, memory_bank_id, session_id, provider)` with migration v16 and aligned `createSession()` upsert conflict handling.
- Added explicit active Memory Bank selection support for OpenCode and Codex via `memoryBankId` config. Codex also accepts `OPENCODE_MEMNET_MEMORY_BANK_ID`. Configured unavailable banks fail closed instead of falling back to the first bank.
- Added short-lived Codex MCP active Memory Bank context caching to avoid reconnecting on every memory operation within one MCP handler process.
- Updated README with `memoryBankId` behavior.

Focused verification run after the fixes:

- `bun test tests/storage/factory-routing.test.ts --isolate` (`4 pass, 0 fail`)
- `bun test tests/v2-memory-bank-routes.test.ts tests/v2-ownership-not-null.test.ts tests/shared-memory-bank.test.ts --isolate` (`17 pass, 0 fail`)
- `bun test plugin-codex/tests/config.test.ts plugin-codex/tests/mcp-tools.test.ts plugin-codex/tests/http-client.test.ts` (`29 pass, 0 fail`)
- `bun test tests/storage/factory-routing.test.ts tests/v2-memory-bank-routes.test.ts tests/v2-ownership-not-null.test.ts tests/shared-memory-bank.test.ts --isolate` (`21 pass, 0 fail`)
- `bun run typecheck:all` (passed)
- `bun test --isolate` (`380 pass, 0 fail`)
- `bun run test:codex-plugin` (`61 pass, 0 fail`)

Deferred:

- WebUI duplicate-load cleanup remains deferred. It is a lower-priority optimization and not required for the Critical/Important authorization and isolation contract fixes.
- Vector-search HNSW strategy and prompt `%LIKE%` performance work remain deferred as larger database performance investigations requiring fixtures and query plans.
