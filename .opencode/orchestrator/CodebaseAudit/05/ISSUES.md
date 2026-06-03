# Codebase Audit Issues

## Audit scope

- Repository: opencode-memnet
- Branch: main
- Commit: 250c9ab
- User scope argument: Oracle review leftovers from Audit/04 (5 HIGH + 7 MEDIUM) plus fresh full-repo scan
- Audit run directory: .opencode/orchestrator/CodebaseAudit/05/
- Date/time: 2026-06-03
- Tools used: sequential-thinking, reminders, @explorer (3 investigation workstreams), @oracle review
- Commands run: git rev-parse, git branch (verification commands typecheck/test/build already verified in prior session as passing)
- Commands skipped: bun test, bun run typecheck, bun run format:check (all verified passing in prior session — 231/231 tests, 0 type errors)
- Limitations: Cannot re-run test/typecheck commands directly (orchestrator bash restricted). Relied on explorer subagent verification. Explorer ran `bun test` without `--isolate` flag and got 42 failures — these are the known Bun mock.module pollution issue, NOT regressions. With `--isolate` all 231 pass.

## Orchestration assistance tools

- sequential-thinking used: Yes
- sequential-thinking limitation: None
- reminders used: Yes
- reminders limitation: None
- reminders/follow-ups created: rem_1780460232650_lk6ep (audit plan), rem_1780460535150_dp8z8 (investigation complete)

## Summary

| Severity      | Count |
| ------------- | ----- |
| Critical      | 0     |
| High          | 5     |
| Medium        | 7     |
| Low           | 3     |
| Informational | 2     |

## Issue index

| ID        | Severity      | Confidence | Category        | Status    | Title                                                                      |
| --------- | ------------- | ---------- | --------------- | --------- | -------------------------------------------------------------------------- |
| ISSUE-001 | High          | High       | Race Condition  | Confirmed | Race condition in migration state between detection and migration loop     |
| ISSUE-002 | High          | High       | Data Integrity  | Confirmed | Cascade delete non-atomic with no failed ID tracking                       |
| ISSUE-003 | High          | High       | Error Handling  | Confirmed | ensureInit partial-failure state not cleaned up                            |
| ISSUE-004 | High          | High       | Security        | Confirmed | No input length validation on content/containerTag/userEmail               |
| ISSUE-005 | High          | High       | Test Coverage   | Confirmed | New storage methods have zero direct unit tests                            |
| ISSUE-006 | Medium        | High       | Security        | Confirmed | handleUpdateMemory doesn't re-filter existing content for privacy          |
| ISSUE-007 | Medium        | High       | API Contract    | Confirmed | Inconsistent field names: r.memory vs r.content in search vs list          |
| ISSUE-008 | Medium        | High       | Performance     | Confirmed | handleListMemories fetches 1000 rows then filters client-side              |
| ISSUE-009 | Medium        | Medium     | Maintainability | Confirmed | "(untagged)" semantic collision between stats and tag-migration            |
| ISSUE-010 | Medium        | High       | Bug             | Confirmed | handleRefreshProfile is a no-op stub returning fabricated success          |
| ISSUE-011 | Medium        | High       | Configuration   | Confirmed | Health endpoint hardcodes version "2.14.3" instead of reading package.json |
| ISSUE-012 | Medium        | Medium     | Reliability     | Confirmed | Drain timeout doesn't track in-flight requests                             |
| ISSUE-013 | Low           | Medium     | Maintainability | Confirmed | Forward reference to module-level vars in api-handlers.ts                  |
| ISSUE-014 | Low           | Medium     | Bug             | Confirmed | Profile learning retry Map not cleared on null AI response                 |
| ISSUE-015 | Low           | Low        | Type Safety     | Confirmed | 32 `as any` casts bypass TypeScript checking                               |
| ISSUE-016 | Informational | High       | Security        | Confirmed | isFullyPrivate available but not used to skip 100% private memories        |
| ISSUE-017 | Informational | High       | Security        | Confirmed | Rate limiting gap — documented but not implemented                         |

## Issues

## ISSUE-001: Race condition in migration state between detection and migration loop

