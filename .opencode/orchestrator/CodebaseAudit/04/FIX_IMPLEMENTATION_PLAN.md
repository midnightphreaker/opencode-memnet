# Codebase Audit Fix Implementation Plan

## Source artifacts

- ISSUES.md: ./.opencode/orchestrator/CodebaseAudit/04/ISSUES.md
- FIX_SPEC.md: ./.opencode/orchestrator/CodebaseAudit/04/FIX_SPEC.md
- FIX_DESIGN.md: ./.opencode/orchestrator/CodebaseAudit/04/FIX_DESIGN.md

## Implementation policy

This is a plan only. Do not implement until explicitly instructed.

Implementation must use Red/Green/Refactor for behaviour-changing fixes:

1. **Red**: Write failing test or verification check that demonstrates the issue
2. **Green**: Make minimum change to pass the test/verification
3. **Refactor**: Clean up the implementation while keeping tests green

## Phase overview

The implementation is organized into 5 phases, ordered by dependency and risk:

| Phase   | Focus                      | Issues                                                                                            | Estimated Changes |
| ------- | -------------------------- | ------------------------------------------------------------------------------------------------- | ----------------- |
| Phase 1 | Quick wins & build fixes   | ISSUE-001, ISSUE-010, ISSUE-014, ISSUE-015, ISSUE-024, ISSUE-025                                  | 6 small changes   |
| Phase 2 | Security & privacy         | ISSUE-002, ISSUE-007, ISSUE-009, ISSUE-017, ISSUE-018, ISSUE-030                                  | 6 medium changes  |
| Phase 3 | Error handling & recovery  | ISSUE-005, ISSUE-006, ISSUE-008, ISSUE-011, ISSUE-012, ISSUE-013, ISSUE-019, ISSUE-020, ISSUE-021 | 9 medium changes  |
| Phase 4 | Test suite & CI            | ISSUE-003, ISSUE-004                                                                              | 2 large changes   |
| Phase 5 | API improvements & cleanup | ISSUE-016, ISSUE-022, ISSUE-026, ISSUE-027, ISSUE-028, ISSUE-029, ISSUE-031                       | 7 changes         |

## Issue execution order

| Order | Issue     | Reason                                        |
| ----- | --------- | --------------------------------------------- |
| 1     | ISSUE-001 | Critical — Docker build is broken             |
| 2     | ISSUE-010 | Build correctness — build script fragile      |
| 3     | ISSUE-014 | Documentation — quick win                     |
| 4     | ISSUE-015 | Dependency cleanup — quick win                |
| 5     | ISSUE-024 | Install script — quick win                    |
| 6     | ISSUE-025 | README path — quick win                       |
| 7     | ISSUE-002 | Security — data leaks to clients              |
| 8     | ISSUE-007 | Security — info disclosure                    |
| 9     | ISSUE-009 | Security — potential SQL injection            |
| 10    | ISSUE-017 | Security — default password                   |
| 11    | ISSUE-018 | Security — unpinned CDN deps                  |
| 12    | ISSUE-030 | Security — auth comparison                    |
| 13    | ISSUE-005 | Error handling — infinite retry loop          |
| 14    | ISSUE-006 | Data loss — memory lost on DB failure         |
| 15    | ISSUE-008 | Error handling — silent migration failures    |
| 16    | ISSUE-011 | Error handling — config silent failure        |
| 17    | ISSUE-012 | Config — empty postgres.url                   |
| 18    | ISSUE-013 | Error handling — dedup undercount             |
| 19    | ISSUE-019 | Error handling — profile retry loop           |
| 20    | ISSUE-020 | Resource — vector leak                        |
| 21    | ISSUE-021 | Error handling — corrupt profile              |
| 22    | ISSUE-003 | Tests — fix 45 failing tests                  |
| 23    | ISSUE-004 | CI — add quality gates (depends on ISSUE-003) |
| 24    | ISSUE-016 | Dependency — zod version alignment            |
| 25    | ISSUE-022 | API — bulk delete atomicity                   |
| 26    | ISSUE-026 | Docs — concurrency documentation              |
| 27    | ISSUE-028 | Lifecycle — graceful shutdown                 |
| 28    | ISSUE-029 | API — memory pagination                       |
| 29    | ISSUE-031 | API — search query length                     |

