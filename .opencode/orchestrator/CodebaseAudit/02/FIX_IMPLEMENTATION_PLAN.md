# Codebase Audit Fix Implementation Plan

## Source artifacts

- ISSUES.md: .opencode/orchestrator/CodebaseAudit/02/ISSUES.md
- FIX_SPEC.md: .opencode/orchestrator/CodebaseAudit/02/FIX_SPEC.md
- FIX_DESIGN.md: .opencode/orchestrator/CodebaseAudit/02/FIX_DESIGN.md

## Implementation policy

This is a plan only. Do not implement until explicitly instructed.

Implementation must use Red/Green/Refactor for behaviour-changing fixes.

## Phase overview

1. **Phase 1 (DES-003): Startup validation** — Add config validation for MEMORY_MODEL/MEMORY_API_URL. Smallest change, no dependencies.
2. **Phase 1 (DES-004): Error logging** — Improve tag registry failure logging. Small change, no dependencies.
3. **Phase 2 (DES-001): New repository method** — Add `getUntaggedProjectMemories()`. Prerequisite for Phase 3.
4. **Phase 3 (DES-002): Refactor tag migration loop** — Replace broken getAllWithVectors approach with new targeted method. Core fix.
5. **Phase 4: Integration testing** — Verify all fixes work together.

## Issue execution order

| Order | Issue                 | Reason                                                                                |
| ----- | --------------------- | ------------------------------------------------------------------------------------- |
| 1     | ISSUE-003             | Smallest change, no dependencies, improves diagnostics immediately                    |
| 2     | ISSUE-004             | Small change, no dependencies, improves diagnostics                                   |
| 3     | ISSUE-001 + ISSUE-002 | Core fix — requires new repository method (DES-001) then migration refactor (DES-002) |

## Red phase plan

### Red tests for ISSUE-003 (DES-003)

1. Write test: server config validation warns when MEMORY_MODEL is missing
2. Write test: server config validation warns when MEMORY_API_URL is missing
3. Write test: server config validation does NOT warn when both are present

### Red tests for ISSUE-004 (DES-004)

1. Write test: linkMemoryTags failure log includes memoryId and tags fields

### Red tests for ISSUE-001 + ISSUE-002 (DES-001 + DES-002)

1. Write test: `getUntaggedProjectMemories()` returns only untagged project-scoped memories
2. Write test: `getUntaggedProjectMemories()` respects limit and offset
3. Write test: `getUntaggedProjectMemories()` returns empty array when all memories are tagged
4. Write test: tag migration processes memories with non-_project_ containerTag values
5. Write test: tag migration processes memories beyond the first 1000 rows
6. Write test: tag migration loop terminates when no untagged memories remain

## Green phase plan

### Green for ISSUE-003 (DES-003)

1. Add validation logic to `validateServerConfig()` in `src/server-config.ts`
2. Add `_tagMigrationDisabled` flag to config type
3. Add conditional check in `src/server.ts` before calling `runTagMigration()`

### Green for ISSUE-004 (DES-004)

1. Update all 4 `linkMemoryTags()` catch blocks in `src/services/api-handlers.ts` and `src/services/tag-migration-service.ts` to include memoryId and tags in log output

### Green for ISSUE-001 + ISSUE-002 (DES-001 + DES-002)

1. Add `getUntaggedProjectMemories()` method to `src/services/storage/postgres/memory-repository.ts`
2. Add method signature to `src/services/storage/types.ts` interface
3. Wire through `src/services/storage/factory.ts`
4. Refactor `runTagMigration()` in `src/services/tag-migration-service.ts` to use new method with pagination
5. Remove the old `getAllWithVectors()` + in-memory filter code

## Refactor phase plan

1. Extract the batch processing logic from `runTagMigration()` into a helper function for clarity
2. Ensure consistent error handling across all `linkMemoryTags()` call sites
3. Verify no dead code remains from the old getAllWithVectors approach

## Verification plan

1. Run `npm test` — all existing tests pass
2. Run new tests — all new tests pass
3. Manual: insert >1000 memories, verify tag migration processes all untagged project memories
4. Manual: insert memories with non-_project_ containerTag, verify they are processed
5. Manual: start server without MEMORY_MODEL/MEMORY_API_URL, verify clear warning
6. Manual: check server logs for absence of repeated "tag-migration: fatal error" messages

## Per-issue implementation packets

### ISSUE-003 implementation packet (DES-003)

- Objective: Add startup validation for LLM provider config
- Requirements: REQ-003
- Design items: DES-003
- Likely files:
  - `src/server-config.ts` — add validation in `validateServerConfig()`
  - `src/server.ts` — add conditional check before `runTagMigration()`
  - `src/services/config.ts` — add `_tagMigrationDisabled` to config type (if needed)
- Forbidden files: all files not listed above; test files (separate agent)
- Red tests/checks:
  - Config validation warns when memoryModel missing
  - Config validation warns when memoryApiUrl missing
  - Config validation passes when both present
- Green implementation notes:
  - Add check at end of `validateServerConfig()` that logs a warning and sets flag
  - Wrap `runTagMigration()` call in `server.ts` with flag check
  - Use existing log infrastructure
- Refactor notes: None expected — small change
- Verification commands: `npm test`; manual server start without env vars
- Rollback notes: Revert changes to server-config.ts and server.ts
- Risks: Low — purely additive validation logic