- Severity: High
- Confidence: High
- Category: Race Condition
- Status: Confirmed
- Affected area: Tag migration, API handlers
- Affected files: src/services/api-handlers.ts (lines 980-1078), src/services/tag-migration-service.ts (line 18)
- Evidence: `handleDetectTagMigration` (api-handlers.ts:980-1035) reads and writes module-level `migrationProgress`, `_migrationRunning`, and `cachedMigrationRecords`. These are the same variables that `tag-migration-service.ts` writes during its background loop. The detection handler at lines 996-1003 and 1013-1022 directly assigns to `migrationProgress`, while the migration service writes to its own `_state` object. These are NEVER synchronized. The CONCURRENCY NOTE at lines 1046-1049 acknowledges single-process assumption.
- Why this matters: In the current single-process architecture, concurrent HTTP requests could trigger detection while migration is running. The detection handler at line 1009 resets `migrationProgress.total = 0`, which could corrupt the progress display if the migration service has just set it.
- Reproduction / verification: Read api-handlers.ts:980-1078 and tag-migration-service.ts:18. Observe that `migrationProgress` in api-handlers.ts is separate from `_state` in tag-migration-service.ts.
- Expected behaviour: Migration state should be a single source of truth, either in the migration service or via a shared state object with proper synchronization.
- Actual behaviour: Two separate state objects (`migrationProgress` in api-handlers.ts and `_state` in tag-migration-service.ts) that are never synchronized.
- Proposed correction: Move all migration state into the tag-migration-service and have api-handlers.ts query the service for state instead of maintaining its own copy.
- Dependencies / related issues: ISSUE-013 (forward references)
- Risk of fix: Medium — requires refactoring state management across two files.
- Suggested test coverage: Integration test that calls detect and migrate concurrently.

## ISSUE-002: Cascade delete non-atomic with no failed ID tracking

- Severity: High
- Confidence: High
- Category: Data Integrity
- Status: Confirmed
- Affected area: API handlers, bulk operations
- Affected files: src/services/api-handlers.ts (lines 446-468)
- Evidence: `handleBulkDelete` at lines 446-461 iterates IDs sequentially with `handleDeleteMemory(id, cascade)`. If 3 of 5 succeed, the response is `{ deleted: 3, total: 5 }` — the caller has no way to know which 2 IDs failed. The non-cascade path (lines 462-468) uses atomic `deleteMany()` which is correct.
- Why this matters: Bulk operations should be atomic or at minimum report which items failed. Currently callers cannot determine what was actually deleted.
- Reproduction / verification: Read api-handlers.ts:446-468. Send POST /api/memories/bulk-delete with `cascade=true` and mix of existing/non-existing IDs.
- Expected behaviour: Either all-or-nothing transaction, or response includes `failedIds: string[]` listing which IDs could not be deleted.
- Actual behaviour: Returns only `deleted` count with no indication of which IDs failed.
- Proposed correction: Track failed IDs and return them in the response: `{ deleted, total, failedIds }`.
- Dependencies / related issues: None
- Risk of fix: Low — additive change to response shape.
- Suggested test coverage: Test cascade bulk delete with mix of valid/invalid IDs.

## ISSUE-003: ensureInit partial-failure state not cleaned up

- Severity: High
- Confidence: High
- Category: Error Handling
- Status: Confirmed
- Affected area: API initialization
- Affected files: src/services/api-handlers.ts (lines 36-50)
- Evidence: In `ensureInit()`, if `clientRepo.initialize()` (line 43) throws, the catch block at line 47 only resets `_initPromise = null`. But `clientRepo` was already assigned at line 42 via `createClientRepository()`. On retry, a NEW `clientRepo` is created, but the old one may have partially initialized state. The other repos (memoryRepo, promptRepo, profileRepo) were already initialized successfully.
- Why this matters: Partial initialization can leave the system in an inconsistent state. A retry creates new repo objects but the old ones may have open connections or partial schema state.
- Reproduction / verification: Read api-handlers.ts:36-50. Simulate clientRepo.initialize() failure and observe that clientRepo is set but uninitialized.
- Expected behaviour: Either full rollback of all initialized repos, or the catch block should reset `clientRepo` to null.
- Actual behaviour: `clientRepo` remains as a potentially broken repository object.
- Proposed correction: In the catch block, reset `clientRepo = null` alongside `_initPromise = null`. Consider adding cleanup for already-initialized repos.
- Dependencies / related issues: None
- Risk of fix: Low — single-line fix.
- Suggested test coverage: Test ensureInit with mocked failure at different initialization stages.