## Red phase plan

For each behavior-changing fix, write failing tests first:

### Phase 1 Red (Quick wins — no tests needed)

- ISSUE-001: Verify `docker build .` fails with current Dockerfile
- ISSUE-010: Verify `bun run build` fails when `src/web/` is empty
- ISSUE-014, ISSUE-015, ISSUE-024, ISSUE-025: Manual verification

### Phase 2 Red (Security)

- ISSUE-002: Write test that submits `<private>secret</private>` via API, verify it's returned unfiltered
- ISSUE-007: Write test that `/api/health` returns version/DB status without auth
- ISSUE-009: Write test with SQL injection payload in search query
- ISSUE-017: Write test that docker-compose starts with default password
- ISSUE-018: Verify CDN URLs contain `@latest`
- ISSUE-030: Write timing comparison test (optional — hard to test deterministically)

### Phase 3 Red (Error handling)

- ISSUE-005: Write test that auto-capture retries indefinitely on AI failure
- ISSUE-006: Write test that auto-capture loses summary on DB failure
- ISSUE-008: Write test that tag migration continues after AI failure threshold
- ISSUE-011: Write test that server starts with malformed config
- ISSUE-012: Write test that empty postgres.url passes validation
- ISSUE-013: Write test that dedup undercounts on partial delete failure
- ISSUE-019: Write test that profile learning retries indefinitely on AI failure
- ISSUE-020: Write test that vectors are recomputed on migration retry
- ISSUE-021: Write test that corrupt profile is silently skipped

### Phase 4 Red (Tests & CI)

- ISSUE-003: Run `bun test` — capture 45 failures as baseline
- ISSUE-004: Verify CI workflow has no test/lint/format steps

### Phase 5 Red (API improvements)

- ISSUE-016: Verify zod version mismatch in lockfiles
- ISSUE-022: Write test that bulk delete is partial on mid-batch failure
- ISSUE-026: Verify module-level state has no concurrency documentation
- ISSUE-028: Write test that shutdown interrupts in-flight request
- ISSUE-029: Write test that list memories returns only 1000 rows silently
- ISSUE-031: Write test that search accepts unlimited query length

## Green phase plan

### Phase 1 Green (Quick wins)

- ISSUE-001: Change `bun.lockb*` to `bun.lock` in Dockerfile line 3
- ISSUE-010: Change `cp -r src/web/* dist/web/` to `cp -r src/web/. dist/web/ || true` in package.json
- ISSUE-014: Update codemap.md legacy file description
- ISSUE-015: Remove shadcn from package.json devDependencies, run `bun install`
- ISSUE-024: Update git clone URL in install-server.sh
- ISSUE-025: Fix README.md logo path

### Phase 2 Green (Security)

- ISSUE-002: Import and apply `stripPrivateContent` in `handleAddMemory`, `handleAutoCapture`, `handleListMemories`, `handleSearch`
- ISSUE-007: Create minimal health response for unauthenticated, detailed for authenticated
- ISSUE-009: Verify postgres library parameterization; fix if needed
- ISSUE-017: Remove `:-opencode` fallback from docker-compose POSTGRES_PASSWORD
- ISSUE-018: Pin CDN versions in src/web/index.html
- ISSUE-030: Use `crypto.timingSafeEqual` in auth.ts

### Phase 3 Green (Error handling)

- ISSUE-005: Add retry counter and prompt marking to handleAutoCapture
- ISSUE-006: Wrap memoryRepo.insert in retry logic, add recovery mechanism
- ISSUE-008: Add failure threshold and tracking to tag-migration-service
- ISSUE-011: Throw on config parse failure in loadConfigFromPaths
- ISSUE-012: Add trim() and URL format validation to postgres.url
- ISSUE-013: Track failed deletes in handleDeduplicate response
- ISSUE-019: Add retry counter and prompt marking to handleUserProfileLearn
- ISSUE-020: Separate tag marking from vector generation in migration
- ISSUE-021: Add profileStatus diagnostic to handleContextInject response

