# V2 Auth And Memory Bank Plan Review

Review target: `docs/superpowers/plans/2026-06-26-v2-auth-memory-bank-redesign.md`

Review date: 2026-06-26

Subagents:
- Debugging/execution-risk reviewer: PASS
- Code-review/architecture reviewer: PARTIAL, plan not implementation-ready
- Optimization/performance/scope reviewer: PASS

Memory status:
- All reviewers attempted opencode-memnet memory context/search/capture.
- All attempts returned `Invalid JSON response`.
- No memories were read, added, updated, linked, or forgotten.

## Executive Summary

The plan is valuable but not implementation-ready. The biggest risks are contract/task mismatch, incomplete Memory Bank route coverage, unsafe migration assumptions around legacy `profile_id` columns, incomplete bank authorization for ID-based operations, and performance regressions from per-request auth writes and unscoped startup stats.

The plan should be updated before execution. The updates should add explicit tasks and acceptance checks rather than relying on implementers to infer missing behavior.

## Critical Findings

### 1. Memory Bank Routes Are Declared And Consumed But Not Implemented

Evidence:
- The plan contract declares admin/user Memory Bank routes around lines 117-125.
- Task 4 only adds `/api/admin/api-keys` list/create handlers and routes.
- Later WebUI steps call `/api/admin/api-keys/:id/memory-banks`.
- Later OpenCode plugin steps call `POST /api/memory-banks`.

Risk:
- Task 6, Task 8, and Task 9 will compile against or call routes that do not exist.
- Client no-bank creation and activation cannot work.

Required plan update:
- Add a dedicated task before WebUI/plugin work for:
  - `GET /api/memory-banks`
  - `POST /api/memory-banks`
  - `GET /api/admin/api-keys/:id/memory-banks`
  - `POST /api/admin/api-keys/:id/memory-banks`
- Either implement or explicitly defer:
  - `PATCH /api/admin/api-keys/:id`
  - `POST /api/admin/api-keys/:id/revoke`
  - `PATCH /api/admin/memory-banks/:id`
  - `DELETE /api/admin/memory-banks/:id`
- Add route-level tests for all implemented routes.

### 2. V2 Writes Drop `profileId` Before Legacy Schema Allows It

Evidence:
- Current migrations define `memories.profile_id TEXT NOT NULL`.
- Current migrations define `user_prompts.profile_id TEXT NOT NULL` and `user_prompts.repo_id TEXT NOT NULL`.
- Current migrations define `user_profiles.profile_id TEXT NOT NULL UNIQUE`.
- Task 5 expects new records to omit `profileId`.
- Migration 15 only adds nullable `api_key_id` and `memory_bank_id`; it does not relax or backfill legacy columns.

Risk:
- Inserts into `memories`, `user_prompts`, and possibly `user_profiles` will fail at runtime.
- Tests expecting `profileId` to be undefined will diverge from DB constraints.

Required plan update:
- Add a migration safety step before repository rewrites.
- Choose one explicit strategy:
  - Preferred clean-break strategy: relax/drop legacy `NOT NULL` constraints and uniqueness where incompatible.
  - Compatibility strategy: continue writing deterministic legacy placeholders until final cleanup.
- Add tests for insert behavior after migration.

### 3. Bank Authorization Is Incomplete For ID-Based Operations

Evidence:
- Current handlers fetch by memory/prompt ID and then mutate by ID for delete, update, pin, unpin, cascades, snapshots, and bulk operations.
- Current repository interfaces expose ID-only methods such as `getById`, `delete`, `deleteMany`, `pin`, and `unpin`.
- Task 5 updates list/search/count-like filters but omits these ID-based methods.

Risk:
- A user API key may mutate or inspect a memory in another Memory Bank if it guesses or receives an ID.
- Cascade delete paths can cross bank boundaries.

Required plan update:
- Require Memory Bank scope at repository or handler boundary for all ID-based operations.
- Add scoped methods or post-fetch bank checks for:
  - memory `getById`
  - memory `delete`
  - memory `deleteMany`
  - memory `update`
  - memory `pin`
  - memory `unpin`
  - prompt lookup/delete/cascade paths
  - profile snapshot/changelog paths
- Convert existing cross-profile tests to cross-bank negative tests instead of deleting them.

### 4. Admin Owner Scope Can Insert Invalid UUIDs

Evidence:
- Task 5 proposes `ownerScope()` returning `apiKeyId: ""` for admin principals.
- Migration 15 declares `api_key_id UUID`.
- `handleAddMemory()` uses `owner.apiKeyId` in inserted records.