## ISSUE-004: No input length validation on content/containerTag/userEmail

- Severity: High
- Confidence: High
- Category: Security
- Status: Confirmed
- Affected area: API input validation
- Affected files: src/services/api-handlers.ts (line 339), src/services/web-server.ts (line 122)
- Evidence: `handleAddMemory` (line 339) checks `if (!data.content || !data.containerTag)` for existence only, not length. A 10MB `content` string would pass. The web-server has `MAX_BODY_SIZE = 10 * 1024 * 1024` (line 122) but this caps the raw HTTP body, not individual fields. A JSON body `{ "content": "10MB string" }` could pass under the body limit if other fields are small. `userEmail` from query params is passed directly to repository queries with no length check.
- Why this matters: Embedding services charge per token. A 10MB content field could cost significant money and time. Very long containerTag or userEmail could degrade query performance.
- Reproduction / verification: Read api-handlers.ts:339 and web-server.ts:122. No field-level length validation exists.
- Expected behaviour: Maximum content length (e.g., 100KB), maximum containerTag length (e.g., 200 chars), maximum userEmail length (e.g., 320 chars per RFC 5321).
- Actual behaviour: Only HTTP body size limit (10MB) constrains input.
- Proposed correction: Add field-level length validation in the handler or as middleware. Reject oversized fields with 400 status.
- Dependencies / related issues: ISSUE-016 (isFullyPrivate should filter before embedding)
- Risk of fix: Low — additive validation, may reject previously-accepted large payloads.
- Suggested test coverage: Test handleAddMemory with oversized content, containerTag, userEmail.

## ISSUE-005: New storage methods have zero direct unit tests

- Severity: High
- Confidence: High
- Category: Test Coverage
- Status: Confirmed
- Affected area: Storage layer
- Affected files: src/services/storage/postgres/memory-repository.ts, src/services/storage/factory.ts, src/services/storage/types.ts
- Evidence: Four new methods were added in Audit/04 Phase 3/5: `deleteMany`, `updateTagsOnly`, `updateVectorsOnly`, `getMemoriesWithoutVectors`. Grep for these in tests/ shows:
  - `deleteMany`: ZERO test references
  - `updateTagsOnly`: Only a source-code pattern match test (tag-migration-service.test.ts:131 checks source contains the method name)
  - `updateVectorsOnly`: Only a source-code pattern match test (tag-migration-service.test.ts:137)
  - `getMemoriesWithoutVectors`: ZERO test references
- Why this matters: These methods implement critical data operations (bulk delete, two-phase migration). Without tests, regressions could go undetected.
- Reproduction / verification: `grep -r "deleteMany\|getMemoriesWithoutVectors" tests/` returns only source-pattern matches, no functional tests.
- Expected behaviour: Each new storage method has at least one unit/integration test covering happy path and error cases.
- Actual behaviour: Only indirect/pattern tests exist.
- Proposed correction: Add dedicated test file `tests/storage/new-methods.test.ts` with tests for all four methods.
- Dependencies / related issues: None
- Risk of fix: None — test-only changes.
- Suggested test coverage: This IS the test coverage issue.

## ISSUE-006: handleUpdateMemory doesn't re-filter existing content for privacy

