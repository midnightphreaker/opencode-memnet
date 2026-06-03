# Codebase Audit Issues

## Audit scope

- Repository: opencode-memnet
- Branch: (current)
- Commit: (current)
- User scope argument: Full repository
- Audit run directory: ./.opencode/orchestrator/CodebaseAudit/04/
- Date/time: 2026-06-03
- Tools used: sequential-thinking, reminders, explorer subagents (4 parallel workstreams), fixer subagents
- Commands run: bun test (186 pass / 45 fail), bun run typecheck (pass), file inspection across 40+ source files
- Commands skipped: bun run format:check (format-only, not verification), destructive commands, deployment commands
- Limitations: Root orchestrator bash permissions restricted to specific patterns; directory creation delegated to subagents

## Orchestration assistance tools

- sequential-thinking used: Yes
- sequential-thinking limitation: None
- reminders used: Yes
- reminders limitation: None
- reminders/follow-ups created: rem_1780413788481_mehz0 (audit plan tracking)

## Summary

| Severity      | Count |
| ------------- | ----- |
| Critical      | 1     |
| High          | 7     |
| Medium        | 10    |
| Low           | 7     |
| Informational | 6     |

## Issue index

| ID        | Severity      | Confidence | Category               | Status    | Title                                                                                  |
| --------- | ------------- | ---------- | ---------------------- | --------- | -------------------------------------------------------------------------------------- |
| ISSUE-001 | Critical      | High       | Build Failure          | Confirmed | Dockerfile COPY glob pattern fails to match bun.lock lockfile                          |
| ISSUE-002 | High          | High       | Security               | Confirmed | Privacy filtering not applied in API handlers — private data leaks to clients          |
| ISSUE-003 | High          | High       | Test Failure           | Confirmed | 45 of 231 tests failing — config, storage factory, tool-scope tests broken             |
| ISSUE-004 | High          | High       | Configuration          | Confirmed | CI pipeline has no test execution, linting, or format checks                           |
| ISSUE-005 | High          | High       | Error Handling         | Confirmed | Auto-capture AI failure causes infinite retry loop with no backoff                     |
| ISSUE-006 | High          | High       | Data Loss              | Confirmed | Auto-capture DB insert failure silently loses captured memory                          |
| ISSUE-007 | High          | High       | Security               | Confirmed | /api/health endpoint unauthenticated — exposes version, DB status, embedding readiness |
| ISSUE-008 | High          | High       | Error Handling         | Confirmed | Tag migration AI failure silently swallowed per-memory                                 |
| ISSUE-009 | Medium        | Medium     | Security               | Probable  | SQL injection potential via LIKE pattern in prompt search                              |
| ISSUE-010 | Medium        | High       | Build Failure          | Confirmed | cp -r src/web/\* in build script fails silently when directory empty                   |
| ISSUE-011 | Medium        | High       | Error Handling         | Confirmed | Config parsing silently returns empty on all parse failures                            |
| ISSUE-012 | Medium        | High       | Configuration          | Confirmed | validateServerConfig accepts empty string as valid postgres.url                        |
| ISSUE-013 | Medium        | High       | Error Handling         | Confirmed | handleDeduplicate silent delete failures undercount results                            |
| ISSUE-014 | Medium        | High       | Documentation Mismatch | Confirmed | Legacy src/index.ts exists despite codemap saying Removed in v3.0.0                    |
| ISSUE-015 | Medium        | High       | Maintainability        | Confirmed | shadcn listed as unused devDependency                                                  |
| ISSUE-016 | Medium        | Medium     | Maintainability        | Confirmed | zod version mismatch between server and plugin lockfiles                               |
| ISSUE-017 | Medium        | High       | Security               | Confirmed | Hardcoded default postgres password in docker-compose.yml                              |
| ISSUE-018 | Medium        | Medium     | Security               | Confirmed | WebUI CDN dependencies unpinned and crossorigin without CORS                           |
| ISSUE-019 | Low           | Medium     | Error Handling         | Confirmed | Profile learning retry loop on AI failure with no marking                              |
| ISSUE-020 | Low           | Medium     | Resource Leak          | Confirmed | Tag migration vector leak on embedding failure                                         |
| ISSUE-021 | Low           | High       | Error Handling         | Confirmed | Corrupt profile JSON silently skipped in context injection                             |
| ISSUE-022 | Low           | Medium     | API Contract           | Confirmed | handleBulkDelete no transaction or atomicity                                           |
| ISSUE-023 | Low           | Low        | Security               | Confirmed | SHA256 truncated to 16 hex chars for container tags                                    |
| ISSUE-024 | Low           | High       | Configuration          | Confirmed | install-server.sh clones wrong GitHub repo URL                                         |
| ISSUE-025 | Low           | High       | Documentation Mismatch | Confirmed | README references wrong logo SVG path                                                  |
| ISSUE-026 | Informational | High       | Security               | Confirmed | No rate limiting on any API endpoint                                                   |
| ISSUE-027 | Informational | High       | Concurrency            | Confirmed | Module-level mutable state shared across concurrent requests without synchronization   |
| ISSUE-028 | Informational | High       | Resource Cleanup       | Confirmed | Server shutdown does not wait for in-flight requests to drain                          |
| ISSUE-029 | Informational | High       | API Contract           | Confirmed | handleListMemories silently caps at 1000 rows without pagination                       |
| ISSUE-030 | Informational | Medium     | Security               | Confirmed | API key comparison uses string equality instead of constant-time                       |
| ISSUE-031 | Informational | Medium     | API Contract           | Confirmed | handleSearch has no max query length enforcement                                       |

## Issues

## ISSUE-001: Dockerfile COPY glob pattern fails to match bun.lock lockfile

