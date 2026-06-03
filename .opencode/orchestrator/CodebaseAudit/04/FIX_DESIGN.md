# Codebase Audit Fix Design

## Source artifacts

- ISSUES.md: ./.opencode/orchestrator/CodebaseAudit/04/ISSUES.md
- FIX_SPEC.md: ./.opencode/orchestrator/CodebaseAudit/04/FIX_SPEC.md

## Design overview

The fixes are organized into 6 design areas, each addressing a cluster of related issues:

1. **Build & Deployment Fixes** — Dockerfile, build script, install script
2. **Security & Privacy Fixes** — Privacy filtering, health endpoint, SQL injection, auth
3. **Error Handling & Recovery Fixes** — Auto-capture, tag migration, config parsing, dedup
4. **Test Suite & CI Fixes** — Failing tests, CI workflow improvements
5. **Configuration & Dependency Cleanup** — Legacy files, unused deps, version alignment
6. **API Contract Improvements** — Pagination, bulk operations, input validation, rate limiting

## Affected components

| Component         | Files                                                                                | Issues Addressed                |
| ----------------- | ------------------------------------------------------------------------------------ | ------------------------------- |
| Dockerfile        | `Dockerfile`                                                                         | ISSUE-001                       |
| Build scripts     | `package.json`                                                                       | ISSUE-010                       |
| Privacy module    | `shared/privacy.ts`, `src/services/api-handlers.ts`                                  | ISSUE-002                       |
| Health handler    | `src/services/health-handler.ts`, `src/services/web-server.ts`                       | ISSUE-007                       |
| Storage layer     | `src/services/storage/postgres/prompt-repository.ts`                                 | ISSUE-009                       |
| Auto-capture      | `src/services/api-handlers.ts`                                                       | ISSUE-005, ISSUE-006            |
| Tag migration     | `src/services/tag-migration-service.ts`                                              | ISSUE-008, ISSUE-020            |
| Config loading    | `src/config.ts`, `src/server-config.ts`                                              | ISSUE-011, ISSUE-012            |
| Deduplication     | `src/services/api-handlers.ts`                                                       | ISSUE-013                       |
| Tests             | `tests/*.test.ts`                                                                    | ISSUE-003                       |
| CI workflow       | `.github/workflows/release.yml`                                                      | ISSUE-004                       |
| Documentation     | `codemap.md`, `README.md`                                                            | ISSUE-014, ISSUE-025            |
| Dependencies      | `package.json`, `plugin/package.json`                                                | ISSUE-015, ISSUE-016            |
| Docker compose    | `docker-compose.yml`                                                                 | ISSUE-017                       |
| Web UI            | `src/web/index.html`                                                                 | ISSUE-018                       |
| Profile learning  | `src/services/api-handlers.ts`                                                       | ISSUE-019                       |
| Context injection | `src/services/api-handlers.ts`                                                       | ISSUE-021                       |
| Bulk operations   | `src/services/api-handlers.ts`, `src/services/storage/postgres/memory-repository.ts` | ISSUE-022                       |
| Install script    | `scripts/install-server.sh`                                                          | ISSUE-024                       |
| Web server        | `src/services/web-server.ts`, `src/services/auth.ts`                                 | ISSUE-026, ISSUE-029, ISSUE-031 |
| Server lifecycle  | `src/server.ts`                                                                      | ISSUE-028                       |
| Memory listing    | `src/services/api-handlers.ts`                                                       | ISSUE-029                       |

## Proposed corrections

### DES-001: Fix Dockerfile lockfile COPY pattern

- **Addresses**: REQ-001 (ISSUE-001)
- **Change**: In `Dockerfile` line 3, change `COPY package.json bun.lockb* ./` to `COPY package.json bun.lock ./`
- **Impact**: Single line change. Docker build will correctly copy the lockfile.
- **Rollback**: Revert to original glob pattern.

### DES-002: Apply privacy filtering in API handlers

