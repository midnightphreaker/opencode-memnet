# Codebase Audit Fix Specification

## Source artifacts

- ISSUES.md: ./.opencode/orchestrator/CodebaseAudit/04/ISSUES.md (31 issues: 1 Critical, 7 High, 10 Medium, 7 Low, 6 Informational)

## Scope

Fix the identified issues in the opencode-memnet codebase, focusing on:

1. Build/deployment correctness (ISSUE-001, ISSUE-010)
2. Security and data protection (ISSUE-002, ISSUE-007, ISSUE-009, ISSUE-017, ISSUE-018)
3. Error handling and data loss prevention (ISSUE-005, ISSUE-006, ISSUE-008, ISSUE-011, ISSUE-013, ISSUE-019, ISSUE-020, ISSUE-021)
4. Test suite health (ISSUE-003)
5. CI quality gates (ISSUE-004)
6. Configuration and dependency cleanup (ISSUE-012, ISSUE-014, ISSUE-015, ISSUE-016, ISSUE-024, ISSUE-025)
7. API contract improvements (ISSUE-022, ISSUE-029, ISSUE-031)
8. Informational improvements (ISSUE-026, ISSUE-027, ISSUE-028, ISSUE-030)

## Non-goals

- No feature additions or behavior changes beyond fixing identified issues
- No architectural refactoring beyond what's needed for fixes
- No performance optimization (unless tied to a specific issue)
- No changes to the plugin's opencode-ai SDK integration beyond version alignment
- No migration of legacy files to new architecture (only cleanup or documentation updates)
- No changes to the container tag hashing algorithm (ISSUE-023 deferred — requires DB schema change)
- No multi-process architecture changes (ISSUE-027 informational — acknowledged by codebase)

## Requirements

- REQ-001: Fix Dockerfile COPY pattern to correctly match bun.lock lockfile (ISSUE-001)
- REQ-002: Apply privacy filtering (stripPrivateContent) in API handlers for storage and retrieval (ISSUE-002)
- REQ-003: Fix all 45 failing tests to achieve a passing test suite (ISSUE-003)
- REQ-004: Add test execution, lint/format checks, and plugin build to CI workflow (ISSUE-004)
- REQ-005: Implement retry counting and prompt marking for auto-capture AI failures to prevent infinite loops (ISSUE-005)
- REQ-006: Ensure auto-capture summary persistence on DB insert failure — retry or recover the generated summary (ISSUE-006)
- REQ-007: Reduce health endpoint information disclosure — remove version, DB status, embedding readiness from unauthenticated response (ISSUE-007)
- REQ-008: Add failure threshold and tracking for tag migration AI failures (ISSUE-008)
- REQ-009: Verify postgres library parameterization behavior and fix SQL injection risk if needed (ISSUE-009)
- REQ-010: Fix build script to handle empty web assets directory gracefully (ISSUE-010)
- REQ-011: Add fast-fail behavior for config file parse failures — refuse to start with broken config (ISSUE-011)
- REQ-012: Add stricter postgres.url validation including empty/whitespace checks (ISSUE-012)
- REQ-013: Return partial success details in handleDeduplicate response when individual deletes fail (ISSUE-013)
- REQ-014: Update codemap.md to accurately describe legacy file status or remove legacy files (ISSUE-014)
- REQ-015: Remove unused shadcn devDependency (ISSUE-015)
- REQ-016: Align zod versions between server and plugin workspaces (ISSUE-016)
- REQ-017: Require explicit postgres password in docker-compose — remove insecure default (ISSUE-017)
- REQ-018: Pin all CDN dependencies to specific versions in WebUI (ISSUE-018)
- REQ-019: Add retry counting and prompt marking for profile learning AI failures (ISSUE-019)
- REQ-020: Separate tag generation from vector generation in migration to avoid recomputation (ISSUE-020)
- REQ-021: Add diagnostic flag in context injection response for corrupt profile JSON (ISSUE-021)
- REQ-022: Add database transaction wrapping for bulk delete operations (ISSUE-022)
- REQ-023: Update install-server.sh to clone from the correct repository URL (ISSUE-024)
- REQ-024: Fix README.md logo SVG path to match actual file location (ISSUE-025)
- REQ-025: Add basic rate limiting middleware to web server (ISSUE-026)
- REQ-026: Document module-level state concurrency limitation (ISSUE-027)
- REQ-027: Add graceful shutdown drain period for in-flight requests (ISSUE-028)
- REQ-028: Add pagination support to handleListMemories endpoint (ISSUE-029)
- REQ-029: Use constant-time comparison for API key authentication (ISSUE-030)
- REQ-030: Add max query length validation for search endpoint (ISSUE-031)

## Issue-to-requirement mapping

