# Codebase Audit Fix Implementation Plan

## Source artifacts

- ISSUES.md: .opencode/orchestrator/CodebaseAudit/05/ISSUES.md
- FIX_SPEC.md: .opencode/orchestrator/CodebaseAudit/05/FIX_SPEC.md
- FIX_DESIGN.md: .opencode/orchestrator/CodebaseAudit/05/FIX_DESIGN.md

## Implementation policy

This is a plan only. Do not implement until explicitly instructed.

Implementation must use Red/Green/Refactor for behaviour-changing fixes.

All changes must pass: `bun run test` (231+ tests pass), `bun run typecheck` (0 errors), `bun run format:check` (clean), `bun run build` (clean), `docker build` (succeeds).

## Phase overview

| Phase   | Issues                   | Description                       | Risk        | Estimated files |
| ------- | ------------------------ | --------------------------------- | ----------- | --------------- |
| Phase 1 | ISSUE-003, 009, 013, 014 | Quick wins — single-line fixes    | Low         | 2-3             |
| Phase 2 | ISSUE-004, 006, 010, 011 | Validation and safety             | Low         | 3-4             |
| Phase 3 | ISSUE-002, 005, 007      | API consistency and test coverage | Low-Medium  | 4-5             |
| Phase 4 | ISSUE-001, 008, 012, 015 | State management and refactoring  | Medium-High | 6-8             |

## Issue execution order

| Order | Issue     | Reason                                                               |
| ----- | --------- | -------------------------------------------------------------------- |
| 1     | ISSUE-003 | Single-line fix, zero risk, unblocks nothing                         |
| 2     | ISSUE-009 | Single-string change, zero risk                                      |
| 3     | ISSUE-014 | Single-line fix, zero risk                                           |
| 4     | ISSUE-013 | Resolved by ISSUE-001 in Phase 4 (move state out of api-handlers.ts) |
| 5     | ISSUE-004 | Input validation — important security hardening                      |
| 6     | ISSUE-006 | Privacy filtering fix — single-line change                           |
| 7     | ISSUE-010 | Response message change — low risk                                   |
| 8     | ISSUE-011 | Health version fix — low risk                                        |
| 9     | ISSUE-002 | Cascade delete tracking — additive change                            |
| 10    | ISSUE-005 | Test coverage — no source changes                                    |
| 11    | ISSUE-007 | Documentation comment — no source changes                            |
| 12    | ISSUE-001 | Migration state consolidation — highest risk refactor                |
| 13    | ISSUE-008 | SQL-level filtering — medium risk                                    |
| 14    | ISSUE-012 | In-flight request counter — medium risk                              |
| 15    | ISSUE-015 | `as any` removal — may surface type errors                           |

## Red phase plan

### Phase 1 Red: Quick wins

No Red tests needed — these are single-line fixes with existing test coverage.

### Phase 2 Red: Validation and safety

- Write tests for input length validation in handleAddMemory (ISSUE-004)
- Write test for privacy filtering on update fallback (ISSUE-006)
- Write test for handleRefreshProfile honest status (ISSUE-010)
- Write test for health version from package.json (ISSUE-011)

### Phase 3 Red: API consistency and test coverage

- Write test for cascade bulk delete with failed IDs (ISSUE-002)
- Write tests for deleteMany, updateTagsOnly, updateVectorsOnly, getMemoriesWithoutVectors (ISSUE-005)
- Add documentation comments (ISSUE-007 — no Red test needed)

### Phase 4 Red: State management and refactoring

- Write test for migration state consolidation (ISSUE-001)
- Write test for SQL-level container filtering (ISSUE-008)
- Write test for in-flight request counter (ISSUE-012)
- Write tests for type-safe config access (ISSUE-015)

## Green phase plan

### Phase 1 Green: Quick wins

1. ISSUE-003: Add `clientRepo = null as any;` in ensureInit catch block (api-handlers.ts:47)
2. ISSUE-009: Change `"(untagged)"` to `"(unclassified)"` in memory-repository.ts:494
3. ISSUE-014: Add `profileLearningAttempts.delete(profileAttemptKey);` before return at api-handlers.ts:1563
4. ISSUE-013: Deferred to Phase 4 (resolved by ISSUE-001 refactor)