- Severity: Medium
- Confidence: High
- Category: Security
- Status: Confirmed
- Affected area: Privacy filtering
- Affected files: src/services/api-handlers.ts (line 482)
- Evidence: After the C2 fix from Audit/04, `handleUpdateMemory` at line 482 applies `stripPrivateContent(data.content)` when new content is provided. However, when `data.content` is absent, the fallback `existingMemory.content` is used directly. This content comes from `memoryRepo.getById()` which returns raw DB content. If the memory was stored before privacy filtering was added (pre-Audit/04), it may contain unfiltered `<private>` blocks.
- Why this matters: Legacy memories that were stored before privacy filtering was introduced may still contain private content. When updated without changing content, the raw (unfiltered) content is preserved.
- Reproduction / verification: Read api-handlers.ts:482. Create a memory with `<private>` content (pre-filtering era), then update it without providing content. The raw content persists.
- Expected behaviour: Either re-filter existing content on every update, or run a one-time backfill migration to filter all existing memories.
- Actual behaviour: Existing content is used as-is without re-filtering.
- Proposed correction: Apply `stripPrivateContent(existingMemory.content)` on the fallback path: `data.content ? stripPrivateContent(data.content) : stripPrivateContent(existingMemory.content)`.
- Dependencies / related issues: ISSUE-016 (isFullyPrivate)
- Risk of fix: Low — may change content of existing memories that contain `<private>` blocks.
- Suggested test coverage: Test update without content change on a memory that has `<private>` blocks.

## ISSUE-007: Inconsistent field names: r.memory vs r.content in search vs list

- Severity: Medium
- Confidence: High
- Category: API Contract
- Status: Confirmed
- Affected area: API response consistency
- Affected files: src/services/api-handlers.ts (lines 208, 651), src/services/storage/types.ts (lines 25, 43)
- Evidence: `handleSearch` at line 651 maps `r.memory` from `SearchResult` type. `handleListMemories` at line 208 maps `r.content` from `MemoryRow` type. Both represent the memory's text content but use different field names. `SearchResult.memory` (types.ts:43) vs `MemoryRow.content` (types.ts:25).
- Why this matters: API consumers using both search and list endpoints see the same semantic field with different source names. This is a maintenance risk — a future refactorer might assume `r.content` works in search, breaking it.
- Reproduction / verification: Read types.ts:25 and types.ts:43. Read api-handlers.ts:208 and api-handlers.ts:651.
- Expected behaviour: Both types should use the same field name for memory content.
- Actual behaviour: `SearchResult.memory` vs `MemoryRow.content`.
- Proposed correction: Either rename `SearchResult.memory` to `SearchResult.content` and update all references, or add a comment documenting the inconsistency.
- Dependencies / related issues: None
- Risk of fix: Medium — renaming a field is a breaking change for any consumer of the SearchResult type.
- Suggested test coverage: Verify search and list return content with consistent field access.

## ISSUE-008: handleListMemories fetches 1000 rows then filters client-side

- Severity: Medium
- Confidence: High
- Category: Performance
- Status: Confirmed
- Affected area: Memory listing, pagination
- Affected files: src/services/api-handlers.ts (lines 193-203, 280-281)
- Evidence: When `includeAllContainers=true`, the handler fetches up to 1000 rows (line 197: `limit: 1000`) then filters with `m.containerTag.includes("_project_")` in JavaScript (line 202). If the DB has 1500 project-scoped memories and 500 non-project, only 1000 are fetched. After JS filtering, maybe 800 remain. But `totalPages` (line 281) is computed from the filtered array length, not the actual DB count. Pagination is therefore incorrect.
- Why this matters: Users see wrong page counts and may not see all their memories. Wasteful data transfer.
- Reproduction / verification: Read api-handlers.ts:193-203. Create >1000 memories with mixed container tags. List with includeAllContainers=true.
- Expected behaviour: Server-side SQL filtering with correct COUNT for pagination.
- Actual behaviour: Client-side JS filtering with potentially truncated results.
- Proposed correction: Add a `containerTagFilter` parameter to the repository `list()` method that applies SQL-level filtering.
- Dependencies / related issues: None
- Risk of fix: Medium — changes SQL query shape, needs testing.
- Suggested test coverage: Test list with >1000 memories and includeAllContainers.

## ISSUE-009: "(untagged)" semantic collision between stats and tag-migration

