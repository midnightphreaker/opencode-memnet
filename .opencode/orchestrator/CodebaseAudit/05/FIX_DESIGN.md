# Codebase Audit Fix Design

## Source artifacts

- ISSUES.md: .opencode/orchestrator/CodebaseAudit/05/ISSUES.md
- FIX_SPEC.md: .opencode/orchestrator/CodebaseAudit/05/FIX_SPEC.md

## Design overview

This fix addresses 15 actionable issues from the CodebaseAudit/05 oracle review follow-up and fresh repo scan. The design prioritizes:

1. **Safety first** — low-risk changes before high-risk refactors
2. **Test coverage** — new tests for untested methods before behavioral changes
3. **Additive changes** — new fields and functions preferred over modifications

The implementation is organized into 4 phases:

- Phase 1: Quick wins (single-line fixes, low risk)
- Phase 2: Validation and safety (input validation, error handling)
- Phase 3: Test coverage (new storage method tests)
- Phase 4: State management refactor (migration state consolidation)

## Affected components

| Component                                          | Issues                                            | Risk                |
| -------------------------------------------------- | ------------------------------------------------- | ------------------- |
| src/services/api-handlers.ts                       | ISSUE-001, 002, 003, 004, 006, 007, 010, 013, 014 | High (many changes) |
| src/services/tag-migration-service.ts              | ISSUE-001                                         | Medium              |
| src/services/storage/postgres/memory-repository.ts | ISSUE-008, 009                                    | Medium              |
| src/services/storage/types.ts                      | ISSUE-008                                         | Low                 |
| src/services/storage/factory.ts                    | ISSUE-008                                         | Low                 |
| src/services/health-handler.ts                     | ISSUE-011                                         | Low                 |
| src/server.ts                                      | ISSUE-012                                         | Medium              |
| src/config.ts                                      | ISSUE-015                                         | Medium              |
| src/services/web-server-worker.ts                  | ISSUE-015                                         | Medium              |
| tests/                                             | ISSUE-005                                         | None                |

## Proposed corrections

### DES-001: Migration state consolidation (REQ-001, ISSUE-001 + ISSUE-013)

**Approach**: Move migration state from api-handlers.ts into tag-migration-service.ts.

1. In tag-migration-service.ts, expose a `getState()` method that returns the current migration state (progress, running, records).
2. In api-handlers.ts, remove module-level `migrationProgress`, `_migrationRunning`, `cachedMigrationRecords` declarations.
3. `handleDetectTagMigration` queries the service via `tagMigrationService.getState()` instead of reading module-level vars.
4. Move the state declarations (currently at api-handlers.ts:1050-1078) to the top of tag-migration-service.ts.
5. This automatically fixes ISSUE-013 (forward references) since the state is no longer in api-handlers.ts.

**Risk**: Medium — touches both files and changes how migration state flows.

### DES-002: Cascade delete failed ID tracking (REQ-002, ISSUE-002)

**Approach**: Track failed IDs in the cascade loop.

1. In `handleBulkDelete`, add a `failedIds: string[]` array.
2. When `handleDeleteMemory(id, cascade)` returns `success: false`, push the ID to `failedIds`.
3. Return `{ success: true, data: { deleted, total: ids.length, failedIds } }`.

**Risk**: Low — additive change to response shape.

### DES-003: ensureInit partial-failure cleanup (REQ-003, ISSUE-003)

**Approach**: Single-line fix.

1. In `ensureInit` catch block (api-handlers.ts:47), add `clientRepo = null as any;` before `_initPromise = null;`.

**Risk**: Low — single-line fix.

### DES-004: Input length validation (REQ-004, ISSUE-004)

**Approach**: Add validation at the start of handleAddMemory.

1. Define constants: `MAX_CONTENT_LENGTH = 100 * 1024`, `MAX_TAG_LENGTH = 200`, `MAX_EMAIL_LENGTH = 320`.
2. In `handleAddMemory`, after the existence check, add length checks.
3. Return 400 with descriptive error message for each violation.

**Risk**: Low — additive validation.

### DES-005: New storage method tests (REQ-005, ISSUE-005)