### Phase 2 Green: Validation and safety

1. ISSUE-004: Add `MAX_CONTENT_LENGTH`, `MAX_TAG_LENGTH`, `MAX_EMAIL_LENGTH` constants and validation checks in handleAddMemory
2. ISSUE-006: Wrap fallback content in stripPrivateContent: `stripPrivateContent(data.content || existingMemory.content)`
3. ISSUE-010: Change response message in handleRefreshProfile
4. ISSUE-011: Read version from package.json in health-handler.ts

### Phase 3 Green: API consistency and test coverage

1. ISSUE-002: Track failedIds in handleBulkDelete cascade loop
2. ISSUE-005: Create tests/storage/new-methods.test.ts with all 4 method tests
3. ISSUE-007: Add code comments documenting r.memory vs r.content difference

### Phase 4 Green: State management and refactoring

1. ISSUE-001: Move migration state to tag-migration-service.ts, update api-handlers.ts to query service
2. ISSUE-008: Add containerTagFilter to repository list(), remove client-side filtering
3. ISSUE-012: Add activeRequests counter in server.ts, polling drain
4. ISSUE-015: Define PostgresConfig and ServerConfig types, replace `as any` casts

## Refactor phase plan

After all Green implementations:

1. Run `bun run format` to ensure consistent formatting
2. Review all changes for consistency
3. Ensure no new `as any` casts introduced
4. Verify all tests pass with `bun run test`

## Verification plan

After each phase:

- `bun run typecheck` — must pass
- `bun run test` — all tests must pass

Final verification:

- `bun run typecheck` — zero errors
- `bun run test` — 231+ tests pass
- `bun run format:check` — all files clean
- `bun run build` — clean build
- `docker build -t opencode-memnet:audit05 .` — successful build
- Manual: health endpoint version matches package.json

## Per-issue implementation packets

### ISSUE-001 implementation packet (Phase 4)

- Objective: Consolidate migration state into tag-migration-service.ts
- Requirements: REQ-001
- Design items: DES-001
- Likely files: src/services/api-handlers.ts, src/services/tag-migration-service.ts
- Forbidden files: tests/ (only modify to update state access patterns)
- Red tests: Test that handleDetectTagMigration reads state from service
- Green implementation notes: Expose getState() on tag migration service. Remove module-level vars from api-handlers.ts.
- Refactor notes: Clean up any dead references
- Verification commands: bun run test, bun run typecheck
- Rollback notes: Revert api-handlers.ts and tag-migration-service.ts
- Risks: Medium — state management refactor

### ISSUE-002 implementation packet (Phase 3)

- Objective: Track failed IDs in cascade bulk delete
- Requirements: REQ-002
- Design items: DES-002
- Likely files: src/services/api-handlers.ts
- Forbidden files: None
- Red tests: Test cascade bulk delete with mix of valid/invalid IDs
- Green implementation notes: Add failedIds array, push on failure, return in response
- Refactor notes: None
- Verification commands: bun run test
- Rollback notes: Revert api-handlers.ts
- Risks: Low — additive change

### ISSUE-003 implementation packet (Phase 1)

- Objective: Clean up ensureInit partial-failure state
- Requirements: REQ-003
- Design items: DES-003
- Likely files: src/services/api-handlers.ts
- Forbidden files: None
- Red tests: None needed (existing tests cover)
- Green implementation notes: Add `clientRepo = null as any;` in catch block
- Refactor notes: None
- Verification commands: bun run test
- Rollback notes: Revert single line
- Risks: None

### ISSUE-004 implementation packet (Phase 2)

- Objective: Add field-level input length validation
- Requirements: REQ-004
- Design items: DES-004
- Likely files: src/services/api-handlers.ts
- Forbidden files: None
- Red tests: Test handleAddMemory with oversized content, containerTag, userEmail
- Green implementation notes: Add constants and validation checks after existence check
- Refactor notes: None
- Verification commands: bun run test
- Rollback notes: Revert validation additions
- Risks: Low — may reject previously-accepted large payloads