- **Addresses**: REQ-002 (ISSUE-002)
- **Change**: Import `stripPrivateContent` from `shared/privacy.ts` in `api-handlers.ts`. Apply before storage in `handleAddMemory` (line 325) and `handleAutoCapture` (line 1324). Apply before return in `handleListMemories` (line 170) and `handleSearch` (line 577).
- **Impact**: Moderate — adds processing to all memory read/write paths. Need to ensure `<private>` tags in legitimate content aren't accidentally stripped.
- **Rollback**: Remove the filtering calls.

### DES-003: Fix failing tests

- **Addresses**: REQ-003 (ISSUE-003)
- **Changes per test file**:
  - `tests/config.test.ts`: Mock `initConfig()` before accessing CONFIG singleton, or use test-specific config setup
  - `tests/config-resolution.test.ts`: Same — ensure CONFIG is properly initialized via mock before testing values
  - `tests/server-config-llm-validation.test.ts`: Update import to match actual exported function name from server-config.ts
  - `tests/storage/factory-routing.test.ts`: Mock the lazy proxy pattern correctly — ensure factory functions are properly initialized for test context
  - `tests/storage/getUntaggedProjectMemories.test.ts`: Mock `getUntaggedProjectMemories` function — verify it exists in the storage layer
  - `tests/tool-scope.test.ts`: Fix integration test scenarios to return expected exit codes
- **Impact**: Test-only changes. No runtime behavior change.
- **Rollback**: Revert test changes.

### DES-004: Add quality gates to CI workflow

- **Addresses**: REQ-004 (ISSUE-004)
- **Change**: In `.github/workflows/release.yml`, add steps:
  - `bun test` (after install, before typecheck)
  - `bun run format:check` (after typecheck)
  - `bun run build:plugin` (after build)
- **Impact**: CI will fail if tests are broken or formatting is off. Release blocked on quality.
- **Rollback**: Remove the added CI steps.

### DES-005: Auto-capture retry counting and prompt marking

- **Addresses**: REQ-005 (ISSUE-005)
- **Change**: In `handleAutoCapture`, before calling `generateSummary`:
  - Check if the prompt has been retried more than MAX_AUTO_CAPTURE_RETRIES (default 3)
  - If exceeded, mark the prompt as `captured = TRUE` with a `capture_failed` flag
  - Add exponential backoff between retries (track last retry timestamp)
- **Impact**: Failed prompts are eventually marked as consumed, stopping infinite loops.
- **Rollback**: Remove retry counting logic.

### DES-006: Auto-capture summary persistence on DB failure

- **Addresses**: REQ-006 (ISSUE-006)
- **Change**: Wrap `memoryRepo.insert()` in a try/catch with retry logic:
  - On first failure, retry up to 3 times with exponential backoff
  - If all retries fail, log the summary to a recovery location (file or separate DB table)
  - Do NOT mark the prompt as consumed until the insert succeeds
- **Impact**: Captured summaries are not lost on transient DB failures.
- **Rollback**: Remove retry/recovery logic.

### DES-007: Reduce health endpoint information disclosure

- **Addresses**: REQ-007 (ISSUE-007)
- **Change**: In `health-handler.ts`, split into two modes:
  - Unauthenticated `/api/health`: Return only `{ status: "ok" | "error" }` with HTTP 200/500
  - Authenticated `/api/health/details`: Return full details (version, dbConnected, embeddingReady, uptime)
- **Impact**: External monitoring can still check health without exposing internals.
- **Rollback**: Restore original health handler.

### DES-008: Tag migration failure threshold and tracking

- **Addresses**: REQ-008 (ISSUE-008)
- **Change**: In `tag-migration-service.ts`:
  - Track consecutive failures count
  - If failures exceed MIGRATION_MAX_FAILURES (default 10), pause the migration loop
  - Log structured error with failed memory IDs
  - Add a "resume migration" API endpoint or auto-resume after configurable cooldown