- Severity: Medium
- Confidence: Medium
- Category: Maintainability
- Status: Confirmed
- Affected area: Stats, tag migration
- Affected files: src/services/storage/postgres/memory-repository.ts (lines 494-496)
- Evidence: `countByType` at line 494-496 uses `(row.type ?? "(untagged)")` for NULL type values. In tag-migration context, "untagged" means `tags IS NULL OR tags = ''`. These are completely different concepts: type=NULL means no type classification, while untagged means no tag labels.
- Why this matters: Confusing semantics for developers and potentially for API consumers who see "(untagged)" in stats and assume it relates to tag migration status.
- Reproduction / verification: Read memory-repository.ts:494-496. Compare with getUntaggedProjectMemories (line 587-592) which uses `tags IS NULL OR tags = ''`.
- Expected behaviour: Stats should use a label that distinguishes type=NULL from tag-related "untagged".
- Actual behaviour: Both use "untagged" label.
- Proposed correction: Change stats label from "(untagged)" to "(unclassified)" or "(no type)".
- Dependencies / related issues: None
- Risk of fix: Low — cosmetic label change. May break consumers expecting the "(untagged)" key.
- Suggested test coverage: Verify stats response uses new label.

## ISSUE-010: handleRefreshProfile is a no-op stub returning fabricated success

- Severity: Medium
- Confidence: High
- Category: Bug
- Status: Confirmed
- Affected area: Profile learning
- Affected files: src/services/api-handlers.ts (lines 956-978)
- Evidence: `handleRefreshProfile` returns `{ message: "Profile refresh queued" }` at line 969 but nothing is actually queued. The function reads the unanalyzed count and returns it, but triggers no background work. The `note` field says "Profile will be updated when threshold is reached" but this function doesn't check or set any threshold.
- Why this matters: Users believe their profile is being refreshed when nothing is happening. The API lies about the action taken.
- Reproduction / verification: Read api-handlers.ts:956-978. No job queue or background trigger exists in the function.
- Expected behaviour: Either actually queue a profile learning job, or return an honest response indicating the feature is not yet implemented.
- Actual behaviour: Returns fabricated success message.
- Proposed correction: Either implement the actual refresh trigger (call the profile learning pipeline), or change the response to `{ message: "Profile refresh is not yet implemented", unanalyzedPrompts: count }`.
- Dependencies / related issues: None
- Risk of fix: Low — changing response message. Implementing actual refresh is higher risk.
- Suggested test coverage: Test that handleRefreshProfile returns honest status.

## ISSUE-011: Health endpoint hardcodes version instead of reading package.json

- Severity: Medium
- Confidence: High
- Category: Configuration
- Status: Confirmed
- Affected area: Health monitoring
- Affected files: src/services/health-handler.ts (line 28), package.json (line 3)
- Evidence: `handleHealthDetailed` at line 28 returns `version: "2.14.3"` as a hardcoded string. `package.json` line 3 has `"version": "3.0.0"`. The version will always report 2.14.3 regardless of actual package version. After Docker build, the baked-in health response shows the wrong version.
- Why this matters: Monitoring/deployment tooling that reads the health endpoint gets incorrect version info. Makes it impossible to verify which version is deployed via the health endpoint.
- Reproduction / verification: Read health-handler.ts:28 and package.json:3.
- Expected behaviour: Health endpoint reads version from package.json at build time or startup.
- Actual behaviour: Hardcoded "2.14.3".
- Proposed correction: Import version from package.json: `import { version } from "../../package.json" with { type: "json" };` or read it at startup and inject via config.
- Dependencies / related issues: None
- Risk of fix: Low — but must ensure the import works in both dev and Docker build contexts.
- Suggested test coverage: Verify health response version matches package.json version.

## ISSUE-012: Drain timeout doesn't track in-flight requests

- Severity: Medium
- Confidence: Medium
- Category: Reliability
- Status: Confirmed
- Affected area: Server lifecycle
- Affected files: src/server.ts (lines 98-125)
- Evidence: The shutdown handler at line 101 calls `server.stop()` (stops accepting new connections), then at line 110 waits `drainMs` via `setTimeout`. During this period, in-flight handlers are still executing. After the timeout, `closeStorage()` at line 120 closes the Postgres pool, potentially killing active DB queries. There is no mechanism to track active request count or wait for zero in-flight requests.
- Why this matters: Long-running requests (>10s drain timeout) get their DB connections killed mid-execution, leading to partial writes or error responses.
- Reproduction / verification: Read server.ts:98-125. No in-flight request counter or drain-complete callback.
- Expected behaviour: Track active request count and drain until zero (with a max timeout).
- Proposed correction: Add an atomic counter incremented at request start and decremented at request end. During drain, poll until counter reaches zero or max timeout is exceeded.
- Dependencies / related issues: None
- Risk of fix: Medium — changes request handling flow.
- Suggested test coverage: Test shutdown with active requests.