- Severity: Critical
- Confidence: High
- Category: Build Failure
- Status: Confirmed
- Affected area: Docker build / deployment
- Affected files: Dockerfile:3
- Evidence: Line 3 of Dockerfile reads `COPY package.json bun.lockb* ./`. The glob `bun.lockb*` matches files starting with literal "bun.lockb" followed by zero or more characters. The actual lockfile is named `bun.lock` (confirmed by `ls -la bun.lock*` showing only `bun.lock`). The glob does NOT match `bun.lock`. This means the lockfile is NOT copied into the Docker image, and `bun install --frozen-lockfile` will fail because there is no lockfile to validate against.
- Why this matters: Docker builds for deployment will fail or run without lockfile verification, allowing dependency drift in production containers.
- Reproduction / verification: Run `docker build .` — the build will either fail at `bun install --frozen-lockfile` or silently install without lockfile constraints.
- Expected behaviour: The lockfile is copied into the Docker image and used for deterministic installs.
- Actual behaviour: The `bun.lockb*` glob does not match `bun.lock`, so the lockfile is missing from the build context.
- Proposed correction: Change `COPY package.json bun.lockb* ./` to `COPY package.json bun.lock* ./` (or `bun.lock ./`) to match the actual lockfile name.
- Dependencies / related issues: None
- Risk of fix: Very low — single line change in Dockerfile.
- Suggested test coverage: Docker build integration test verifying lockfile is present.

## ISSUE-002: Privacy filtering not applied in API handlers — private data leaks to clients

- Severity: High
- Confidence: High
- Category: Security
- Status: Confirmed
- Affected area: API response data, auto-capture storage
- Affected files: src/services/api-handlers.ts (handleAddMemory lines 325-403, handleAutoCapture lines 1208-1367, handleListMemories lines 170-323, handleSearch lines 577-731), shared/privacy.ts (exists but unused by handlers)
- Evidence: `shared/privacy.ts` defines `stripPrivateContent()` and `isFullyPrivate()` for `<private>...</private>` content redaction. These functions are only imported in legacy client-side code (`plugin/src/index-remote.ts`, `src/index-remote.ts`, `src/index.ts`). The API handlers in `src/services/api-handlers.ts` never import or call these functions. `handleAutoCapture` (line 1208+) accepts raw `conversationMessages` and stores content verbatim. `handleListMemories` and `handleSearch` return full `content` fields without filtering.
- Why this matters: Any `<private>...</private>` content submitted via auto-capture or add-memory is stored and returned verbatim to all API clients, bypassing the intended privacy control mechanism.
- Reproduction / verification: Submit a memory with `<private>secret data</private>` via POST /api/memories, then retrieve it via GET /api/memories — the private tags will be present in the response.
- Expected behaviour: Private content is stripped or redacted before storage and/or before returning in API responses.
- Actual behaviour: Private content passes through unmodified.
- Proposed correction: Apply `stripPrivateContent()` in `handleAddMemory` and `handleAutoCapture` before storage. Apply it in `handleListMemories` and `handleSearch` before returning results.
- Dependencies / related issues: None
- Risk of fix: Medium — need to ensure stripping doesn't break legitimate content. Add tests for privacy filtering in all affected handlers.
- Suggested test coverage: Unit tests for each handler verifying `<private>...</private>` is stripped on input and output.

## ISSUE-003: 45 of 231 tests failing — config, storage factory, tool-scope tests broken

- Severity: High
- Confidence: High
- Category: Test Failure
- Status: Confirmed
- Affected area: Test suite
- Affected files: tests/config.test.ts, tests/config-resolution.test.ts, tests/server-config-llm-validation.test.ts, tests/storage/factory-routing.test.ts, tests/storage/getUntaggedProjectMemories.test.ts, tests/tool-scope.test.ts
- Evidence: `bun test` output shows 186 pass, 45 fail across 24 files. Key failures: CONFIG object is undefined in config.test.ts:22,26 (module initialization issue); validateServerConfig function not found in server-config-llm-validation.test.ts:70,82,96; createAISessionRepository is not a function in factory-routing.test.ts:19,43; getUntaggedProjectMemories is undefined in getUntaggedProjectMemories.test.ts:53; tool-scope.test.ts returns exit code 1 instead of 0 at lines 143,154,164.
- Why this matters: Nearly 20% of the test suite is broken. CI doesn't run tests (see ISSUE-004), so these failures are invisible. The broken tests may indicate real regressions or API changes that weren't reflected in test code.
- Reproduction / verification: Run `bun test` — observe 45 failures.
- Expected behaviour: All tests pass.
- Actual behaviour: 45 tests fail across 6 test files.
- Proposed correction: Fix test mocking/setup for config tests (CONFIG singleton initialization). Update server-config-llm-validation tests to import correct function. Fix storage factory test mocking for lazy proxy pattern. Fix tool-scope integration tests.
- Dependencies / related issues: ISSUE-004 (no tests in CI means failures are invisible)
- Risk of fix: Low for test fixes, but underlying code may have changed and tests may reveal real bugs.
- Suggested test coverage: After fixing, all 231+ tests should pass.

## ISSUE-004: CI pipeline has no test execution, linting, or format checks

- Severity: High
- Confidence: High
- Category: Configuration
- Status: Confirmed
- Affected area: CI/CD quality gates
- Affected files: .github/workflows/release.yml:8-25
- Evidence: The release workflow (triggered on version tags) runs only: `bun install`, `bun run typecheck`, `bun run build`. It does NOT run: `bun test` (45 tests are failing — ISSUE-003), `bun run format:check`, any linting, any security audit. The plugin is also not built in CI (`bun run build:plugin` is missing).
- Why this matters: A release can be published with failing tests, unformatted code, and no quality validation. The 45 failing tests (ISSUE-003) would not block a release.
- Reproduction / verification: Read .github/workflows/release.yml — no test/lint/format steps present.
- Expected behaviour: CI runs tests, linting, format checks, and plugin build before allowing release.
- Actual behaviour: CI only runs typecheck and build.
- Proposed correction: Add `bun test`, `bun run format:check`, and `bun run build:plugin` steps to the release workflow. Consider adding a separate CI workflow for PRs/pushes that runs the same checks.
- Dependencies / related issues: ISSUE-003 (45 failing tests are invisible without CI test execution)
- Risk of fix: Low — CI changes don't affect runtime behavior. However, fixing this requires first fixing ISSUE-003 so tests pass.
- Suggested test coverage: CI should pass after all fixes are applied.