- **Impact**: Migration stops before wasting resources on consistently failing memories.
- **Rollback**: Remove failure tracking.

### DES-009: Verify and fix SQL injection in prompt search

- **Addresses**: REQ-009 (ISSUE-009)
- **Change**: Verify the `postgres` library's template tag behavior:
  - If it parameterizes interpolations → document as safe, no code change needed
  - If it interpolates directly → refactor to use explicit parameter passing
- **Impact**: Either confirms safety or fixes a potential vulnerability.
- **Rollback**: Revert parameterization change if it causes query issues.

### DES-010: Fix build script for empty web directory

- **Addresses**: REQ-010 (ISSUE-010)
- **Change**: In `package.json`, change build script from:
  `"bunx tsc && mkdir -p dist/web && cp -r src/web/* dist/web/"`
  to:
  `"bunx tsc && mkdir -p dist/web && cp -r src/web/. dist/web/ || true"`
- **Impact**: Build succeeds even if web directory is empty.
- **Rollback**: Revert to original glob pattern.

### DES-011: Config parse fast-fail behavior

- **Addresses**: REQ-011 (ISSUE-012)
- **Change**: In `src/config.ts` `loadConfigFromPaths()`:
  - If a config file exists at an expected path but fails to parse, throw a descriptive error instead of continuing
  - Add a new function parameter `allowMissing: boolean` to control whether missing config is acceptable
  - In server startup, set `allowMissing: false` to require valid config
- **Impact**: Server fails fast with clear error on malformed config instead of failing later with confusing errors.
- **Rollback**: Restore silent fallback behavior.

### DES-012: Stricter postgres.url validation

- **Addresses**: REQ-012 (ISSUE-012)
- **Change**: In `src/server-config.ts`:
  - Add validation: `if (!config.postgres?.url?.trim())` to catch empty, whitespace, and undefined
  - Add URL format validation (must start with `postgresql://` or `postgres://`)
- **Impact**: Invalid postgres URLs are caught at startup with clear error.
- **Rollback**: Revert to simple falsy check.

### DES-013: handleDeduplicate failure reporting

- **Addresses**: REQ-013 (ISSUE-013)
- **Change**: In `handleDeduplicate`:
  - Track failed delete IDs in a `failedDeletes` array
  - Include `{ success: true, data: { deleted, failedDeletes: [...], totalDuplicates } }` in response
- **Impact**: Callers can see which deletes failed and retry.
- **Rollback**: Remove failure tracking from response.

### DES-014: Documentation accuracy updates

- **Addresses**: REQ-014 (ISSUE-014), REQ-024 (ISSUE-025)
- **Changes**:
  - `codemap.md` line 50: Change "Removed in v3.0.0" to "Kept as reference, excluded from build via tsconfig.json"
  - `README.md` line 2: Change `docs/logo/logo-banner.svg` to `src/web/logo-banner.svg`
- **Impact**: Documentation matches reality.
- **Rollback**: Revert documentation changes.

### DES-015: Remove unused shadcn dependency

- **Addresses**: REQ-015 (ISSUE-015)
- **Change**: Remove `"shadcn": "^4.8.1"` from package.json devDependencies. Run `bun install` to update lockfile.
- **Impact**: Smaller dependency tree, faster installs.
- **Rollback**: Re-add shadcn to devDependencies.

### DES-016: Align zod versions

- **Addresses**: REQ-016 (ISSUE-016)
- **Change**: Add a `resolutions` field in root package.json to force zod version alignment:
  `"resolutions": { "zod": "^4.3.6" }`
  Or update plugin's package.json to add explicit zod dependency matching server version.
- **Impact**: Consistent validation behavior across workspaces.
- **Rollback**: Remove resolution override.

### DES-017: Remove default postgres password from docker-compose