| Issue     | Requirement IDs                        |
| --------- | -------------------------------------- |
| ISSUE-001 | REQ-001                                |
| ISSUE-002 | REQ-002                                |
| ISSUE-003 | REQ-003                                |
| ISSUE-004 | REQ-004                                |
| ISSUE-005 | REQ-005                                |
| ISSUE-006 | REQ-006                                |
| ISSUE-007 | REQ-007                                |
| ISSUE-008 | REQ-008                                |
| ISSUE-009 | REQ-009                                |
| ISSUE-010 | REQ-010                                |
| ISSUE-011 | REQ-011                                |
| ISSUE-012 | REQ-012                                |
| ISSUE-013 | REQ-013                                |
| ISSUE-014 | REQ-014                                |
| ISSUE-015 | REQ-015                                |
| ISSUE-016 | REQ-016                                |
| ISSUE-017 | REQ-017                                |
| ISSUE-018 | REQ-018                                |
| ISSUE-019 | REQ-019                                |
| ISSUE-020 | REQ-020                                |
| ISSUE-021 | REQ-021                                |
| ISSUE-022 | REQ-022                                |
| ISSUE-023 | (deferred — requires DB schema change) |
| ISSUE-024 | REQ-023                                |
| ISSUE-025 | REQ-024                                |
| ISSUE-026 | REQ-025                                |
| ISSUE-027 | REQ-026                                |
| ISSUE-028 | REQ-027                                |
| ISSUE-029 | REQ-028                                |
| ISSUE-030 | REQ-029                                |
| ISSUE-031 | REQ-030                                |

## Acceptance criteria

- AC-001: `docker build .` succeeds and copies the correct bun.lock file into the image
- AC-002: Content wrapped in `<private>...</private>` tags is stripped before storage and before API response
- AC-003: All 231+ tests pass when running `bun test`
- AC-004: CI workflow runs `bun test`, `bun run format:check`, and `bun run build:plugin` before allowing release
- AC-005: Auto-capture marks prompts as failed after configurable retry count, preventing infinite loops
- AC-006: Auto-capture summary is recoverable after DB insert failure (via retry or recovery table)
- AC-007: `/api/health` returns minimal status without version, DB status, or embedding readiness
- AC-008: Tag migration pauses and logs structured errors after configurable failure threshold
- AC-009: Prompt search queries are verified to use parameterized SQL (no injection risk)
- AC-010: Build script succeeds even when `src/web/` is empty
- AC-011: Server refuses to start with a config file that fails to parse, with clear error message
- AC-012: Empty or whitespace-only postgres.url is rejected at startup validation
- AC-013: handleDeduplicate response includes failure details for unsuccessful deletes
- AC-014: Codemap accurately describes all entry points, including legacy file status
- AC-015: `shadcn` is not present in package.json devDependencies
- AC-016: Server and plugin use compatible zod versions (same major.minor or explicit resolution)
- AC-017: docker-compose.yml requires explicit POSTGRES_PASSWORD (no insecure default)
- AC-018: All CDN script tags in src/web/index.html use pinned version numbers
- AC-019: Profile learning marks prompts as failed after configurable retry count
- AC-020: Tag migration does not recompute vectors for memories that already have tags
- AC-021: Context injection response includes diagnostic flag when profile JSON is corrupt
- AC-022: Bulk delete is wrapped in a database transaction (all-or-nothing)
- AC-023: install-server.sh clones from the correct repository URL
- AC-024: README.md logo path resolves to an existing file
- AC-025: Rate limiting returns HTTP 429 after configurable request threshold
- AC-026: Module-level state concurrency limitation is documented in code comments
- AC-027: Server waits for configurable drain period before closing DB connections on shutdown
- AC-028: handleListMemories supports pagination parameters (page, pageSize)
- AC-029: API key comparison uses crypto.timingSafeEqual
- AC-030: Search endpoint rejects queries longer than configurable max length (default 1000 chars)

## Verification expectations

- All verification via `bun test` (after fix), `bun run typecheck`, `docker build`, and manual endpoint testing
- Each requirement should have at least one test case verifying the fix
- CI workflow should pass end-to-end after all fixes are applied

## Constraints

- Must maintain backward compatibility for existing API consumers (no breaking changes to response format unless adding new fields)
- Must not change database schema for ISSUE-023 (deferred)
- Must not require external dependencies beyond what's already in the project
- Must work with Bun runtime (no Node.js-specific APIs)
- Must preserve existing test patterns (Bun test runner)

## Risks

- RSK-001: Fixing config parse behavior (REQ-011) may break existing deployments that rely on silently falling back to defaults
- RSK-002: Adding privacy filtering (REQ-002) may alter stored content — need migration for existing records
- RSK-003: Fixing test mocks (REQ-003) may reveal actual code bugs that tests were incorrectly catching
- RSK-004: Transaction wrapping for bulk delete (REQ-022) requires storage layer transaction support
- RSK-005: Rate limiting (REQ-025) needs careful tuning to not break legitimate use patterns

## Out of scope

- ISSUE-023 (SHA256 truncation) — requires database schema change, deferred to separate effort
- Multi-process architecture changes for ISSUE-027
- HTTPS enforcement (deployment concern, not codebase)
- Auth disable flags behavior (documented deployment choice)
- AI provider error recovery beyond retry counting

## Completion definition

All acceptance criteria AC-001 through AC-030 are met. All 231+ tests pass. CI workflow passes end-to-end. Docker build succeeds. No regressions in existing functionality.