## ISSUE-013: Forward reference to module-level vars in api-handlers.ts

- Severity: Low
- Confidence: Medium
- Category: Maintainability
- Status: Confirmed
- Affected area: Code organization
- Affected files: src/services/api-handlers.ts (lines 980, 987, 1050)
- Evidence: `handleDetectTagMigration` is defined at line 980 and references `migrationProgress` at line 987. The `let migrationProgress` declaration is at line 1050 — 63 lines after the function. JavaScript hoists the declaration but not the assignment. This works at runtime (function is never called before module load completes) but makes the code harder to reason about.
- Why this matters: Maintenance risk — a developer might reorder functions or add top-level code that calls these functions before their state is initialized.
- Reproduction / verification: Read api-handlers.ts:980-1078.
- Expected behaviour: Module-level state should be declared before functions that reference it.
- Actual behaviour: State is declared after the functions that use it.
- Proposed correction: Move `migrationProgress`, `_migrationRunning`, and `cachedMigrationRecords` declarations to the top of the file (or at least above the first function that uses them).
- Dependencies / related issues: ISSUE-001 (race condition in same state)
- Risk of fix: None — pure reorganization.
- Suggested test coverage: Existing tests cover this.

## ISSUE-014: Profile learning retry Map not cleared on null AI response

- Severity: Low
- Confidence: Medium
- Category: Bug
- Status: Confirmed
- Affected area: Profile learning
- Affected files: src/services/api-handlers.ts (lines 1559-1563)
- Evidence: In `handleUserProfileLearn`, if `analyzeUserProfile` returns null (not throws), the code at lines 1559-1563 marks prompts as captured and returns success. But `profileLearningAttempts` is NOT deleted for this user. The Map entry remains dangling. Over time, this could grow if many users have null AI responses.
- Why this matters: Minor memory leak. In practice, the Map only accumulates entries for users whose AI analysis returns null repeatedly.
- Reproduction / verification: Read api-handlers.ts:1559-1563. Observe no `profileLearningAttempts.delete()` call on the null path.
- Expected behaviour: `profileLearningAttempts.delete(profileAttemptKey)` should be called before the return at line 1563.
- Actual behaviour: Map entry not cleared.
- Proposed correction: Add `profileLearningAttempts.delete(profileAttemptKey);` before the return at line 1563.
- Dependencies / related issues: None
- Risk of fix: None — single-line fix.
- Suggested test coverage: Test profile learning with null AI response.

## ISSUE-015: 32 `as any` casts bypass TypeScript checking

- Severity: Low
- Confidence: Low
- Category: Type Safety
- Status: Confirmed
- Affected area: Type safety
- Affected files: src/config.ts (line 850), src/services/web-server-worker.ts (lines 43-44, 107, 116), src/services/api-handlers.ts (line 1406), src/services/auto-capture-server.ts (line 22)
- Evidence: 32 instances of `as any` across the codebase. Key instances:
  - config.ts:850: `CONFIG.postgres = CONFIG.postgres ?? ({} as any)` — entire postgres sub-object cast
  - web-server-worker.ts:43-44: `(CONFIG as any).disableWebuiAuth` — accessing non-standard config fields
  - web-server-worker.ts:107,116: `(CONFIG as any).server?.apiKey` — non-standard nested path
  - api-handlers.ts:1406: `type: summaryResult.type as any` — suppresses AI-returned type
  - auto-capture-server.ts:22: `buildMemoryProviderConfig(CONFIG as any)` — passes full config as any