- **Addresses**: REQ-017 (ISSUE-017)
- **Change**: In `docker-compose.yml`:
  - Remove `:-opencode` fallback from POSTGRES_PASSWORD
  - Add a check/warning in the server startup if password is a known default
- **Impact**: Users must explicitly set a password. Existing docker-compose deployments may need to update their .env.
- **Rollback**: Restore default password fallback.

### DES-018: Pin CDN dependency versions in WebUI

- **Addresses**: REQ-018 (ISSUE-018)
- **Change**: In `src/web/index.html`:
  - Change `jsonrepair@latest` to a pinned version (e.g., `jsonrepair@1.12.0`)
  - Change `lucide@latest` to a pinned version (e.g., `lucide@0.469.0`)
  - Verify `marked@17.0.1` and `dompurify@3.2.2` are already pinned (they are)
- **Impact**: WebUI behavior is deterministic across deployments.
- **Rollback**: Revert to @latest tags.

### DES-019: Profile learning retry counting

- **Addresses**: REQ-019 (ISSUE-019)
- **Change**: Similar to DES-005: In `handleUserProfileLearn`, after AI failure, mark prompts as `user_learning_captured = TRUE` with a `learning_failed` flag after MAX_PROFILE_RETRIES (default 3).
- **Impact**: Prevents infinite retry loop for profile learning.
- **Rollback**: Remove retry counting.

### DES-020: Separate tag and vector generation in migration

- **Addresses**: REQ-020 (ISSUE-020)
- **Change**: In `tag-migration-service.ts`:
  - After successful tag generation, mark memory as "tagged" immediately
  - Vector generation is a separate step that can be retried independently
  - If vector generation fails, the memory has tags but no vectors — it's still functional for text search
- **Impact**: Tag generation success is preserved even if vector generation fails.
- **Rollback**: Merge tag and vector generation back into single step.

### DES-021: Corrupt profile diagnostic flag

- **Addresses**: REQ-021 (ISSUE-021)
- **Change**: In `handleContextInject`:
  - In the catch block for JSON.parse failure, set `profileStatus: "corrupt"` in the response data
  - Client can display a warning to the user about corrupt profile data
- **Impact**: Users are informed about corrupt profiles.
- **Rollback**: Remove diagnostic flag.

### DES-022: Transaction wrapping for bulk delete

- **Addresses**: REQ-022 (ISSUE-022)
- **Change**: In `src/services/storage/postgres/memory-repository.ts`:
  - Add a `deleteMany(ids: string[])` method that uses a SQL `DELETE WHERE id IN (...)` within a transaction
  - Update `handleBulkDelete` to use the new method
- **Impact**: Bulk delete is atomic — either all succeed or all fail.
- **Rollback**: Revert to sequential deletes.

### DES-023: Fix install script URL

- **Addresses**: REQ-023 (ISSUE-024)
- **Change**: In `scripts/install-server.sh` line 56, update the git clone URL to the correct repository.
- **Impact**: Install script clones the right codebase.
- **Rollback**: Revert URL.

### DES-024: Rate limiting middleware

- **Addresses**: REQ-025 (ISSUE-026)
- **Change**: In `src/services/web-server.ts`:
  - Add a simple in-memory rate limiter (token bucket) as middleware
  - Default: 100 requests per minute per IP
  - Returns HTTP 429 when exceeded
  - Configurable via `RATE_LIMIT_RPM` env var
- **Impact**: Basic protection against API abuse.
- **Rollback**: Remove rate limiting middleware.

### DES-025: Document concurrency limitations

- **Addresses**: REQ-026 (ISSUE-027)
- **Change**: Add/update code comments in `src/services/api-handlers.ts` around module-level state variables (lines 1032-1056) with:
  - Clear documentation that this assumes single-process model
  - Warning about what breaks in multi-process
  - Reference to ISSUE-027 for future consideration
- **Impact**: Documentation only, no behavior change.
- **Rollback**: Revert comments.

### DES-026: Graceful shutdown drain