### ISSUE-004 implementation packet (DES-004)

- Objective: Improve tag registry failure logging
- Requirements: REQ-004
- Design items: DES-004
- Likely files:
  - `src/services/api-handlers.ts` — 3 catch blocks (handleAddMemory, handleUpdateMemory, handleAutoCapture)
  - `src/services/tag-migration-service.ts` — 1 catch block
- Forbidden files: all files not listed above; test files (separate agent)
- Red tests/checks:
  - Verify log output includes memoryId and tags when linkMemoryTags fails
- Green implementation notes:
  - Add `memoryId` and `tags` fields to each catch block's log call
  - Add `hint` field with guidance about data inconsistency
- Refactor notes: Extract common log pattern into a helper if 4 call sites justify it
- Verification commands: `npm test`
- Rollback notes: Revert log message changes
- Risks: Very low — only affects log output format

### ISSUE-001 + ISSUE-002 implementation packet (DES-001 + DES-002)

- Objective: Fix background tag migration to process all untagged project memories
- Requirements: REQ-001, REQ-002
- Design items: DES-001, DES-002
- Likely files:
  - `src/services/storage/postgres/memory-repository.ts` — add `getUntaggedProjectMemories()`
  - `src/services/storage/types.ts` — add interface method
  - `src/services/storage/factory.ts` — wire method
  - `src/services/tag-migration-service.ts` — refactor `runTagMigration()` to use new method
- Forbidden files:
  - `src/services/api-handlers.ts` — must not change (uses getAllWithVectors for similarity)
  - `src/services/auto-capture-server.ts` — must not change
  - `src/services/storage/postgres/tag-registry.ts` — must not change
  - All Web UI files, plugin files, client files
- Red tests/checks:
  - `getUntaggedProjectMemories()` returns only untagged project-scoped memories
  - `getUntaggedProjectMemories()` respects limit and offset
  - Tag migration processes memories with non-_project_ containerTag
  - Tag migration processes memories beyond first 1000 rows
  - Tag migration loop terminates when no untagged memories remain
- Green implementation notes:
  - Add new SQL method first, then refactor migration loop
  - The pagination approach: always query offset=0 with the new method; as memories get tagged, they're excluded by the WHERE clause, so subsequent queries naturally shrink
  - Use BATCH_SIZE=100 (configurable) for memory efficiency
  - Remove the `containerTag.includes("_project_")` filter entirely
  - Remove the `!r.tags || r.tags.trim() === ""` in-memory filter
  - Keep `countUntagged()` as a status indicator but don't use it for loop control
- Refactor notes:
  - Extract batch processing into a helper function
  - Consider renaming `runTagMigration()` internals for clarity
- Verification commands: `npm test`; manual verification with large dataset
- Rollback notes: Revert tag-migration-service.ts to use getAllWithVectors + filter; remove new method
- Risks:
  - Medium — the migration loop refactor is the most complex change
  - Mitigate by keeping the old code available for quick rollback
  - Test thoroughly with various memory distributions

## Parallelisation guidance

- ISSUE-003 and ISSUE-004 can be implemented in parallel (independent files)
- ISSUE-001 + ISSUE-002 must be sequential: DES-001 (new method) before DES-002 (refactor)
- ISSUE-001 + ISSUE-002 depends on ISSUE-003 being done first (the config validation flag affects whether migration runs)

Recommended execution order:

1. ISSUE-003 + ISSUE-004 in parallel (Red → Green for both)
2. ISSUE-001 + ISSUE-002 sequentially (DES-001 → DES-002, Red → Green → Refactor)
3. Full integration test

## Final verification checklist

- [ ] All existing tests pass (`npm test`)
- [ ] New unit tests for `getUntaggedProjectMemories()` pass
- [ ] New integration tests for tag migration pass
- [ ] Config validation warns when env vars missing
- [ ] Server starts without MEMORY_MODEL/MEMORY_API_URL (graceful skip)
- [ ] Tag registry failure logs include memoryId and tags
- [ ] Tag migration processes ALL untagged project memories (not just first 1000)
- [ ] Tag migration processes memories regardless of containerTag format
- [ ] Auto-capture path (Path A) still works
- [ ] API handlers still work
- [ ] No dead code from old getAllWithVectors approach in tag-migration-service.ts

## Stop conditions

- All acceptance criteria (AC-001 through AC-007) are met
- All existing tests pass
- All new tests pass
- Manual verification confirms tag migration works for all untagged project memories

## Handoff notes

- The `_tagMigrationDisabled` flag in config should be treated as internal/private — not documented as a user-facing setting
- The `getUntaggedProjectMemories()` method returns full records including vectors — consider whether a lighter-weight version (without vectors) is needed for status checks
- The BATCH_SIZE of 100 is a reasonable default but may need tuning for production deployments with very large datasets
- A future enhancement could add a reconciliation job that periodically compares memories.tags with memory_tag_links to detect and fix inconsistencies (deferred from ISSUE-004)

## Reminder / follow-up state

- Active reminder: rem_1780292315623_jirwb — audit in progress
- After implementation: verify auto-capture path is unaffected
- After implementation: check if user's deployment has MEMORY_MODEL/MEMORY_API_URL configured
- After implementation: consider adding database index on (scope, tags) for query performance