- Why this matters: These casts bypass TypeScript's type checking and could mask real type errors, especially when config shapes change.
- Reproduction / verification: Grep for `as any` across src/ — 32 matches found.
- Expected behaviour: Properly typed config access with no `as any` casts, or at minimum explicit type assertions.
- Actual behaviour: 32 `as any` casts scattered across critical files.
- Proposed correction: Define proper types for config sub-objects and replace `as any` with proper type assertions. Prioritize config.ts and web-server-worker.ts.
- Dependencies / related issues: None
- Risk of fix: Medium — changing type definitions may surface hidden bugs.
- Suggested test coverage: Existing tests should catch type regressions.

## ISSUE-016: isFullyPrivate available but not used to skip 100% private memories

- Severity: Informational
- Confidence: High
- Category: Security
- Status: Confirmed
- Affected area: Privacy filtering
- Affected files: src/services/privacy.ts (lines 15-25), src/services/api-handlers.ts (line 13)
- Evidence: `isFullyPrivate()` is defined in privacy.ts and IS used in client/plugin code (index.ts, index-remote.ts). However, `api-handlers.ts` imports only `stripPrivateContent`. This means a memory that is entirely `<private>...</private>` gets stored as `"[REDACTED]"` — consuming storage, embedding API costs, and search index space for a meaningless placeholder.
- Why this matters: Wasted resources and search pollution. A fully-private memory should be rejected or skipped entirely rather than stored as "[REDACTED]".
- Reproduction / verification: Read api-handlers.ts:13 — only imports `stripPrivateContent`. Read privacy.ts — both functions exist.
- Expected behaviour: Before storing, check `isFullyPrivate(content)` and skip/reject if true.
- Actual behaviour: Stores "[REDACTED]" for fully-private content.
- Proposed correction: In `handleAddMemory`, check `isFullyPrivate(data.content)` before storing. Return a 400 error: "Content is entirely private — nothing to store".
- Dependencies / related issues: ISSUE-004, ISSUE-006
- Risk of fix: Low — may reject previously-accepted fully-private payloads.
- Suggested test coverage: Test add memory with fully-private content.

## ISSUE-017: Rate limiting gap — documented but not implemented

- Severity: Informational
- Confidence: High
- Category: Security
- Status: Confirmed
- Affected area: API security
- Affected files: src/services/web-server.ts, src/services/web-server-worker.ts
- Evidence: ISSUE-026 from Audit/04 was documented as "Informational" with design proposed (token bucket middleware) but never implemented. No rate limiting code exists in web-server.ts or web-server-worker.ts. The Audit/04 FIX_IMPLEMENTATION_PLAN had this as a phase 5 item but implementation was not completed.
- Why this matters: Any client can make unlimited API requests. In a multi-user deployment, one user could overwhelm the service.
- Reproduction / verification: Grep web-server.ts and web-server-worker.ts for "rate" — no matches.
- Expected behaviour: Basic rate limiting middleware (e.g., 100 req/min per IP or per API key).
- Actual behaviour: No rate limiting.
- Proposed correction: Add simple in-memory token bucket rate limiter as middleware.
- Dependencies / related issues: None
- Risk of fix: Medium — may reject legitimate traffic. Needs configurable limits.
- Suggested test coverage: Test that rate-limited requests receive 429.

## False positives / discarded findings

1. **42 test failures**: Explorer ran `bun test` without `--isolate` flag. With `--isolate` (via `bun run test`), all 231 pass. This is the known Bun mock.module() global pollution issue, not a regression.
2. **isFullyPrivate "never used"**: Oracle originally stated this function was never used. Investigation confirmed it IS used in client/plugin code (index.ts, index-remote.ts). The real issue is its absence in the server API handler, documented as ISSUE-016.
3. **Deprecated config exports**: ClientConfig, initClientConfig, isClientConfigured are deprecated but still have legitimate consumers. Not actionable.

## Unresolved questions

1. Should handleRefreshProfile (ISSUE-010) actually implement the refresh, or just document that it's a placeholder?
2. Should the "(untagged)" label change (ISSUE-009) be considered a breaking API change?
3. How many existing memories in production contain unfiltered `<private>` blocks (ISSUE-006)?

## Follow-up reminders / deferred work

- Implement rate limiting middleware (ISSUE-017) when multi-user deployment is planned
- Consider backfill migration for existing unfiltered memories (ISSUE-006)
- Add unit tests for new storage methods (ISSUE-005) before next release