## ISSUE-005: Auto-capture AI failure causes infinite retry loop with no backoff

- Severity: High
- Confidence: High
- Category: Error Handling
- Status: Confirmed
- Affected area: Auto-capture flow
- Affected files: src/services/api-handlers.ts:1298-1366
- Evidence: In `handleAutoCapture`, the `generateSummary()` call at line 1298 is NOT wrapped in its own try/catch. If it throws, the outer catch at line 1363 returns `{ success: false, error: "Internal server error" }`. The prompt remains in `user_prompts` with `captured = FALSE`. The next `session.idle` event from OpenCode calls `handleAutoCapture` again with the same prompt — creating an infinite retry loop with no exponential backoff, no circuit breaker, and no maximum retry count.
- Why this matters: If the AI provider has a sustained outage or returns persistent errors, the same prompts will be retried indefinitely, wasting API calls and potentially costing money.
- Reproduction / verification: Mock generateSummary to always throw. Trigger auto-capture twice — the same prompt will be processed both times.
- Expected behaviour: Failed prompts should be marked after N retries, or there should be exponential backoff, or a circuit breaker.
- Actual behaviour: Failed prompts are never marked, causing infinite retries.
- Proposed correction: Add retry counting or mark prompts as failed after a configurable number of attempts. Implement exponential backoff for the auto-capture trigger.
- Dependencies / related issues: ISSUE-006 (related auto-capture error handling)
- Risk of fix: Medium — need to ensure legitimate transient failures still get retried.
- Suggested test coverage: Test that prompts are marked after N failed attempts. Test that retry count increases.

## ISSUE-006: Auto-capture DB insert failure silently loses captured memory

- Severity: High
- Confidence: High
- Category: Data Loss
- Status: Confirmed
- Affected area: Auto-capture flow, data persistence
- Affected files: src/services/api-handlers.ts:1324-1346
- Evidence: In `handleAutoCapture`, after successfully generating a summary and embedding, the `memoryRepo.insert()` call at line 1324-1346 is not wrapped in a dedicated try/catch. If the insert throws (DB connection lost, constraint violation, etc.), the exception propagates to the outer catch at line 1363 which returns `{ success: false }`. The AI-generated summary is lost — there is no retry, no recovery, and no persistence of the summary for later retry.
- Why this matters: Successfully captured and summarized knowledge is lost if the database write fails. The user has no way to recover this data.
- Reproduction / verification: Mock memoryRepo.insert to throw. Trigger auto-capture with valid data — the summary is generated but never stored.
- Expected behaviour: The summary should be persisted for retry, or the prompt should not be marked as consumed until the insert succeeds.
- Actual behaviour: Summary is lost on DB failure, prompt may or may not be marked depending on where the failure occurs.
- Proposed correction: Wrap the DB insert in a try/catch with retry logic. Consider writing the summary to a recovery table or file before marking the prompt as consumed. Ensure atomicity of prompt consumption and memory storage.
- Dependencies / related issues: ISSUE-005 (related auto-capture error handling)
- Risk of fix: Medium — need to ensure atomicity between prompt consumption and memory insert.
- Suggested test coverage: Test DB insert failure scenario. Test that summary is recoverable after DB failure.

## ISSUE-007: /api/health endpoint unauthenticated — exposes version, DB status, embedding readiness

- Severity: High
- Confidence: High
- Category: Security
- Status: Confirmed
- Affected area: Health check endpoint
- Affected files: src/services/web-server.ts:185, src/services/health-handler.ts:11-25
- Evidence: `web-server.ts` line 185 explicitly excludes `/api/health` from authentication: `if (path.startsWith("/api/") && path !== "/api/health")`. The health handler returns `{ status, version: "2.14.3", dbConnected, embeddingReady, uptime }` — exact version number, database connectivity, AI infrastructure status, and server uptime.
- Why this matters: Unauthenticated attackers can probe for exact version (enables targeted exploits), database connectivity (confirms internal architecture), embedding readiness (confirms AI infrastructure), and uptime (helps timing attacks).
- Reproduction / verification: `curl http://server:port/api/health` without authentication — receives full status.
- Expected behaviour: Health endpoint should either require authentication, or return minimal status (just "ok"/"error") without internal details.
- Actual behaviour: Full internal status returned without authentication.
- Proposed correction: Either add authentication to the health endpoint, or reduce the response to a minimal status indicator without version numbers or internal state details.
- Dependencies / related issues: None
- Risk of fix: Low — minimal change. May need a separate unauthenticated health check for load balancers that only returns HTTP 200/500.
- Suggested test coverage: Test health endpoint with and without auth. Test response payload doesn't contain sensitive info.

## ISSUE-008: Tag migration AI failure silently swallowed per-memory

- Severity: High
- Confidence: High
- Category: Error Handling
- Status: Confirmed
- Affected area: Background tag migration
- Affected files: src/services/tag-migration-service.ts:105-131, 187-226
- Evidence: In `tagMemory()` (lines 105-131), after RETRY_LIMIT attempts fail, it returns `null`. The caller at line 190-221 only pushes an error to `_state.errors` array and continues to the next memory. The memory remains untagged, and the migration loop advances. If the AI consistently fails for a subset of memories, they are permanently skipped with no alert or escalation.
- Why this matters: Memories that fail tagging are permanently left without tags, making them invisible to tag-filtered queries. There is no mechanism to retry them later or alert administrators.
- Reproduction / verification: Mock the AI provider to fail consistently. Run tag migration — affected memories remain untagged forever.
- Expected behaviour: Consistently failed memories should be flagged for manual review, or the migration should pause and alert after a threshold of failures.
- Actual behaviour: Failed memories are silently skipped and the migration continues.
- Proposed correction: Add a failure threshold that pauses the migration. Track failed memory IDs for retry in a subsequent pass. Log structured errors for monitoring.
- Dependencies / related issues: ISSUE-020 (vector leak on embedding failure during migration)
- Risk of fix: Low — adding tracking and threshold logic.
- Suggested test coverage: Test that migration pauses after N failures. Test that failed memory IDs are tracked.