### ISSUE-005 implementation packet (Phase 3)

- Objective: Add unit tests for new storage methods
- Requirements: REQ-005
- Design items: DES-005
- Likely files: tests/storage/new-methods.test.ts (new)
- Forbidden files: src/ (no source changes)
- Red tests: This IS the test — write tests first
- Green implementation notes: Tests should pass against existing implementations
- Refactor notes: None
- Verification commands: bun run test
- Rollback notes: Delete test file
- Risks: None — test-only

### ISSUE-006 implementation packet (Phase 2)

- Objective: Apply privacy filtering to existing content fallback
- Requirements: REQ-006
- Design items: DES-006
- Likely files: src/services/api-handlers.ts
- Forbidden files: None
- Red tests: Test update without content change on memory with `<private>` blocks
- Green implementation notes: Change ternary to wrap both paths in stripPrivateContent
- Refactor notes: None
- Verification commands: bun run test
- Rollback notes: Revert single line
- Risks: Low

### ISSUE-007 implementation packet (Phase 3)

- Objective: Document r.memory vs r.content inconsistency
- Requirements: REQ-007
- Design items: DES-007
- Likely files: src/services/api-handlers.ts, src/services/storage/types.ts
- Forbidden files: None
- Red tests: None needed (comments only)
- Green implementation notes: Add clarifying comments at SearchResult.memory and at api-handlers.ts:651
- Refactor notes: None
- Verification commands: bun run typecheck
- Rollback notes: Remove comments
- Risks: None

### ISSUE-008 implementation packet (Phase 4)

- Objective: Move includeAllContainers filtering to SQL
- Requirements: REQ-008
- Design items: DES-008
- Likely files: src/services/storage/types.ts, src/services/storage/postgres/memory-repository.ts, src/services/api-handlers.ts
- Forbidden files: None
- Red tests: Test list with includeAllContainers and verify SQL-level filtering
- Green implementation notes: Add containerTagFilter param to list options, implement in SQL
- Refactor notes: Remove client-side .filter() call
- Verification commands: bun run test, bun run typecheck
- Rollback notes: Revert all 3 files
- Risks: Medium — changes SQL query

### ISSUE-009 implementation packet (Phase 1)

- Objective: Change "(untagged)" to "(unclassified)" in stats
- Requirements: REQ-009
- Design items: DES-009
- Likely files: src/services/storage/postgres/memory-repository.ts
- Forbidden files: None
- Red tests: None needed (existing tests may need label update)
- Green implementation notes: Change string literal
- Refactor notes: Update any test expecting "(untagged)" key
- Verification commands: bun run test
- Rollback notes: Revert string
- Risks: Low — may need test updates

### ISSUE-010 implementation packet (Phase 2)

- Objective: Make handleRefreshProfile return honest status
- Requirements: REQ-010
- Design items: DES-010
- Likely files: src/services/api-handlers.ts
- Forbidden files: None
- Red tests: Test that response message is honest
- Green implementation notes: Change message and note strings
- Refactor notes: None
- Verification commands: bun run test
- Rollback notes: Revert strings
- Risks: Low

### ISSUE-011 implementation packet (Phase 2)

- Objective: Read version from package.json dynamically
- Requirements: REQ-011
- Design items: DES-011
- Likely files: src/services/health-handler.ts
- Forbidden files: None
- Red tests: Test that health version matches package.json
- Green implementation notes: Import version from package.json via readFileSync
- Refactor notes: None
- Verification commands: bun run test, bun run typecheck, bun run build
- Rollback notes: Revert to hardcoded version
- Risks: Low — must work in dev and Docker

### ISSUE-012 implementation packet (Phase 4)

- Objective: Track in-flight requests during drain
- Requirements: REQ-012
- Design items: DES-012
- Likely files: src/server.ts
- Forbidden files: None
- Red tests: Test shutdown with active requests
- Green implementation notes: Add atomic counter, polling drain loop
- Refactor notes: None
- Verification commands: bun run test, bun run typecheck
- Rollback notes: Revert server.ts
- Risks: Medium — changes request handling flow