### Phase 4 Green (Tests & CI)

- ISSUE-003: Fix each failing test file (mock setup, import fixes, scenario fixes)
- ISSUE-004: Add test, format, and plugin build steps to CI workflow

### Phase 5 Green (API improvements)

- ISSUE-016: Add zod resolution to root package.json
- ISSUE-022: Add deleteMany method to storage layer, use in handleBulkDelete
- ISSUE-026: Add concurrency documentation comments
- ISSUE-028: Add drain period to server shutdown
- ISSUE-029: Add pagination to handleListMemories
- ISSUE-031: Add query length validation to search endpoint

## Refactor phase plan

After all green implementations pass:

1. Review all error handling additions for consistency (retry patterns, error response formats)
2. Consolidate shared retry/marking logic if auto-capture and profile learning use similar patterns
3. Review API response format changes for consistency (new fields follow same naming convention)
4. Clean up any temporary test fixtures or mocks added during red phase

## Verification plan

### Per-phase verification

- Phase 1: `bun run build`, `docker build .`, manual doc review
- Phase 2: `bun test` (new security tests), manual endpoint testing
- Phase 3: `bun test` (new error handling tests), `bun run typecheck`
- Phase 4: `bun test` (all 231+ pass), CI workflow run
- Phase 5: `bun test` (new API tests), `bun run typecheck`

### Final verification

1. `bun test` — all tests pass
2. `bun run typecheck` — no type errors
3. `bun run build` — build succeeds
4. `bun run build:plugin` — plugin build succeeds
5. `docker build .` — Docker build succeeds
6. `bun run format:check` — all files formatted
7. Manual smoke test: start server, verify health endpoint, create/retrieve memory, search

## Per-issue implementation packets

### ISSUE-001 implementation packet

- Objective: Fix Dockerfile lockfile COPY pattern
- Requirements: REQ-001
- Design items: DES-001
- Likely files: `Dockerfile`
- Forbidden files: All source code
- Red tests/checks: `docker build .` should fail with frozen lockfile
- Green implementation notes: Change line 3 from `bun.lockb*` to `bun.lock`
- Refactor notes: None needed
- Verification commands: `docker build .`
- Rollback notes: Revert single line change
- Risks: None

### ISSUE-002 implementation packet