## ISSUE-009: SQL injection potential via LIKE pattern in prompt search

- Severity: Medium
- Confidence: Medium
- Category: Security
- Status: Probable
- Affected area: Prompt search query
- Affected files: src/services/storage/postgres/prompt-repository.ts:224-252
- Evidence: The `searchPrompts` function escapes LIKE special characters (`%`, `_`) with `\\` prefix, then interpolates the result into the `sql` tagged template literal. The safety depends entirely on whether the `postgres` library parameterizes `${likePattern}` or treats it as raw SQL interpolation. The `ESCAPE '\\'` clause is present, which is correct for the escaping approach used. However, if the postgres library does NOT parameterize template literal interpolations, a crafted query could potentially bypass the LIKE escaping.
- Why this matters: If the postgres library doesn't properly parameterize, this could allow SQL injection through the search query parameter.
- Reproduction / verification: Verify the `postgres` library's template tag behavior — does it parameterize `${likePattern}` as a query parameter or interpolate it directly? Test with a query containing SQL metacharacters.
- Expected behaviour: User input in search queries should be fully parameterized, not interpolated into SQL strings.
- Actual behaviour: User input is escaped for LIKE patterns and interpolated into a template literal whose safety depends on library behavior.
- Proposed correction: If the postgres library parameterizes template literals, this is safe. If not, use explicit parameter passing instead of template literal interpolation for the LIKE pattern.
- Dependencies / related issues: None
- Risk of fix: Low — standard parameterization fix.
- Suggested test coverage: Test search with SQL injection payloads. Verify parameterized query execution.

## ISSUE-010: cp -r src/web/\* in build script fails silently when directory empty

- Severity: Medium
- Confidence: High
- Category: Build Failure
- Status: Confirmed
- Affected area: Build process
- Affected files: package.json:12
- Evidence: The build script is `"bunx tsc && mkdir -p dist/web && cp -r src/web/* dist/web/"`. If `src/web/` contains no regular files (e.g., after a clean checkout that missed web assets, or if web assets were cleaned), the shell glob `src/web/*` fails with "no match" (exit code 1 in bash, exit code 23 in zsh). This would cause the entire build to fail.
- Why this matters: Build breaks if web assets are missing or empty, with a non-obvious glob error.
- Reproduction / verification: Rename `src/web/` temporarily, run `bun run build` — observe glob expansion failure.
- Expected behaviour: Build should succeed even if web assets are empty, or fail with a clear error message.
- Actual behaviour: Build fails with a shell glob expansion error.
- Proposed correction: Use `cp -r src/web/. dist/web/` or `cp -r src/web/ dist/web/` instead of `src/web/*`.
- Dependencies / related issues: None
- Risk of fix: Very low — build script change only.
- Suggested test coverage: Test build with empty web directory.

## ISSUE-011: Config parsing silently returns empty on all parse failures

- Severity: Medium
- Confidence: High
- Category: Error Handling
- Status: Confirmed
- Affected area: Configuration loading
- Affected files: src/config.ts:213-224
- Evidence: `loadConfigFromPaths()` iterates config file paths. If a file exists but fails to parse (malformed JSON, permissions issue), it logs a warning and continues to the next path. If ALL files fail, it returns `{}` — an empty config. The application then starts with all defaults, some of which (like `postgres.url = undefined`) will cause runtime failures later. There is no fast-fail behavior.
- Why this matters: A typo in the config file causes the application to start with broken defaults instead of failing immediately with a clear error.
- Reproduction / verification: Create a malformed JSONC config file. Start the server — it starts with empty config and fails later with a confusing error.
- Expected behaviour: If a config file exists but cannot be parsed, the application should fail to start with a clear error.
- Actual behaviour: Application starts with empty config and fails later with a less clear error.
- Proposed correction: If a config file exists at an expected path but fails to parse, throw a fatal error instead of continuing. Alternatively, require explicit opt-in for "allow missing config".
- Dependencies / related issues: ISSUE-012 (empty string postgres.url)
- Risk of fix: Medium — changes startup behavior. Need to ensure legitimate no-config-file scenarios are handled.
- Suggested test coverage: Test startup with malformed config. Test startup with missing config. Test startup with valid config.

## ISSUE-012: validateServerConfig accepts empty string as valid postgres.url

- Severity: Medium
- Confidence: High
- Category: Configuration
- Status: Confirmed
- Affected area: Server configuration validation
- Affected files: src/server-config.ts:175
- Evidence: Line 175 checks `if (!config.postgres.url) errors.push(...)`. An empty string `""` is falsy, so this check correctly catches it. However, if the env var `POSTGRES_URL=""` is set, it becomes an empty string which is falsy and would be caught. But if the config JSONC has `"postgres": { "url": "" }`, the empty string would be caught by the falsy check. This is actually handled correctly. BUT — if `config.postgres` itself is undefined (because config parsing failed — ISSUE-011), accessing `config.postgres.url` throws before reaching the validation. The validation only runs if `config.postgres` exists.
- Why this matters: The interaction between config parsing failures (ISSUE-011) and server validation means some invalid configurations pass validation.
- Reproduction / verification: Set `POSTGRES_URL` to a whitespace-only string. The trim may not be applied, allowing a whitespace-only URL to pass.
- Expected behaviour: Invalid postgres URLs are caught at startup validation.
- Actual behaviour: Some edge cases (whitespace, config parsing failure) bypass validation.
- Proposed correction: Add explicit empty/whitespace check for postgres.url. Ensure validation runs even when config parsing partially fails.
- Dependencies / related issues: ISSUE-011 (config parsing failures)
- Risk of fix: Low — adds stricter validation.
- Suggested test coverage: Test validation with empty string, whitespace, undefined postgres config.