Risk:
- Admin memory operations can insert empty strings into UUID columns and fail.
- Ownership becomes ambiguous for admin-created memory rows.

Required plan update:
- Resolve the bank first for both admin and user principals.
- Always write the selected Memory Bank owner’s real `apiKeyId`.
- Remove empty-string `apiKeyId` from plan snippets and tests.

### 5. Migration And Delete Semantics Are Unsafe

Evidence:
- The plan adds nullable ownership columns but does not define foreign keys from memory/prompt/profile rows to `memory_banks`.
- The plan does not define backfill behavior for existing data.
- The plan says bank delete should fail when memory rows exist, but the repository `delete(id)` snippet directly deletes.

Risk:
- Orphaned memory rows, accidental bank deletion, inconsistent ownership, and unclear behavior for existing data.

Required plan update:
- Add explicit clean-break migration policy:
  - existing legacy rows remain inaccessible until migrated, or
  - existing rows are assigned to a generated import bank, or
  - database reset is required for this branch.
- Add foreign key/constraint decisions.
- Add delete preflight:
  - count memory and prompt rows for the bank;
  - refuse delete when count > 0;
  - test refusal.

## Important Findings

### 6. Auth Middleware Replacement Leaves Current Call Sites Under-Specified

Evidence:
- Task 3 changes `AuthMiddleware.authenticate()` to async and single-argument.
- Current `web-server.ts` imports `RouteKind` and calls `authenticate(req, routeKind)`.
- Current `startWebServer()` still takes `apiKey` and legacy options.
- Current `server.ts` passes legacy options into `startWebServer()`.

Risk:
- Task 3 will not typecheck unless exact imports, constructor signatures, and call sites are changed together.

Required plan update:
- Expand Task 3 with exact cleanup:
  - remove `RouteKind`;
  - await `authenticate(req)`;
  - update `startWebServer(config, authService)`;
  - update tests that instantiate `WebServer`;
  - remove generated profile fallback lookup.

### 7. Browser CORS Header Contract Is Missing `X-Memory-Bank-ID`

Evidence:
- WebUI and clients will send `X-Memory-Bank-ID`.
- Current CORS `Access-Control-Allow-Headers` omits it in preflight and JSON responses.

Risk:
- Browser WebUI requests fail before reaching handlers.

Required plan update:
- Add `X-Memory-Bank-ID` to CORS allow headers in the same task that introduces the header.
- Add a route test for OPTIONS/preflight or a source assertion test.

### 8. Tags, Maintenance, Tag Migration, And Profile Learning Are Not Fully Converted

Evidence:
- The API contract says tags, maintenance, prompts, profile routes, context, and capture require bank scope.
- Task 5 signature list omits `handleListTags`.
- Current maintenance job scope is `all | profile`.
- Current tag migration service uses unscoped repository methods.

Risk:
- Global/profile-scoped maintenance can affect other banks.
- Tag lists may leak cross-bank metadata.
- Auto-capture/profile learning may continue using profile/repo semantics.

Required plan update:
- Add a route inventory table for every endpoint and whether it is:
  - admin-only global;
  - user-key bank-scoped;
  - public health.
- Add `memoryBank` job scope or make maintenance/tag migration admin-only with tests.
- Add bank-scoped tag list and tag registry behavior.

### 9. Client Connect Keeps Expensive, Unscoped Stats In The Startup Path

Evidence:
- Task 4 retains `upsertClient()`, `getClientStats()`, and bank listing on connect.
- Current `getClientStats()` counts all memories and prompts.
- Codex hooks call connect on hook runs.

Risk:
- Slow startup and hook latency.
- Unscoped stats can leak aggregate information or produce misleading numbers.

Required plan update:
- Make stats optional, e.g. `includeStats=false` by default.
- Omit stats from Codex hook connect calls.
- If stats are retained for welcome toasts, scope them by selected Memory Bank or API key.

### 10. Auth `last_used_at` Writes Will Hit Postgres On Every Request

Evidence:
- `AuthService.authenticateBearer()` calls `touchLastUsed()` for each user API key authentication.
- WebUI auto-refresh and plugin/hook calls can authenticate frequently.

Risk:
- Avoidable write load and row contention.
- Auth path becomes dependent on a non-critical maintenance update.

Required plan update:
- Throttle `last_used_at` writes in SQL:
  - update only when `last_used_at IS NULL OR last_used_at < now() - interval '5 minutes'`;
  - do not fail authentication if touch update fails.

### 11. Planned Indexes Do Not Match Query Shapes

Evidence:
- Plan adds `(api_key_id, memory_bank_id, created_at)` indexes.
- Current memory queries filter by scope/hash/container/tag and sort by recency or vector distance.
- Plan uses optional `OR` filters for admin scope.