- Objective: Apply privacy filtering in API handlers
- Requirements: REQ-002
- Design items: DES-002
- Likely files: `src/services/api-handlers.ts`, `shared/privacy.ts`
- Forbidden files: `shared/privacy.ts` (don't change filtering logic, just use it)
- Red tests/checks: Write test submitting `<private>secret</private>` via add-memory and verifying it's returned in list/search
- Green implementation notes: Import stripPrivateContent, apply before storage and before API response
- Refactor notes: Consider a middleware approach if many handlers need filtering
- Verification commands: `bun test`
- Rollback notes: Remove filtering calls
- Risks: May strip legitimate content containing angle brackets

### ISSUE-003 implementation packet

- Objective: Fix all 45 failing tests
- Requirements: REQ-003
- Design items: DES-003
- Likely files: `tests/config.test.ts`, `tests/config-resolution.test.ts`, `tests/server-config-llm-validation.test.ts`, `tests/storage/factory-routing.test.ts`, `tests/storage/getUntaggedProjectMemories.test.ts`, `tests/tool-scope.test.ts`
- Forbidden files: Source code (fix tests, not source — unless tests reveal actual bugs)
- Red tests/checks: `bun test` captures 45 failures
- Green implementation notes: Fix mocks, imports, test setup for each failing file
- Refactor notes: Standardize test setup patterns across test files
- Verification commands: `bun test`
- Rollback notes: Revert test changes
- Risks: May discover real code bugs that need separate fixes

### ISSUE-004 implementation packet

- Objective: Add quality gates to CI workflow
- Requirements: REQ-004
- Design items: DES-004
- Likely files: `.github/workflows/release.yml`
- Forbidden files: Source code
- Red tests/checks: Verify CI workflow has no test/lint steps
- Green implementation notes: Add bun test, format:check, build:plugin steps
- Refactor notes: Consider adding a separate PR-check workflow
- Verification commands: Push to branch, verify CI runs all checks
- Rollback notes: Remove added CI steps
- Risks: CI will fail until ISSUE-003 is fixed — implement ISSUE-003 first

### ISSUE-005 implementation packet

- Objective: Add retry counting to auto-capture
- Requirements: REQ-005
- Design items: DES-005
- Likely files: `src/services/api-handlers.ts`
- Forbidden files: Database schema files
- Red tests/checks: Test that auto-capture retries indefinitely on AI failure
- Green implementation notes: Add retry counter field to prompts, check before processing, mark as failed after max retries
- Refactor notes: Extract retry logic into shared utility (used by ISSUE-019 too)
- Verification commands: `bun test`
- Rollback notes: Remove retry counter check
- Risks: May need new DB column for retry count

### ISSUE-006 implementation packet

- Objective: Persist auto-capture summary on DB failure
- Requirements: REQ-006
- Design items: DES-006
- Likely files: `src/services/api-handlers.ts`
- Forbidden files: Database schema files (unless adding recovery table)
- Red tests/checks: Test that summary is lost when memoryRepo.insert throws
- Green implementation notes: Wrap insert in retry with backoff. Consider recovery file/table.
- Refactor notes: May overlap with ISSUE-005 retry logic
- Verification commands: `bun test`
- Rollback notes: Remove retry/recovery logic
- Risks: Recovery mechanism adds complexity

### ISSUE-007 implementation packet

- Objective: Reduce health endpoint information disclosure
- Requirements: REQ-007
- Design items: DES-007
- Likely files: `src/services/health-handler.ts`, `src/services/web-server.ts`
- Forbidden files: None
- Red tests/checks: Test that /api/health returns version without auth
- Green implementation notes: Return minimal { status: "ok" } without auth. Add /api/health/details for authenticated full info.
- Refactor notes: None
- Verification commands: `bun test`, manual curl
- Rollback notes: Restore original health handler
- Risks: May break external monitoring scripts

### ISSUE-008 implementation packet

- Objective: Add failure threshold to tag migration
- Requirements: REQ-008
- Design items: DES-008
- Likely files: `src/services/tag-migration-service.ts`
- Forbidden files: Database schema files
- Red tests/checks: Test that migration continues after >10 failures
- Green implementation notes: Track consecutive failures, pause after threshold
- Refactor notes: None
- Verification commands: `bun test`
- Rollback notes: Remove failure tracking
- Risks: Migration may pause too aggressively

### ISSUE-009 implementation packet

- Objective: Verify/fix SQL injection in prompt search
- Requirements: REQ-009
- Design items: DES-009
- Likely files: `src/services/storage/postgres/prompt-repository.ts`
- Forbidden files: None
- Red tests/checks: Test search with SQL metacharacters
- Green implementation notes: Verify postgres library parameterization. Fix if needed.
- Refactor notes: None
- Verification commands: `bun test`
- Rollback notes: Revert parameterization change
- Risks: Low if library already parameterizes

### ISSUE-010 implementation packet

- Objective: Fix build script for empty web directory
- Requirements: REQ-010
- Design items: DES-010
- Likely files: `package.json`
- Forbidden files: Source code
- Red tests/checks: Build fails when src/web/ is empty
- Green implementation notes: Change glob to `src/web/.` with `|| true`
- Refactor notes: None
- Verification commands: `bun run build`
- Rollback notes: Revert build script
- Risks: None

### ISSUE-011 implementation packet

- Objective: Add fast-fail for config parse failures
- Requirements: REQ-011
- Design items: DES-011
- Likely files: `src/config.ts`
- Forbidden files: None
- Red tests/checks: Test that server starts with malformed config
- Green implementation notes: Throw descriptive error when config file exists but fails to parse
- Refactor notes: None
- Verification commands: `bun test`
- Rollback notes: Restore silent fallback
- Risks: May break deployments relying on silent fallback

### ISSUE-012 implementation packet

- Objective: Stricter postgres.url validation
- Requirements: REQ-012
- Design items: DES-012
- Likely files: `src/server-config.ts`
- Forbidden files: None
- Red tests/checks: Test that empty/whitespace postgres.url passes validation
- Green implementation notes: Add trim() check and URL format validation
- Refactor notes: None
- Verification commands: `bun test`
- Rollback notes: Revert to simple falsy check
- Risks: None

### ISSUE-013 implementation packet

- Objective: Report deduplication failures in response
- Requirements: REQ-013
- Design items: DES-013
- Likely files: `src/services/api-handlers.ts`
- Forbidden files: None
- Red tests/checks: Test that dedup response doesn't include failure info
- Green implementation notes: Track failed IDs, include in response
- Refactor notes: None
- Verification commands: `bun test`
- Rollback notes: Remove failure tracking from response
- Risks: None

### ISSUE-014 implementation packet

- Objective: Fix documentation accuracy
- Requirements: REQ-014
- Design items: DES-014
- Likely files: `codemap.md`
- Forbidden files: Source code
- Red tests/checks: Verify codemap claims src/index.ts is "Removed"
- Green implementation notes: Update codemap to say "Kept as reference, excluded from build"
- Refactor notes: None
- Verification commands: Manual review
- Rollback notes: Revert documentation
- Risks: None

### ISSUE-015 implementation packet

- Objective: Remove unused shadcn dependency
- Requirements: REQ-015
- Design items: DES-015
- Likely files: `package.json`
- Forbidden files: Source code
- Red tests/checks: Verify shadcn is in devDependencies
- Green implementation notes: Remove from package.json, run bun install
- Refactor notes: None
- Verification commands: `bun install`, `bun run build`
- Rollback notes: Re-add to devDependencies
- Risks: None

### ISSUE-016 implementation packet

- Objective: Align zod versions between server and plugin
- Requirements: REQ-016
- Design items: DES-016
- Likely files: `package.json`
- Forbidden files: Plugin source code
- Red tests/checks: Verify version mismatch in lockfiles
- Green implementation notes: Add resolutions field to root package.json
- Refactor notes: None
- Verification commands: `bun install`, `bun test`, `bun run build:plugin`
- Rollback notes: Remove resolution override
- Risks: Plugin may have compatibility issues with newer zod

### ISSUE-017 implementation packet

- Objective: Remove default postgres password
- Requirements: REQ-017
- Design items: DES-017
- Likely files: `docker-compose.yml`
- Forbidden files: Source code
- Red tests/checks: Verify default password "opencode" in compose file
- Green implementation notes: Remove `:-opencode` fallback
- Refactor notes: None
- Verification commands: `docker compose config`
- Rollback notes: Restore default fallback
- Risks: Existing deployments may need .env update

### ISSUE-018 implementation packet

- Objective: Pin CDN dependency versions
- Requirements: REQ-018
- Design items: DES-018
- Likely files: `src/web/index.html`
- Forbidden files: Server source code
- Red tests/checks: Verify @latest tags in CDN URLs
- Green implementation notes: Pin jsonrepair and lucide to specific versions
- Refactor notes: None
- Verification commands: Open WebUI in browser
- Rollback notes: Revert to @latest
- Risks: Need to manually update when upgrading

### ISSUE-019 implementation packet

- Objective: Add retry counting to profile learning
- Requirements: REQ-019
- Design items: DES-019
- Likely files: `src/services/api-handlers.ts`
- Forbidden files: None
- Red tests/checks: Test that profile learning retries indefinitely on AI failure
- Green implementation notes: Same pattern as ISSUE-005 — mark prompts after max retries
- Refactor notes: Extract shared retry logic with ISSUE-005
- Verification commands: `bun test`
- Rollback notes: Remove retry counter
- Risks: Same as ISSUE-005

### ISSUE-020 implementation packet

- Objective: Separate tag and vector generation in migration
- Requirements: REQ-020
- Design items: DES-020
- Likely files: `src/services/tag-migration-service.ts`
- Forbidden files: Database schema files
- Red tests/checks: Test that vectors are recomputed on retry
- Green implementation notes: Mark memory as tagged immediately after tag generation, separate vector step
- Refactor notes: None
- Verification commands: `bun test`
- Rollback notes: Merge steps back together
- Risks: Memories with tags but no vectors have degraded search

### ISSUE-021 implementation packet

- Objective: Add corrupt profile diagnostic
- Requirements: REQ-021
- Design items: DES-021
- Likely files: `src/services/api-handlers.ts`
- Forbidden files: None
- Red tests/checks: Test that corrupt profile is silently skipped
- Green implementation notes: Add profileStatus field to response
- Refactor notes: None
- Verification commands: `bun test`
- Rollback notes: Remove diagnostic field
- Risks: None

### ISSUE-022 implementation packet

- Objective: Add transaction wrapping for bulk delete
- Requirements: REQ-022
- Design items: DES-022
- Likely files: `src/services/storage/postgres/memory-repository.ts`, `src/services/api-handlers.ts`
- Forbidden files: None
- Red tests/checks: Test that bulk delete is partial on failure
- Green implementation notes: Add deleteMany method with SQL DELETE WHERE id IN (...) in transaction
- Refactor notes: None
- Verification commands: `bun test`
- Rollback notes: Revert to sequential deletes
- Risks: Transaction may lock rows for duration of batch

### ISSUE-024 implementation packet

- Objective: Fix install script URL
- Requirements: REQ-023
- Design items: DES-023
- Likely files: `scripts/install-server.sh`
- Forbidden files: Source code
- Red tests/checks: Verify wrong URL in script
- Green implementation notes: Update git clone URL to correct repository
- Refactor notes: None
- Verification commands: Read script, verify URL
- Rollback notes: Revert URL
- Risks: None

### ISSUE-025 implementation packet

- Objective: Fix README logo path
- Requirements: REQ-024
- Design items: DES-014
- Likely files: `README.md`
- Forbidden files: Source code
- Red tests/checks: Verify docs/logo/logo-banner.svg doesn't exist
- Green implementation notes: Change path to src/web/logo-banner.svg
- Refactor notes: None
- Verification commands: Manual review
- Rollback notes: Revert path
- Risks: None

### ISSUE-026 implementation packet

- Objective: Add rate limiting middleware
- Requirements: REQ-025
- Design items: DES-024
- Likely files: `src/services/web-server.ts`
- Forbidden files: API handler logic
- Red tests/checks: Verify no rate limiting exists
- Green implementation notes: Add simple token bucket rate limiter as middleware
- Refactor notes: Consider extracting to separate module
- Verification commands: `bun test`
- Rollback notes: Remove middleware
- Risks: Default limits may be too aggressive

### ISSUE-027 implementation packet

- Objective: Document concurrency limitations
- Requirements: REQ-026
- Design items: DES-025
- Likely files: `src/services/api-handlers.ts`
- Forbidden files: None
- Red tests/checks: Verify module-level state lacks documentation
- Green implementation notes: Add/update code comments around shared state
- Refactor notes: None
- Verification commands: Code review
- Rollback notes: Remove comments
- Risks: None

### ISSUE-028 implementation packet

- Objective: Add graceful shutdown drain
- Requirements: REQ-027
- Design items: DES-026
- Likely files: `src/server.ts`
- Forbidden files: None
- Red tests/checks: Test that shutdown interrupts in-flight request
- Green implementation notes: Add drain period, set Connection: close header
- Refactor notes: None
- Verification commands: `bun test`
- Rollback notes: Remove drain period
- Risks: Drain period may delay shutdown too long

### ISSUE-029 implementation packet

- Objective: Add memory listing pagination
- Requirements: REQ-028
- Design items: DES-027
- Likely files: `src/services/api-handlers.ts`, `src/services/web-server.ts`
- Forbidden files: Storage layer (use existing limit/offset support)
- Red tests/checks: Test that list silently caps at 1000
- Green implementation notes: Accept page/pageSize params, return paginated response
- Refactor notes: None
- Verification commands: `bun test`
- Rollback notes: Remove pagination, restore hardcoded limit
- Risks: API response format change — backward compatible if using new fields

### ISSUE-030 implementation packet

- Objective: Use constant-time API key comparison
- Requirements: REQ-029
- Design items: DES-028
- Likely files: `src/services/auth.ts`
- Forbidden files: None
- Red tests/checks: Verify string equality is used
- Green implementation notes: Replace with crypto.timingSafeEqual (with length check)
- Refactor notes: None
- Verification commands: `bun test`
- Rollback notes: Revert to string comparison
- Risks: Edge case with different-length keys

### ISSUE-031 implementation packet

- Objective: Add search query length validation
- Requirements: REQ-030
- Design items: DES-029
- Likely files: `src/services/web-server.ts`
- Forbidden files: None
- Red tests/checks: Test that unlimited query length is accepted
- Green implementation notes: Add length check, return 400 if > 1000 chars
- Refactor notes: None
- Verification commands: `bun test`
- Rollback notes: Remove length check
- Risks: None

## Parallelisation guidance

Issues that can be implemented in parallel (no shared files):

**Batch A** (different files, no dependencies):

- ISSUE-001 (Dockerfile)
- ISSUE-010 (package.json build script)
- ISSUE-014 (codemap.md)
- ISSUE-015 (package.json devDeps — different section than build script)
- ISSUE-024 (scripts/install-server.sh)
- ISSUE-025 (README.md)
- ISSUE-017 (docker-compose.yml)
- ISSUE-018 (src/web/index.html)

**Batch B** (all in api-handlers.ts — must be sequential):

- ISSUE-002, ISSUE-005, ISSUE-006, ISSUE-007, ISSUE-013, ISSUE-019, ISSUE-021, ISSUE-029
- Recommend: implement in order, one at a time, with tests passing between each

**Batch C** (storage layer):

- ISSUE-009 (prompt-repository.ts)
- ISSUE-022 (memory-repository.ts)
- Can be parallel with each other, but sequential within each file

**Batch D** (test files):

- ISSUE-003 — fix all failing tests
- Must be done before ISSUE-004 (CI)

**Batch E** (infrastructure):

- ISSUE-004 (CI workflow)
- ISSUE-016 (package.json resolutions — different section than Batch A)
- ISSUE-027 (api-handlers.ts comments — no functional change, safe to merge)
- ISSUE-028 (server.ts)

## Final verification checklist

- [ ] `bun test` — all 231+ tests pass, 0 failures
- [ ] `bun run typecheck` — no type errors
- [ ] `bun run build` — build succeeds
- [ ] `bun run build:plugin` — plugin build succeeds
- [ ] `docker build .` — Docker build succeeds with correct lockfile
- [ ] `bun run format:check` — all files formatted
- [ ] No new TypeScript `any` types introduced
- [ ] No console.log statements in production code (use logger)
- [ ] All new config values have sensible defaults
- [ ] All new API fields are backward-compatible
- [ ] Privacy filtering applied to all memory read/write paths
- [ ] Health endpoint returns minimal info without auth

## Stop conditions

- All 31 issues have been addressed (30 fixed, 1 deferred: ISSUE-023)
- All acceptance criteria (AC-001 through AC-030) are met
- All verification checklist items pass
- CI pipeline runs green

## Handoff notes

1. **ISSUE-003 should be investigated first** — the 45 failing tests may reveal actual code bugs that need to be fixed before other issues
2. **ISSUE-001 is the highest priority** — it blocks all Docker deployments
3. **ISSUE-002 is the highest-priority security fix** — private data is leaking to clients
4. **ISSUE-004 depends on ISSUE-003** — don't add tests to CI until they all pass
5. **ISSUE-023 is deferred** — requires database schema change, should be a separate effort
6. **Phase 3 changes to api-handlers.ts are interdependent** — recommend sequential implementation within that file

## Reminder / follow-up state

- rem_1780413788481_mehz0: Audit plan tracking — will be updated to completed after artifacts are finalized
- Follow-up: Verify ISSUE-009 (SQL injection) against postgres library source
- Follow-up: Verify ISSUE-001 (Dockerfile) with actual Docker build
- Follow-up: Fix ISSUE-003 (tests) before enabling CI (ISSUE-004)
- Follow-up: Plan ISSUE-023 (SHA256 truncation) as separate database migration effort
- Follow-up: Consider privacy filtering migration for existing stored records after ISSUE-002 fix