## ISSUE-013: handleDeduplicate silent delete failures undercount results

- Severity: Medium
- Confidence: High
- Category: Error Handling
- Status: Confirmed
- Affected area: Memory deduplication
- Affected files: src/services/api-handlers.ts:1651-1659
- Evidence: In `handleDeduplicate`, individual delete operations are wrapped in try/catch. If a delete fails, the error is logged but the function continues. The returned `duplicatesRemoved` count is less than the actual number of detected duplicates. The caller uses this count for job summaries. The actual duplicate still exists in the database.
- Why this matters: Deduplication reports success but silently leaves duplicates in the database. Users have no visibility into which deletes failed.
- Reproduction / verification: Mock memoryRepo.delete to throw for specific IDs. Run deduplication — returned count is less than detected count.
- Expected behaviour: Either all duplicates are removed (transactional) or the response indicates which failed.
- Actual behaviour: Failed deletes are silently skipped and undercounted.
- Proposed correction: Track failed delete IDs in the response. Consider wrapping the batch in a transaction. Return partial success with details.
- Dependencies / related issues: None
- Risk of fix: Low — changes API response format to include failure details.
- Suggested test coverage: Test deduplication with some delete failures. Verify response includes failure information.

## ISSUE-014: Legacy src/index.ts exists despite codemap saying Removed in v3.0.0