- **Addresses**: REQ-027 (ISSUE-028)
- **Change**: In `src/server.ts` `shutdown()`:
  - Add `Connection: close` header to new requests immediately
  - Wait configurable drain period (default 30s) for in-flight requests
  - Then close DB pool and exit
- **Impact**: In-flight requests complete before shutdown.
- **Rollback**: Remove drain period.

### DES-027: Memory listing pagination

- **Addresses**: REQ-028 (ISSUE-029)
- **Change**: In `handleListMemories` and `web-server.ts`:
  - Accept `page` and `pageSize` query parameters (defaults: page=1, pageSize=100)
  - Calculate offset from page/pageSize
  - Return `{ items, total, page, pageSize }` structure
- **Impact**: API consumers can paginate through large result sets.
- **Rollback**: Remove pagination parameters, restore hardcoded limit.

### DES-028: Constant-time API key comparison

- **Addresses**: REQ-029 (ISSUE-030)
- **Change**: In `src/services/auth.ts` line 45:
  - Replace `parts[1] !== this.apiKey` with `!crypto.timingSafeEqual(Buffer.from(parts[1]), Buffer.from(this.apiKey))`
  - Add length check first (timing-safe comparison requires equal-length buffers)
- **Impact**: Eliminates theoretical timing side-channel.
- **Rollback**: Revert to string comparison.

### DES-029: Search query length validation

- **Addresses**: REQ-030 (ISSUE-031)
- **Change**: In `src/services/web-server.ts` where search `q` parameter is read:
  - Add `if (q && q.length > 1000) return Response.json({ error: "Query too long" }, { status: 400 })`
- **Impact**: Prevents oversized search queries from consuming embedding resources.
- **Rollback**: Remove length check.

## Issue / requirement / design mapping

| Issue     | Requirements | Design items |
| --------- | ------------ | ------------ |
| ISSUE-001 | REQ-001      | DES-001      |
| ISSUE-002 | REQ-002      | DES-002      |
| ISSUE-003 | REQ-003      | DES-003      |
| ISSUE-004 | REQ-004      | DES-004      |
| ISSUE-005 | REQ-005      | DES-005      |
| ISSUE-006 | REQ-006      | DES-006      |
| ISSUE-007 | REQ-007      | DES-007      |
| ISSUE-008 | REQ-008      | DES-008      |
| ISSUE-009 | REQ-009      | DES-009      |
| ISSUE-010 | REQ-010      | DES-010      |
| ISSUE-011 | REQ-011      | DES-011      |
| ISSUE-012 | REQ-012      | DES-012      |
| ISSUE-013 | REQ-013      | DES-013      |
| ISSUE-014 | REQ-014      | DES-014      |
| ISSUE-015 | REQ-015      | DES-015      |
| ISSUE-016 | REQ-016      | DES-016      |
| ISSUE-017 | REQ-017      | DES-017      |
| ISSUE-018 | REQ-018      | DES-018      |
| ISSUE-019 | REQ-019      | DES-019      |
| ISSUE-020 | REQ-020      | DES-020      |
| ISSUE-021 | REQ-021      | DES-021      |
| ISSUE-022 | REQ-022      | DES-022      |
| ISSUE-024 | REQ-023      | DES-023      |
| ISSUE-025 | REQ-024      | DES-014      |
| ISSUE-026 | REQ-025      | DES-024      |
| ISSUE-027 | REQ-026      | DES-025      |
| ISSUE-028 | REQ-027      | DES-026      |
| ISSUE-029 | REQ-028      | DES-027      |
| ISSUE-030 | REQ-029      | DES-028      |
| ISSUE-031 | REQ-030      | DES-029      |

## Test design