**Approach**: Create dedicated test file.

1. Create `tests/storage/new-methods.test.ts`.
2. Test `deleteMany` with: empty array, valid IDs, mix of valid/invalid IDs.
3. Test `updateTagsOnly` with: valid ID and tags, invalid ID.
4. Test `updateVectorsOnly` with: valid ID and vectors, invalid ID.
5. Test `getMemoriesWithoutVectors` with: no results, results with missing vectors.
6. Use mocked repository pattern consistent with existing storage tests.

**Risk**: None — test-only changes.

### DES-006: Privacy filtering on existing content fallback (REQ-006, ISSUE-006)

**Approach**: Single-line fix.

1. In `handleUpdateMemory` (api-handlers.ts:482), change:
   `data.content ? stripPrivateContent(data.content) : existingMemory.content`
   to:
   `stripPrivateContent(data.content ? data.content : existingMemory.content)`

**Risk**: Low — applies filtering to content that should have been filtered already.

### DES-007: Document field name inconsistency (REQ-007, ISSUE-007)

**Approach**: Add code comment, do NOT rename.

1. Add a comment at the `SearchResult.memory` field in types.ts explaining it maps to the same content as `MemoryRow.content`.
2. Add a comment at api-handlers.ts:651 noting the field name difference.

**Risk**: None — comment-only change.

### DES-008: SQL-level container filtering (REQ-008, ISSUE-008)

**Approach**: Add optional `containerTagFilter` parameter to repository `list()` method.

1. In `types.ts`, add `containerTagFilter?: string` to the list options.
2. In `memory-repository.ts`, add `AND container_tag LIKE '%' || $containerTagFilter || '%'` when the filter is provided.
3. In `api-handlers.ts`, pass `containerTagFilter: "_project_"` when `includeAllContainers=true` instead of JS-level filtering.
4. Remove the client-side `.filter()` call.

**Risk**: Medium — changes SQL query shape.

### DES-009: Stats label change (REQ-009, ISSUE-009)

**Approach**: Single-string change.

1. In `memory-repository.ts:494-496`, change `(row.type ?? "(untagged)")` to `(row.type ?? "(unclassified)")`.

**Risk**: Low — cosmetic label change. May break consumers expecting "(untagged)" key.

### DES-010: Honest profile refresh status (REQ-010, ISSUE-010)

**Approach**: Change response message.

1. In `handleRefreshProfile` (api-handlers.ts:969-970), change:
   `message: "Profile refresh queued"` → `message: "Profile refresh is not yet implemented"`
   `note: "Profile will be updated when threshold is reached"` → `note: "This endpoint is a placeholder. Profile learning happens automatically."`

**Risk**: Low — response message change only.

### DES-011: Dynamic health version (REQ-011, ISSUE-011)

**Approach**: Read version at module load time.

1. In `health-handler.ts`, add: `import { readFileSync } from "fs";` and read package.json to get version.
2. Or simpler: add a build-time injection. Since the project uses Bun and builds to dist/, read from a relative path.
3. Best approach: `const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf-8"));`
4. Replace hardcoded `"2.14.3"` with the `version` variable.

**Risk**: Low — but must work in both dev and Docker contexts.

### DES-012: In-flight request counter (REQ-012, ISSUE-012)

**Approach**: Add atomic counter.

1. In `server.ts`, add `let activeRequests = 0;`.
2. Wrap the request handler to increment on entry and decrement on response.
3. In the drain period, poll `activeRequests` every 500ms until zero or max timeout.
4. Replace the blind `setTimeout` with the polling loop.

**Risk**: Medium — changes request handling flow.

### DES-013: State declaration reordering (REQ-013, ISSUE-013)

**Note**: This is automatically resolved by DES-001 which moves the state to tag-migration-service.ts. No separate design needed.

### DES-014: Profile learning Map cleanup (REQ-014, ISSUE-014)

**Approach**: Single-line fix.

1. In api-handlers.ts:1559-1563, add `profileLearningAttempts.delete(profileAttemptKey);` before the return.

**Risk**: None — single-line fix.

### DES-015: Remove `as any` casts (REQ-015, ISSUE-015)