### ISSUE-013 implementation packet (Phase 4)

- Objective: Move state declarations before consuming functions
- Requirements: REQ-013
- Design items: DES-013 (resolved by DES-001)
- Likely files: src/services/api-handlers.ts, src/services/tag-migration-service.ts
- Forbidden files: None
- Red tests: Covered by ISSUE-001 tests
- Green implementation notes: Resolved when migration state moves to tag-migration-service.ts (ISSUE-001)
- Refactor notes: None
- Verification commands: bun run test
- Rollback notes: N/A (resolved by ISSUE-001)
- Risks: None (resolved by ISSUE-001)

### ISSUE-014 implementation packet (Phase 1)

- Objective: Clear profile learning Map on null AI response
- Requirements: REQ-014
- Design items: DES-014
- Likely files: src/services/api-handlers.ts
- Forbidden files: None
- Red tests: None needed (minor fix)
- Green implementation notes: Add profileLearningAttempts.delete() before return
- Refactor notes: None
- Verification commands: bun run test
- Rollback notes: Revert single line
- Risks: None

### ISSUE-015 implementation packet (Phase 4)

- Objective: Remove `as any` casts from config and web-server-worker
- Requirements: REQ-015
- Design items: DES-015
- Likely files: src/config.ts, src/services/web-server-worker.ts
- Forbidden files: None
- Red tests: Test that type-safe access works
- Green implementation notes: Define PostgresConfig and ServerConfig interfaces, replace casts
- Refactor notes: May need to fix surfaced type errors
- Verification commands: bun run test, bun run typecheck
- Rollback notes: Revert type definitions and restore `as any` casts
- Risks: Medium — may surface hidden bugs

## Parallelisation guidance

### Within Phase 1: All 3 fixes can be done in parallel

- ISSUE-003 (ensureInit), ISSUE-009 (stats label), ISSUE-014 (profile Map) are independent

### Within Phase 2: All 4 fixes can be done in parallel

- ISSUE-004 (validation), ISSUE-006 (privacy), ISSUE-010 (profile message), ISSUE-011 (version) are independent

### Within Phase 3: ISSUE-002 and ISSUE-005 can be parallel; ISSUE-007 is sequential (comments)

- ISSUE-002 (cascade delete) and ISSUE-005 (tests) touch different files
- ISSUE-007 (comments) can be done anytime

### Within Phase 4: ISSUE-001 must be first, then ISSUE-008, ISSUE-012, ISSUE-015 can be parallel

- ISSUE-001 changes api-handlers.ts structure — do it first to avoid merge conflicts
- ISSUE-008 (SQL), ISSUE-012 (server), ISSUE-015 (types) are independent after ISSUE-001

## Final verification checklist

- [ ] All 231+ tests pass via `bun run test`
- [ ] TypeScript compiles with 0 errors via `bun run typecheck`
- [ ] All files formatted via `bun run format:check`
- [ ] Build succeeds via `bun run build`
- [ ] Docker build succeeds via `docker build`
- [ ] Health endpoint version matches package.json
- [ ] No new `as any` casts introduced
- [ ] No new TODO/FIXME/HACK comments

## Stop conditions

1. All 15 requirements implemented and verified
2. All 18 acceptance criteria met
3. All verification commands passing
4. Independent code review completed (optional)

## Handoff notes

- Phase 4 (ISSUE-001, ISSUE-008, ISSUE-012, ISSUE-015) is the highest-risk phase
- Consider doing Phase 4 in a separate branch for safety
- ISSUE-013 is automatically resolved by ISSUE-001 — do NOT implement separately
- After implementation, rebuild Docker container and run full E2E test

## Reminder / follow-up state

- rem_1780460232650_lk6ep: Audit plan (can be completed after implementation)
- rem_1780460535150_dp8z8: Investigation complete (can be completed after implementation)
- Future: Implement rate limiting (ISSUE-017) when multi-user deployment is planned
- Future: Implement isFullyPrivate gate (ISSUE-016) in API handlers
- Future: Consider backfill migration for existing unfiltered memories (ISSUE-006)