- Each DES item should have corresponding test updates:
  - DES-001: Docker build integration test
  - DES-002: Unit tests for privacy filtering in each handler
  - DES-003: All existing tests pass
  - DES-004: CI runs tests/format/build (verified by CI run)
  - DES-005: Test retry counting and prompt marking
  - DES-006: Test DB insert failure recovery
  - DES-007: Test health endpoint with/without auth
  - DES-008: Test migration pause after failure threshold
  - DES-009: Test search with SQL injection payloads
  - DES-010: Test build with empty web directory
  - DES-011: Test startup with malformed config
  - DES-012: Test postgres URL validation edge cases
  - DES-013: Test deduplication with partial failures
  - DES-014: Manual documentation review
  - DES-015: Test build after dependency removal
  - DES-016: Test zod version alignment
  - DES-017: Test compose fails without password
  - DES-018: Test WebUI loads with pinned versions
  - DES-019: Test profile learning retry counting
  - DES-020: Test tag persistence on vector failure
  - DES-021: Test context injection with corrupt profile
  - DES-022: Test bulk delete transaction rollback
  - DES-023: Verify install script URL is correct
  - DES-024: Test rate limiting returns 429
  - DES-025: Code review of documentation comments
  - DES-026: Test graceful shutdown with in-flight request
  - DES-027: Test pagination parameters
  - DES-028: Test auth with timing attack patterns
  - DES-029: Test search with oversized query

## Data/config/schema impact

- No database schema changes required (ISSUE-023 deferred)
- New config values: `MAX_AUTO_CAPTURE_RETRIES`, `MIGRATION_MAX_FAILURES`, `RATE_LIMIT_RPM`, `SHUTDOWN_DRAIN_SECONDS`
- docker-compose.yml: POSTGRES_PASSWORD default removed
- package.json: shadcn removed, zod resolution added

## Security impact

- Positive: Privacy filtering prevents data leaks (DES-002)
- Positive: Health endpoint no longer leaks internal state (DES-007)
- Positive: SQL injection verified/fixed (DES-009)
- Positive: Constant-time auth comparison (DES-028)
- Positive: Rate limiting prevents abuse (DES-024)
- Positive: Default password removed from compose (DES-017)
- Consideration: Privacy filtering affects stored content — existing unfiltered records remain unfiltered

## Compatibility impact

- Health endpoint response format changes (DES-007) — may break external monitoring
- handleListMemories response format changes (DES-027) — adds pagination fields
- handleDeduplicate response format changes (DES-013) — adds failure tracking fields
- handleContextInject response format changes (DES-021) — adds profile diagnostic
- docker-compose.yml default password removed (DES-017) — existing deployments need .env update

## Migration/rollback notes

- Each design item is independently deployable and rollbackable
- Privacy filtering (DES-002) should be applied to new records first, with a background migration for existing records
- CI changes (DES-004) should only be applied after test fixes (DES-003) are complete
- Rate limiting (DES-024) should have a configurable default that doesn't break existing usage patterns

## Risks and mitigations

| Risk                                                | Mitigation                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------- |
| Privacy filtering strips legitimate content         | Add comprehensive unit tests; log when content is modified                |
| Health endpoint change breaks monitoring            | Provide `/api/health/details` with full info for authenticated monitoring |
| Config fast-fail breaks existing deployments        | Add clear error message explaining the config file issue                  |
| Transaction wrapping requires storage layer changes | Add `deleteMany` method to repository interface                           |
| Rate limiting defaults too aggressive               | Set conservative defaults (100 RPM); make configurable                    |

## Alternatives considered

1. **Privacy filtering at read time only** vs **at write time**: Both approaches considered. Write-time filtering is safer (prevents storage of private data) but requires migration for existing records. Recommend both write-time and read-time filtering.
2. **Full pagination library** vs **simple offset/limit**: Simple approach chosen — offset/limit with page/pageSize parameters. No cursor-based pagination needed at this scale.
3. **Redis-based rate limiting** vs **in-memory**: In-memory chosen — no external dependency. Acceptable for single-process model.
4. **Remove legacy files** vs **update documentation**: Documentation update chosen — less risky, files serve as reference.