**Approach**: Define proper types for config sub-objects.

1. In `config.ts`, define a `PostgresConfig` interface with `url`, `host`, `port`, `database`, `user`, `password` fields.
2. Replace `{} as any` at line 850 with `{} as PostgresConfig`.
3. In `web-server-worker.ts`, define the expected config shape for `server` sub-object.
4. Replace `(CONFIG as any).disableWebuiAuth` with properly typed access.
5. Replace `(CONFIG as any).server?.apiKey` with `(CONFIG.server as ServerConfig | undefined)?.apiKey`.

**Risk**: Medium — may surface hidden type errors.

## Issue / requirement / design mapping

| Issue     | Requirements | Design items                  |
| --------- | ------------ | ----------------------------- |
| ISSUE-001 | REQ-001      | DES-001                       |
| ISSUE-002 | REQ-002      | DES-002                       |
| ISSUE-003 | REQ-003      | DES-003                       |
| ISSUE-004 | REQ-004      | DES-004                       |
| ISSUE-005 | REQ-005      | DES-005                       |
| ISSUE-006 | REQ-006      | DES-006                       |
| ISSUE-007 | REQ-007      | DES-007                       |
| ISSUE-008 | REQ-008      | DES-008                       |
| ISSUE-009 | REQ-009      | DES-009                       |
| ISSUE-010 | REQ-010      | DES-010                       |
| ISSUE-011 | REQ-011      | DES-011                       |
| ISSUE-012 | REQ-012      | DES-012                       |
| ISSUE-013 | REQ-013      | DES-013 (resolved by DES-001) |
| ISSUE-014 | REQ-014      | DES-014                       |
| ISSUE-015 | REQ-015      | DES-015                       |

## Test design

### New test file: tests/storage/new-methods.test.ts (DES-005)

- Test `deleteMany([])` returns 0
- Test `deleteMany(["id1", "id2"])` calls SQL DELETE
- Test `updateTagsOnly` sets tags column
- Test `updateVectorsOnly` sets vector columns
- Test `getMemoriesWithoutVectors` returns memories with null vectors
- All tests use mocked SQL client

### Updated tests

- tests/tag-migration-service.test.ts — update state access tests for DES-001
- tests/api-handlers tests — add cascade bulk delete with failed IDs test (DES-002)
- tests/health tests — verify version from package.json (DES-011)

## Data/config/schema impact

- No database schema changes
- No new migrations
- No new configuration parameters
- No new environment variables

## Security impact

- Positive: REQ-004 adds input length validation (reduces DoS surface)
- Positive: REQ-006 extends privacy filtering to update path
- No negative security impact from any proposed change

## Compatibility impact

- DES-002 adds `failedIds` to bulk delete response — additive, backward-compatible
- DES-009 changes stats label from "(untagged)" to "(unclassified)" — may break consumers parsing the key
- DES-010 changes profile refresh response message — cosmetic, backward-compatible
- All other changes are internal

## Migration/rollback notes

- All changes are code-only, no data migration
- Rollback is straightforward: revert the commit
- DES-009 label change is the only potentially breaking API change — document in release notes

## Risks and mitigations

| Risk                                                 | Mitigation                                    |
| ---------------------------------------------------- | --------------------------------------------- |
| DES-001 migration state refactor may break detection | Comprehensive testing of detect/migrate flow  |
| DES-008 SQL filter change may change query semantics | Test with and without filter, compare results |
| DES-012 request counter may add latency              | Use atomic counter, minimal overhead          |
| DES-015 as any removal may surface type errors       | Incremental removal, fix errors as found      |

## Alternatives considered

1. **For DES-001**: Instead of moving state to service, add synchronization locks → Rejected: adds complexity without solving the architectural issue
2. **For DES-007**: Rename SearchResult.memory to SearchResult.content → Rejected: breaking change for consumers
3. **For DES-012**: Use Bun's built-in drain support → Rejected: Bun server.stop() doesn't support drain callbacks
4. **For DES-015**: Leave `as any` casts and add type assertions → Rejected: doesn't solve the underlying type safety issue
