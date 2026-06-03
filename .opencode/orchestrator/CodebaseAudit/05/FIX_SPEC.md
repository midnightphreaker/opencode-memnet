# Codebase Audit Fix Specification

## Source artifacts

- ISSUES.md: .opencode/orchestrator/CodebaseAudit/05/ISSUES.md (17 issues: 5 High, 7 Medium, 3 Low, 2 Informational)

## Scope

Fix the 15 actionable issues (5 High + 7 Medium + 3 Low) identified in the Audit/05 ISSUES.md. The 2 Informational issues (ISSUE-016 and ISSUE-017) are documented but deferred to a future audit.

Focus areas:

1. State management correctness (ISSUE-001, ISSUE-003, ISSUE-013)
2. Data integrity in bulk operations (ISSUE-002)
3. Input validation hardening (ISSUE-004)
4. Test coverage for new storage methods (ISSUE-005)
5. Privacy filtering completeness (ISSUE-006)
6. API consistency (ISSUE-007, ISSUE-008, ISSUE-010, ISSUE-011)
7. Semantic clarity (ISSUE-009)
8. Reliability (ISSUE-012, ISSUE-014)
9. Type safety (ISSUE-015)

## Non-goals

- Do NOT implement rate limiting (ISSUE-017) — deferred to future work
- Do NOT implement isFullyPrivate gate in API handlers (ISSUE-016) — deferred
- Do NOT change the database schema or add migrations
- Do NOT modify the client/plugin code
- Do NOT change the existing API response shape in breaking ways (additive changes only)

## Requirements

- REQ-001: Consolidate migration state into tag-migration-service.ts — api-handlers.ts must query the service for state instead of maintaining its own copy
- REQ-002: Return failedIds array in cascade bulk delete response
- REQ-003: Reset clientRepo to null in ensureInit catch block
- REQ-004: Add field-level length validation for content (max 100KB), containerTag (max 200 chars), userEmail (max 320 chars) in handleAddMemory
- REQ-005: Add unit tests for deleteMany, updateTagsOnly, updateVectorsOnly, getMemoriesWithoutVectors
- REQ-006: Apply stripPrivateContent to existingMemory.content fallback in handleUpdateMemory
- REQ-007: Document the r.memory vs r.content field name difference with a code comment (do NOT rename — breaking change risk too high)
- REQ-008: Move includeAllContainers filtering to SQL-level in repository list() method
- REQ-009: Change "(untagged)" stats label to "(unclassified)"
- REQ-010: Change handleRefreshProfile to return honest placeholder status instead of fabricated "queued" message
- REQ-011: Read version from package.json in health handler instead of hardcoding
- REQ-012: Add in-flight request counter for graceful shutdown drain
- REQ-013: Move migration state declarations above their consuming functions
- REQ-014: Add profileLearningAttempts.delete() call on null AI response path
- REQ-015: Replace top-priority `as any` casts in config.ts and web-server-worker.ts with proper types

## Issue-to-requirement mapping

| Issue     | Requirement IDs |
| --------- | --------------- |
| ISSUE-001 | REQ-001         |
| ISSUE-002 | REQ-002         |
| ISSUE-003 | REQ-003         |
| ISSUE-004 | REQ-004         |
| ISSUE-005 | REQ-005         |
| ISSUE-006 | REQ-006         |
| ISSUE-007 | REQ-007         |
| ISSUE-008 | REQ-008         |
| ISSUE-009 | REQ-009         |
| ISSUE-010 | REQ-010         |
| ISSUE-011 | REQ-011         |
| ISSUE-012 | REQ-012         |
| ISSUE-013 | REQ-013         |
| ISSUE-014 | REQ-014         |
| ISSUE-015 | REQ-015         |
| ISSUE-016 | Deferred        |
| ISSUE-017 | Deferred        |

## Acceptance criteria

- AC-001: Migration state is managed exclusively by tag-migration-service.ts — api-handlers.ts reads state from the service
- AC-002: handleBulkDelete with cascade returns { deleted, total, failedIds } including IDs that failed
- AC-003: ensureInit catch block resets clientRepo to null
- AC-004: handleAddMemory rejects content >100KB, containerTag >200 chars, userEmail >320 chars with 400 status
- AC-005: Tests exist for deleteMany, updateTagsOnly, updateVectorsOnly, getMemoriesWithoutVectors — all pass
- AC-006: handleUpdateMemory applies stripPrivateContent to existingMemory.content fallback
- AC-007: Code comment documents r.memory vs r.content difference in api-handlers.ts
- AC-008: includeAllContainers filtering happens in SQL, not client-side JS
- AC-009: Stats endpoint uses "(unclassified)" label for NULL type values
- AC-010: handleRefreshProfile returns { message: "Profile refresh not yet implemented", unanalyzedPrompts: N }
- AC-011: Health endpoint version matches package.json version
- AC-012: Graceful shutdown tracks in-flight request count during drain
- AC-013: migrationProgress and related declarations appear before handleDetectTagMigration
- AC-014: profileLearningAttempts Map entry cleared on null AI response
- AC-015: config.ts and web-server-worker.ts have zero `as any` casts
- AC-016: All 231+ existing tests continue to pass
- AC-017: TypeScript compiles with zero errors
- AC-018: Docker build succeeds

## Verification expectations

- `bun run test` — all tests pass (including new storage method tests)
- `bun run typecheck` — zero errors
- `bun run format:check` — all files formatted
- `bun run build` — clean build
- `docker build` — successful image build
- Manual check: health endpoint version matches package.json

## Constraints

- No breaking API changes to existing response shapes (additive only)
- No database schema changes or new migrations
- No new dependencies
- All changes must be testable without a running Postgres instance (mocked tests)

## Risks

- REQ-001 (migration state consolidation) is the highest-risk change — touches core state management
- REQ-008 (SQL-level filtering) changes the repository query shape
- REQ-015 (as any removal) may surface hidden type errors

## Out of scope

- ISSUE-016 (isFullyPrivate gate) — deferred
- ISSUE-017 (rate limiting) — deferred
- Performance optimization beyond the SQL filtering fix
- UI/UX changes
- Client/plugin code changes

## Completion definition

All 15 requirements implemented, all 18 acceptance criteria met, all verification commands passing.