Risk:
- Bank-scoped list/search/tag operations can be slower than necessary.
- Optional `OR` filters can prevent index usage.

Required plan update:
- Require resolved `memoryBankId` for all memory operations.
- Pass the resolved bank’s owner `apiKeyId` for admin too.
- Avoid optional-OR ownership filters.
- Add targeted indexes:
  - `(memory_bank_id, scope, scope_hash, created_at DESC)`
  - `(memory_bank_id, container_tag, created_at DESC)`
  - prompt indexes for captured, unanalyzed, and session queries by bank.

### 12. Tests Are Too String-Based And Lose Existing Coverage

Evidence:
- The plan deletes or replaces profile ownership tests with narrower add/list tests.
- WebUI and plugin tests rely heavily on source string assertions.
- Existing tests cover cross-owner delete/update/pin/unpin, cascades, maintenance, search context, and linked prompt behavior.

Risk:
- The implementation can pass tests while leaving bank isolation broken.

Required plan update:
- Convert existing ownership tests to Memory Bank equivalents instead of deleting them.
- Keep source-string tests only as smoke tests.
- Add behavior tests for:
  - cross-bank denied delete/update/pin/unpin;
  - cascade boundaries;
  - search/list/tag isolation;
  - missing bank error;
  - one-time user API-key reveal;
  - no secret logging.

### 13. `SERVER_API_KEY` Config-File Behavior Is Under-Specified

Evidence:
- Project instructions say `SERVER_API_KEY` is read from environment/config.
- Existing `src/config.ts` already has `server.apiKey`.
- Task 1 reads only `env.SERVER_API_KEY`.

Risk:
- Plan conflicts with project instructions and existing config model.

Required plan update:
- Define precedence:
  - env `SERVER_API_KEY` wins;
  - config `server.apiKey` is fallback;
  - both empty fails startup.
- Add tests for env, config fallback, and empty values.

### 14. `ClientConnectResponse` Is Inconsistent

Evidence:
- V2 API contract lists only principal, memory banks, and requires-memory-bank.
- Task 4 response includes legacy `firstTime`, `daysSinceLastSeen`, `welcomeBack`, and `stats`.

Risk:
- Shared DTOs, server handlers, and clients diverge.

Required plan update:
- Decide whether lifecycle fields remain.
- If they remain, add them to `ClientConnectResponse` with optional stats and scoped semantics.
- If they are removed, update Task 4 and plugin welcome behavior.

### 15. Plugin And Codex Test Rewrites Need Exact Expectations

Evidence:
- Current tests assert `profileId` in config, query strings, connect payloads, and MCP tools.
- The plan says “Modify” but gives little exact replacement for many test files.

Risk:
- Implementers may remove tests instead of preserving coverage.

Required plan update:
- Add explicit expected assertions:
  - no `profileId` config;
  - `X-Memory-Bank-ID` header on memory requests;
  - connect response bank selection;
  - missing bank skip/error behavior;
  - magic prompt creates then activates bank;
  - no raw API key in logs/errors.

## Recommended Plan Patch Outline

1. Add a “Review Fixups Applied” section near the top of the plan summarizing the non-negotiable corrections.
2. Update Task 1 for env/config `SERVER_API_KEY` precedence.
3. Update Task 2 migration:
   - legacy column compatibility or constraint relaxation;
   - foreign keys/indexes;
   - delete preflight semantics.
4. Update Task 3 to fully specify `web-server.ts` and `server.ts` auth call-site changes.
5. Expand Task 4 or insert Task 4B for Memory Bank routes and tests.
6. Update Task 5:
   - use resolved bank owner `apiKeyId`;
   - require scope for ID-based operations;
   - include tags, prompts, maintenance, tag migration, profile learning;
   - add CORS header.
7. Update Task 6 for no-bank UI behavior, CORS, and behavior tests.
8. Update Tasks 8 and 9 with exact plugin/Codex test expectations.
9. Update Task 10 to convert, not delete, bank-isolation coverage where possible.
10. Add verification lines for final legacy symbol scan and new bank route tests.

## Subagent Evidence Notes

Debugging reviewer:
- Focused on likely implementation failures.
- Confirmed no `node_modules` in root/plugin/plugin-codex, so no typecheck/tests were run.

Code-review/architecture reviewer:
- Classified result as PARTIAL because the plan is not implementation-ready.
- Highlighted architecture, migration, route, and test coverage concerns.

Optimization reviewer:
- Highlighted performance risks in auth touches, connect stats, optional SQL filters, and missing query-shaped indexes.