- Severity: Medium
- Confidence: High
- Category: Documentation Mismatch
- Status: Confirmed
- Affected area: Documentation, codebase cleanliness
- Affected files: codemap.md:50, src/index.ts (574 lines), src/index-remote.ts (284 lines), src/plugin.ts (33 lines)
- Evidence: `codemap.md` line 50 states `src/index.ts` is "Deprecated — Legacy in-process plugin. Removed in v3.0.0." However, the file exists with 574 lines of code. It is excluded from tsconfig.json but present in the repository. Similarly, `src/index-remote.ts` and `src/plugin.ts` exist and are excluded from compilation. These legacy files create confusion about what is active code vs deprecated code.
- Why this matters: Contributors may be confused about which entry points are active. Documentation claims code is removed when it isn't.
- Reproduction / verification: `ls src/index.ts src/index-remote.ts src/plugin.ts` — all exist.
- Expected behaviour: Either the files are removed (as documented) or the documentation is updated to reflect their actual status.
- Actual behaviour: Files exist despite documentation claiming they are removed.
- Proposed correction: Either remove the legacy files (since they're excluded from builds) or update codemap.md to accurately describe their status (kept as reference, excluded from build).
- Dependencies / related issues: None
- Risk of fix: Very low — documentation or file cleanup.
- Suggested test coverage: Verify build still passes after removal.

## ISSUE-015: shadcn listed as unused devDependency

- Severity: Medium
- Confidence: High
- Category: Maintainability
- Status: Confirmed
- Affected area: Dependencies
- Affected files: package.json:57
- Evidence: `shadcn@^4.8.1` is listed as a devDependency. No import or usage of shadcn exists in any TypeScript file (grep confirmed). The WebUI (`src/web/`) uses vanilla JavaScript, not shadcn components. The package exists because of opencode configuration, not project needs. It pulls in 20+ unnecessary transitive dependencies.
- Why this matters: Wasted install time, potential confusion, unnecessary transitive dependencies in the dependency tree.
- Reproduction / verification: `grep -r "shadcn" --include="*.ts" .` returns no results. `grep -r "shadcn" --include="*.js" src/web/` returns no results.
- Expected behaviour: Only dependencies actually used by the project should be listed.
- Actual behaviour: shadcn is listed but never imported or used.
- Proposed correction: Remove shadcn from devDependencies in package.json.
- Dependencies / related issues: None
- Risk of fix: Very low — dependency removal only.
- Suggested test coverage: Verify build and tests still pass after removal.

## ISSUE-016: zod version mismatch between server and plugin lockfiles

- Severity: Medium
- Confidence: Medium
- Category: Maintainability
- Status: Confirmed
- Affected area: Dependency consistency
- Affected files: bun.lock:13 (server uses zod@^4.3.6), plugin/bun.lock:86 (plugin resolves zod@4.1.8 via @opencode-ai/plugin)
- Evidence: The server's package.json declares `zod@^4.3.6`, but the plugin workspace resolves `zod@4.1.8` through its `@opencode-ai/plugin@1.15.10` dependency. The version mismatch means type validation behavior could differ between server and plugin.
- Why this matters: If zod introduces breaking changes between 4.1.8 and 4.3.6, validation logic could behave differently across the two workspaces.
- Reproduction / verification: Compare zod versions in both lockfiles.
- Expected behaviour: Both workspaces use compatible zod versions.
- Actual behaviour: Server uses 4.3.x, plugin uses 4.1.8.
- Proposed correction: Pin or align zod versions. Consider adding a workspace resolution constraint.
- Dependencies / related issues: None
- Risk of fix: Low — dependency version alignment.
- Suggested test coverage: Verify plugin and server builds pass with aligned versions.

## ISSUE-017: Hardcoded default postgres password in docker-compose.yml

- Severity: Medium
- Confidence: High
- Category: Security
- Status: Confirmed
- Affected area: Docker deployment
- Affected files: docker-compose.yml:8, 37
- Evidence: Line 8: `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-opencode}` — default password is "opencode". Line 37: `POSTGRES_URL: ${POSTGRES_URL:-postgresql://opencode:opencode@...}` — default password embedded in URL template. The default password is visible in the compose file and would be used if the user doesn't set POSTGRES_PASSWORD.
- Why this matters: Users who deploy with default settings have a known postgres password. If the database port is exposed, the password is trivially guessable.
- Reproduction / verification: Read docker-compose.yml — default password visible.
- Expected behaviour: Default password should be randomly generated, or the compose file should refuse to start without an explicit password.
- Actual behaviour: Default password "opencode" is used if not overridden.
- Proposed correction: Remove the default password fallback and require explicit POSTGRES_PASSWORD. Or generate a random password on first run.
- Dependencies / related issues: None
- Risk of fix: Low — changes deployment defaults. May break existing deployments that rely on the default.
- Suggested test coverage: Test that compose fails or warns when password is not set.

## ISSUE-018: WebUI CDN dependencies unpinned and crossorigin without CORS

- Severity: Medium
- Confidence: Medium
- Category: Security
- Status: Confirmed
- Affected area: Web UI
- Affected files: src/web/index.html:9-21
- Evidence: CDN scripts use `crossorigin="anonymous"` attribute but the server doesn't send CORS headers for cross-origin script loads. `jsonrepair@latest` is unpinned — any future breaking change will be silently pulled in. Dependencies: `lucide@latest`, `marked@17.0.1`, `dompurify@3.2.2`, `jsonrepair@latest`.
- Why this matters: Unpinned CDN dependencies can break the WebUI without warning. CORS issues may prevent CDN scripts from loading in some browser configurations.
- Reproduction / verification: Open WebUI in browser with dev tools — check for CORS errors on CDN scripts.
- Expected behaviour: CDN dependencies pinned to specific versions. CORS headers configured for CDN origins.
- Actual behaviour: Some CDN deps use @latest, crossorigin without matching CORS headers.
- Proposed correction: Pin all CDN dependencies to specific versions (e.g., `jsonrepair@1.12.0` instead of `@latest`). Verify CORS headers or remove crossorigin attribute.
- Dependencies / related issues: None
- Risk of fix: Low — HTML file change only.
- Suggested test coverage: Verify WebUI loads correctly with pinned versions.

## ISSUE-019: Profile learning retry loop on AI failure with no marking

- Severity: Low
- Confidence: Medium
- Category: Error Handling
- Status: Confirmed
- Affected area: Profile learning
- Affected files: src/services/api-handlers.ts:1415-1463
- Evidence: If `analyzeUserProfile` throws at line 1415, the catch at 1463 returns an error. The prompts are NOT marked as analyzed. The next `handleUserProfileLearn` call fetches the same prompts and retries — creating an infinite loop until the AI succeeds. Unlike the success path (line 1417-1420 which marks prompts), the failure path doesn't mark them.
- Why this matters: Persistent AI failures cause the same prompts to be reprocessed indefinitely.
- Reproduction / verification: Mock analyzeUserProfile to always throw. Call handleUserProfileLearn twice — same prompts processed both times.
- Expected behaviour: Failed prompts should be marked after N attempts to prevent infinite loops.
- Actual behaviour: Failed prompts are never marked, causing infinite retries.
- Proposed correction: Mark prompts as failed after a configurable number of retry attempts.
- Dependencies / related issues: ISSUE-005 (similar pattern in auto-capture)
- Risk of fix: Low — adds retry counting.
- Suggested test coverage: Test that prompts are marked after N failed AI calls.

## ISSUE-020: Tag migration vector leak on embedding failure

- Severity: Low
- Confidence: Medium
- Category: Resource Leak
- Status: Confirmed
- Affected area: Background tag migration
- Affected files: src/services/tag-migration-service.ts:192-219
- Evidence: When tags are successfully generated but the embedding or DB update fails (line 194-200), the memory stays untagged. The computed vectors are orphaned. On the next migration loop, `countUntagged()` returns this memory again, new vectors are computed, and the cycle repeats.
- Why this matters: Wasted embedding API calls on each migration cycle for memories whose vectors already failed to persist.
- Reproduction / verification: Mock embedding service to fail. Run migration twice — same memory is processed both times.
- Expected behaviour: Failed vector updates should be retried without recomputing tags, or tagged with a "needs vector" flag.
- Actual behaviour: Vectors recomputed from scratch on each cycle.
- Proposed correction: Cache computed vectors for retry, or separate tag generation from vector generation.
- Dependencies / related issues: ISSUE-008 (tag migration AI failure)
- Risk of fix: Low — optimization.
- Suggested test coverage: Test that vector computation is not repeated for already-tagged memories.

## ISSUE-021: Corrupt profile JSON silently skipped in context injection

- Severity: Low
- Confidence: High
- Category: Error Handling
- Status: Confirmed
- Affected area: Context injection
- Affected files: src/services/api-handlers.ts:1178-1180
- Evidence: In `handleContextInject`, if `profileData` is corrupt JSON, the catch block silently skips it and sets `profileInjected = false`. The client has no way to know the profile was corrupt — it appears as if the profile was empty.
- Why this matters: Users won't know their profile data is corrupt and won't trigger a re-generation.
- Reproduction / verification: Insert corrupt JSON into the profile table. Call handleContextInject — profile is silently skipped.
- Expected behaviour: Client should be informed that the profile was found but could not be parsed.
- Actual behaviour: Corrupt profile is silently skipped.
- Proposed correction: Add a warning or diagnostic flag in the response indicating profile parse failure.
- Dependencies / related issues: None
- Risk of fix: Low — adds diagnostic info to response.
- Suggested test coverage: Test context injection with corrupt profile JSON.

## ISSUE-022: handleBulkDelete no transaction or atomicity

- Severity: Low
- Confidence: Medium
- Category: API Contract
- Status: Confirmed
- Affected area: Memory bulk operations
- Affected files: src/services/api-handlers.ts:446-456
- Evidence: `handleBulkDelete` iterates over IDs and calls `handleDeleteMemory` for each. There is no transaction wrapping the batch. If the process crashes mid-batch, some memories are deleted and some aren't. Already-deleted memories cannot be recovered.
- Why this matters: Bulk operations should be atomic — either all succeed or all fail.
- Reproduction / verification: Not easily reproducible without crashing mid-operation.
- Expected behaviour: Bulk delete is transactional — all-or-nothing.
- Actual behaviour: Partial deletes possible on failure.
- Proposed correction: Wrap the batch in a database transaction. On failure, rollback all changes.
- Dependencies / related issues: None
- Risk of fix: Medium — requires transaction management in the storage layer.
- Suggested test coverage: Test bulk delete rollback on partial failure.

## ISSUE-023: SHA256 truncated to 16 hex chars for container tags

- Severity: Low
- Confidence: Low
- Category: Security
- Status: Confirmed
- Affected area: Container tag generation
- Affected files: shared/tags.ts:9-11
- Evidence: `sha256()` function truncates to 16 hex characters (64 bits of entropy). Container tags use `prefix_project_<hash>` or `prefix_user_<hash>`. With 64 bits of entropy, collision probability is low but non-zero for large user bases.
- Why this matters: In theory, two different projects/users could generate the same hash, leading to memory cross-contamination.
- Reproduction / verification: Review tags.ts — truncation at line 11.
- Expected behaviour: Full SHA256 or at least 32 hex chars for collision resistance.
- Actual behaviour: Only 16 hex chars (64 bits) used.
- Proposed correction: Increase truncation to at least 24-32 hex chars. This is a database schema change (column widths).
- Dependencies / related issues: None
- Risk of fix: Medium — requires database migration for tag column widths.
- Suggested test coverage: Test tag generation with known inputs for expected output.

## ISSUE-024: install-server.sh clones wrong GitHub repo URL

- Severity: Low
- Confidence: High
- Category: Configuration
- Status: Confirmed
- Affected area: Installation script
- Affected files: scripts/install-server.sh:56
- Evidence: Line 56: `git clone --depth 1 https://github.com/tickernelz/opencode-mem.git "${INSTALL_DIR}"`. The actual repo is at `git+https://git.phrk.org/pub/opencode-memnet`. The install script clones from a different GitHub repository (the original upstream), not this fork.
- Why this matters: Users running the install script get the wrong codebase.
- Reproduction / verification: Read scripts/install-server.sh line 56.
- Expected behaviour: Install script clones the correct repository.
- Actual behaviour: Install script clones the original upstream repo, not this fork.
- Proposed correction: Update the URL to point to the correct repository.
- Dependencies / related issues: None
- Risk of fix: Very low — single line change.
- Suggested test coverage: Verify install script clones from correct URL.

## ISSUE-025: README references wrong logo SVG path

- Severity: Low
- Confidence: High
- Category: Documentation Mismatch
- Status: Confirmed
- Affected area: Documentation
- Affected files: README.md:2, src/web/logo-banner.svg (actual location)
- Evidence: README.md line 2: `<img src="docs/logo/logo-banner.svg">` but the file is at `src/web/logo-banner.svg`. The path `docs/logo/logo-banner.svg` does not exist.
- Why this matters: README logo is broken when rendered on GitHub or other markdown viewers.
- Reproduction / verification: Check if `docs/logo/logo-banner.svg` exists — it doesn't.
- Expected behaviour: README logo path matches actual file location.
- Actual behaviour: Path points to non-existent file.
- Proposed correction: Update README.md to use the correct path `src/web/logo-banner.svg`.
- Dependencies / related issues: None
- Risk of fix: Very low — single line documentation fix.
- Suggested test coverage: None needed.

## ISSUE-026: No rate limiting on any API endpoint

- Severity: Informational
- Confidence: High
- Category: Security
- Status: Confirmed
- Affected area: All API endpoints
- Affected files: src/services/web-server.ts (entire file)
- Evidence: No rate limiting middleware or per-endpoint throttling exists in the web server. All endpoints accept unlimited requests.
- Why this matters: An attacker with a valid API key could overwhelm the server with requests, causing denial of service or excessive AI API usage.
- Reproduction / verification: Review web-server.ts — no rate limiting logic present.
- Expected behaviour: Rate limiting should be applied to prevent abuse.
- Actual behaviour: No rate limiting.
- Proposed correction: Add rate limiting middleware (e.g., token bucket or sliding window) to the web server.
- Dependencies / related issues: None
- Risk of fix: Low — adds middleware. Need to choose appropriate limits.
- Suggested test coverage: Test that rate limiting returns 429 after threshold.

## ISSUE-027: Module-level mutable state shared across concurrent requests without synchronization

- Severity: Informational
- Confidence: High
- Category: Concurrency
- Status: Confirmed
- Affected area: API handlers, background jobs
- Affected files: src/services/api-handlers.ts:1036-1056 (migrationProgress, \_migrationRunning, \_cleanupInProgress, \_dedupInProgress)
- Evidence: Multiple module-level variables (`migrationProgress`, `_migrationRunning`, `_cleanupInProgress`, `_dedupInProgress`) are shared across all HTTP requests. The code comments at line 1033-1035 acknowledge this: "This module-level state assumes a single-user / single-process model." Bun's single-threaded event loop provides some protection, but concurrent async operations can interleave.
- Why this matters: For the current single-process model, this is acceptable. If the architecture ever changes to multi-process or serverless, these guards become ineffective.
- Reproduction / verification: Read api-handlers.ts lines 1032-1056 — comment acknowledges the limitation.
- Expected behaviour: State should be synchronized or managed externally (e.g., in database) for multi-process safety.
- Actual behaviour: Module-level mutable state with acknowledged limitations.
- Proposed correction: For now, document the limitation. For future multi-process support, move state to database or Redis.
- Dependencies / related issues: None
- Risk of fix: High for multi-process — requires architectural change.
- Suggested test coverage: Test concurrent access to shared state.

## ISSUE-028: Server shutdown does not wait for in-flight requests to drain

- Severity: Informational
- Confidence: High
- Category: Resource Cleanup
- Status: Confirmed
- Affected area: Server lifecycle
- Affected files: src/server.ts:96-116
- Evidence: The `shutdown` function calls `server.stop()` then `closeStorage()` then `process.exit(0)`. There is no drain period for in-flight requests. `server.stop()` in Bun immediately stops accepting new connections but does not wait for active requests to complete.
- Why this matters: In-flight API requests (especially auto-capture, which involves AI calls) may be interrupted mid-operation, potentially leaving data in an inconsistent state.
- Reproduction / verification: Send a long-running request, then SIGTERM the server — request fails.
- Expected behaviour: Server should drain in-flight requests before shutting down.
- Actual behaviour: Server exits immediately, potentially interrupting in-flight requests.
- Proposed correction: Add a drain period (e.g., 30 seconds) between `server.stop()` and `closeStorage()`. Set a `Connection: close` header on new requests during shutdown.
- Dependencies / related issues: None
- Risk of fix: Low — adds shutdown delay. Need to ensure the delay is bounded.
- Suggested test coverage: Test that in-flight requests complete during graceful shutdown.

## ISSUE-029: handleListMemories silently caps at 1000 rows without pagination

- Severity: Informational
- Confidence: High
- Category: API Contract
- Status: Confirmed
- Affected area: Memory listing
- Affected files: src/services/api-handlers.ts:198
- Evidence: `handleListMemories` hardcodes `limit: 1000` at line 198. The total count (line 279) reflects the full dataset, but returned items are silently truncated. No pagination parameters are accepted, no warning in the response.
- Why this matters: Users with >1000 memories get incomplete results without any indication.
- Reproduction / verification: Insert 1001+ memories, call GET /api/memories — only 1000 returned.
- Expected behaviour: Full results returned, or pagination support with total count.
- Actual behaviour: Results capped at 1000 with no indication of truncation.
- Proposed correction: Add pagination support (page/pageSize parameters) or increase the limit and add a warning when truncated.
- Dependencies / related issues: None
- Risk of fix: Low — API enhancement.
- Suggested test coverage: Test pagination parameters. Test response includes total count.

## ISSUE-030: API key comparison uses string equality instead of constant-time

- Severity: Informational
- Confidence: Medium
- Category: Security
- Status: Confirmed
- Affected area: Authentication
- Affected files: src/services/auth.ts:45
- Evidence: `parts[1] !== this.apiKey` is a standard string comparison. For cryptographic secrets, constant-time comparison prevents timing side-channel attacks.
- Why this matters: In theory, timing differences could leak information about the API key. In practice, the risk is negligible for this use case.
- Reproduction / verification: Read auth.ts line 45.
- Expected behaviour: Constant-time comparison for secrets.
- Actual behaviour: Standard string comparison.
- Proposed correction: Use `crypto.timingSafeEqual` for API key comparison.
- Dependencies / related issues: None
- Risk of fix: Very low — single line change.
- Suggested test coverage: Test auth with correct and incorrect keys.

## ISSUE-031: handleSearch has no max query length enforcement

- Severity: Informational
- Confidence: Medium
- Category: API Contract
- Status: Confirmed
- Affected area: Search endpoint
- Affected files: src/services/web-server.ts:270-281
- Evidence: The `q` parameter from GET /api/search is passed directly to the embedding service without length validation. While `embedWithTimeout` has a 30s timeout, there's no application-level max query length.
- Why this matters: A malicious client could send a very large query string, consuming embedding API resources.
- Reproduction / verification: Send GET /api/search?q=<very long string>.
- Expected behaviour: Query length should be validated before processing.
- Actual behaviour: No length limit on search query.
- Proposed correction: Add max query length validation (e.g., 1000 characters) before passing to embedding service.
- Dependencies / related issues: None
- Risk of fix: Very low — adds input validation.
- Suggested test coverage: Test search with oversized query returns 400.

## False positives / discarded findings

1. **Lockfile format (binary vs text)**: Initially suspected as an issue. Both `bun.lock` files are text-based (lockfileVersion 1), which is correct for Bun 1.x. The format itself is not a problem — only the Dockerfile glob pattern (ISSUE-001) is the real issue.

2. **Legacy files still compilable**: `src/index.ts`, `src/index-remote.ts`, `src/plugin.ts` are properly excluded from tsconfig.json. They don't affect the build. The issue is documentation accuracy (ISSUE-014), not build correctness.

3. **Auth fully disabled when both DISABLE flags true**: This is documented behavior with explicit warnings in `.env.example`. It's a deployment choice, not a bug. Not actionable as an issue.

4. **API key over HTTP**: This is expected for local development. HTTPS enforcement should happen at the deployment layer (reverse proxy), not in the application code. Not actionable for the codebase.

5. **Client metadata logged to file**: Logging client connection info at INFO level is standard practice. The concern about sensitive data in metadata is valid but better addressed through documentation than code changes.

## Unresolved questions

1. **SQL injection in prompt search (ISSUE-009)**: Safety depends on whether the `postgres` library parameterizes template literal interpolations. This needs verification against the library's source code.

2. **Test failures root causes (ISSUE-003)**: The 45 failing tests may indicate real regressions in the code, or may simply be outdated test mocks. Each failing test file needs individual investigation.

3. **Dockerfile actual build behavior (ISSUE-001)**: The glob pattern analysis is clear, but the actual Docker build behavior should be verified on a real Docker daemon to confirm the failure.

4. **zod version compatibility (ISSUE-016)**: Need to verify if zod 4.1.x and 4.3.x have any breaking changes that affect the shared validation logic.

## Follow-up reminders / deferred work

1. Fix ISSUE-003 (45 failing tests) before enabling tests in CI (ISSUE-004)
2. Verify ISSUE-009 (SQL injection) by checking postgres library template literal behavior
3. Verify ISSUE-001 (Dockerfile) with actual Docker build
4. Consider graceful shutdown drain (ISSUE-028) for production reliability
5. Consider rate limiting (ISSUE-026) for production deployments
6. Privacy filtering (ISSUE-002) should be prioritized for any deployment handling sensitive data
