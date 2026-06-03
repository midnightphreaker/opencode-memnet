# Codebase Audit Issues

## Audit scope

- Repository: opencode-memnet
- Branch: (current working branch)
- Commit: (HEAD)
- User scope argument: LLM is not tagging un-tagged memories anymore
- Audit run directory: .opencode/orchestrator/CodebaseAudit/02/
- Date/time: 2026-06-01
- Tools used: sequential-thinking, explorer subagents (x3), fixer subagent
- Commands run: git diff docker-compose.yml, git log --oneline -5 (via subagent); grep searches (via explorer subagents)
- Commands skipped: npm test (not relevant to pipeline investigation); type checking (TypeScript build not run)
- Limitations: No live server logs inspected; no database queries run against live instance; exact user deployment configuration unknown

## Orchestration assistance tools

- sequential-thinking used: Yes
- sequential-thinking limitation: None
- reminders used: Yes
- reminders limitation: None
- reminders/follow-ups created: rem_1780292315623_jirwb — audit in progress, artifacts pending

## Summary

| Severity      | Count |
| ------------- | ----- |
| Critical      | 1     |
| High          | 2     |
| Medium        | 1     |
| Low           | 0     |
| Informational | 0     |

## Issue index

| ID        | Severity | Confidence | Category       | Status    | Title                                                                          |
| --------- | -------- | ---------- | -------------- | --------- | ------------------------------------------------------------------------------ |
| ISSUE-001 | Critical | High       | Bug            | Confirmed | Background tag migration fetches only first 1000 memories with no scope filter |
| ISSUE-002 | High     | High       | Bug            | Confirmed | containerTag filter silently excludes valid untagged memories                  |
| ISSUE-003 | High     | Medium     | Error Handling | Probable  | Missing validation for memoryModel/memoryApiUrl at server startup              |
| ISSUE-004 | Medium   | High       | Error Handling | Confirmed | Tag registry dual-write failures silently swallowed                            |

## Issues

## ISSUE-001: Background tag migration fetches only first 1000 memories with no scope filter

- Severity: Critical
- Confidence: High
- Category: Bug
- Status: Confirmed
- Affected area: Background tag migration pipeline
- Affected files:
  - `src/services/storage/postgres/memory-repository.ts` lines 557-563 (`getAllWithVectors()`)
  - `src/services/tag-migration-service.ts` lines 147-213 (`runTagMigration()`)
- Evidence:
  - `memory-repository.ts:559-561`: SQL query `SELECT * FROM memories ORDER BY created_at ASC LIMIT 1000 OFFSET 0` — hard-coded limit, no scope filter, no pagination
  - `tag-migration-service.ts:147`: `countUntagged()` correctly counts ALL untagged project-scoped memories via `SELECT COUNT(*) FROM memories WHERE scope = 'project' AND (tags IS NULL OR tags = '')`
  - `tag-migration-service.ts:160`: `getAllWithVectors()` returns at most 1000 rows with NO scope filter
  - When `countUntagged() > 0` but all untagged memories are beyond row 1000, the `untagged` array (line 164) is empty, no LLM calls are made
- Why this matters: This is THE primary cause of "LLM not tagging un-tagged memories." The background migration loop reports untagged count > 0 but processes zero memories because they are beyond the 1000-row limit. The loop sleeps 5 seconds and retries indefinitely, never reaching the LLM call.
- Reproduction / verification:
  1. Have >1000 total memories in the database
  2. Ensure some memories beyond row 1000 are untagged project-scoped
  3. Start the server — `countUntagged()` reports > 0
  4. Observe: no LLM calls happen, no tags are generated
  5. Check logs: `"tag-migration: status"` messages show `countUntagged: N > 0` but `processed: 0`
- Expected behaviour: Background migration should query ALL untagged project-scoped memories and process them, not just the first 1000 total memories.
- Actual behaviour: Only first 1000 memories (any scope) are fetched. In-memory filter for `_project_` and untagged further reduces the set. Memories beyond row 1000 are never processed.
- Proposed correction: Replace `getAllWithVectors()` + in-memory filtering with a targeted database query that fetches only untagged project-scoped memories, or add pagination to iterate through all memories in batches.
- Dependencies / related issues: ISSUE-002 (containerTag filter compounds the exclusion)
- Risk of fix: Low — changing the query to target untagged project memories is additive and doesn't affect other paths.
- Suggested test coverage: Integration test with >1000 memories verifying tag migration processes all untagged project memories, not just the first 1000.

## ISSUE-002: containerTag filter silently excludes valid untagged memories

- Severity: High
- Confidence: High
- Category: Bug
- Status: Confirmed
- Affected area: Background tag migration filtering
- Affected files:
  - `src/services/tag-migration-service.ts` lines 160-162
- Evidence:
  - Line 160-162: `const allRecords = (await memoryRepo.getAllWithVectors()).filter((r) => r.containerTag.includes("_project_"));`
  - Memories with containerTag values like `"test-data"`, `"client-tag"`, or any non-`_project_` value are silently excluded
  - No logging when memories are filtered out by this condition
  - The test data scripts use `containerTag: "test-data"` which would be excluded
- Why this matters: Even within the first 1000 memories, this filter silently excludes any memory whose containerTag doesn't contain `_project_`. This means memories created via API (not through project-scoped auto-capture) are never tagged by the background migration.
- Reproduction / verification:
  1. Insert a memory with `containerTag: "my-custom-tag"` and no tags
  2. Start the server — `countUntagged()` counts it
  3. Observe: the memory is never processed by the background migration
  4. No log entry indicates it was skipped
- Expected behaviour: The background migration should process all untagged memories that are in project scope, regardless of containerTag format.
- Actual behaviour: Only memories with `_project_` in their containerTag are processed. Others are silently skipped.
- Proposed correction: Use the `scope` field (already checked by `countUntagged()`) instead of or in addition to `containerTag` filtering. Alternatively, fetch only project-scoped memories via SQL rather than filtering in-memory.
- Dependencies / related issues: ISSUE-001 (the LIMIT 1000 issue compounds this — even if the filter were correct, only 1000 rows are examined)
- Risk of fix: Low — broadening the filter to include all project-scoped memories is more correct, not less.
- Suggested test coverage: Unit test verifying memories with various containerTag formats are processed when they are project-scoped and untagged.

## ISSUE-003: Missing validation for memoryModel/memoryApiUrl at server startup

- Severity: High
- Confidence: Medium
- Category: Error Handling
- Status: Probable
- Affected area: Server configuration and validation
- Affected files:
  - `src/services/ai/provider-config.ts` lines 22-23 (`buildMemoryProviderConfig()`)
  - `src/server-config.ts` lines 133-134 (env var loading)
  - `src/services/tag-migration-service.ts` line 176 (unprotected provider config call)
- Evidence:
  - `provider-config.ts:22-23`: `if (!config.memoryModel || !config.memoryApiUrl) { throw new Error("External API not configured for memory provider"); }`
  - `server-config.ts:133-134`: `memoryModel: env.MEMORY_MODEL || undefined`, `memoryApiUrl: env.MEMORY_API_URL || undefined` — loaded as optional
  - `server-config.ts` validation (lines 171-184): does NOT validate these fields
  - `tag-migration-service.ts:176`: `const providerConfig = buildMemoryProviderConfig(CONFIG, {...})` — no try/catch around this specific call
  - Error propagates to outer catch at line 226, logged as `"tag-migration: fatal error"`
  - Loop continues sleeping 5 seconds, retrying and hitting the same error indefinitely
- Why this matters: If `MEMORY_MODEL` and `MEMORY_API_URL` are not configured, the tag migration fails on every cycle with no clear user-facing feedback. The user sees "LLM not tagging" but gets no actionable error message. The server starts successfully but tagging silently fails.
- Reproduction / verification:
  1. Start the server without `MEMORY_MODEL` or `MEMORY_API_URL` env vars
  2. Server starts successfully
  3. Insert untagged memories
  4. Observe: no LLM calls, `"tag-migration: fatal error"` logged every 5 seconds
- Expected behaviour: Server should either (a) fail to start with a clear error when LLM tagging is required but not configured, or (b) log a clear warning at startup and skip tag migration gracefully.
- Actual behaviour: Server starts fine. Tag migration loop fails silently every 5 seconds with only a log message, no user-facing feedback.
- Proposed correction: Add `MEMORY_MODEL` and `MEMORY_API_URL` validation to `validateServerConfig()`, or add a startup check that warns clearly when these are missing and tag migration is enabled.
- Dependencies / related issues: None
- Risk of fix: Low — adding validation is purely defensive. Existing deployments with these vars configured are unaffected.
- Suggested test coverage: Integration test verifying server startup behavior when MEMORY_MODEL/MEMORY_API_URL are missing.

## ISSUE-004: Tag registry dual-write failures silently swallowed

- Severity: Medium
- Confidence: High
- Category: Error Handling
- Status: Confirmed
- Affected area: Tag persistence consistency
- Affected files:
  - `src/services/api-handlers.ts` lines 379-390 (`handleAddMemory`)
  - `src/services/api-handlers.ts` lines 510-521 (`handleUpdateMemory`)
  - `src/services/api-handlers.ts` lines 1307-1314 (`handleAutoCapture`)
  - `src/services/tag-migration-service.ts` lines 198-204 (`tagMemory` in migration loop)
  - `src/services/storage/postgres/tag-registry.ts` lines 314-346 (`linkMemoryTags`)
- Evidence:
  - All four call sites wrap `tagRegistry.linkMemoryTags()` in try/catch with error-only logging:
    ```typescript
    try {
      await tagRegistry.linkMemoryTags(id, tags);
    } catch (e) {
      log("tag-registry: linkMemoryTags failed", { id, error: String(e) });
    }
    ```
  - The memory is already stored successfully before the dual-write attempt
  - If `linkMemoryTags()` fails, the memory has tags in the `memories` table but NOT in the canonical tag registry tables (`memory_tags`, `memory_tag_links`)
  - No rollback, no retry, no user-facing error
  - `PostgresTagRegistry.initialize()` is a no-op (line 120-122) — no connectivity check
- Why this matters: Over time, the tag registry tables diverge from the memories table. Queries against the canonical tag registry return incomplete results while the memories table has correct tags. This is a silent data consistency issue.
- Reproduction / verification:
  1. Cause `linkMemoryTags()` to fail (e.g., corrupt the `memory_tags` table, or introduce a transient SQL error)
  2. Add a memory with tags
  3. Check: memory has tags in `memories` table but NOT in `memory_tags`/`memory_tag_links`
  4. No user-facing error or warning
- Expected behaviour: Either (a) the dual-write should be transactional so failures roll back the memory insert, or (b) failures should be clearly surfaced and retried, or (c) there should be a reconciliation process that detects and fixes inconsistencies.
- Actual behaviour: Failures are logged and ignored. Data inconsistency accumulates silently.
- Proposed correction: Add reconciliation logging that periodically compares `memories.tags` against `memory_tag_links` for the same memory ID, and log warnings when discrepancies are found. Optionally, add a startup reconciliation pass.
- Dependencies / related issues: None
- Risk of fix: Low — adding reconciliation checks is read-only and doesn't affect existing behavior.
- Suggested test coverage: Integration test verifying that after a simulated `linkMemoryTags` failure, the discrepancy is detected and logged.

## False positives / discarded findings

1. **Nickname field in shared/client-config.ts breaking config loading** — Investigated and rejected. The `nickname?: string` field is optional, client-side only, and has no dependency path to the LLM provider or tag migration service. Not the cause of the tagging issue.

2. **Plugin nickname sync block breaking auto-capture** — Investigated and rejected. The sync block (index-remote.ts:85-93) is wrapped in `.catch(() => {})` and runs after connection success. It cannot prevent auto-capture or event handler registration.

3. **Docker-compose.yml image tag change** — Investigated and rejected. The change from `${OPENCODE-MEMNET_IMAGE_TAG:-latest}` to hardcoded `latest` is cosmetic; the image is built locally from the Dockerfile.

4. **Tag registry blocking LLM calls** — Investigated and rejected. All `linkMemoryTags()` calls occur AFTER the LLM call completes and are wrapped in try/catch. A tag registry failure cannot prevent the LLM from being called.

## Unresolved questions

1. **Is the auto-capture path (Path A) also broken?** — The investigation found that `generateSummary()` calls the LLM directly and appears functional. However, we did not verify whether auto-capture is actually triggering for the user's setup. If the user's memories are created via API (not auto-capture), they rely solely on the broken background migration (Path B).

2. **Are MEMORY_MODEL and MEMORY_API_URL configured in the user's deployment?** — If not, ISSUE-003 is the root cause. If yes, ISSUE-001 and ISSUE-002 are the root causes. We could not verify this without access to the running container's environment.

3. **What is the total memory count in the user's database?** — If <1000, ISSUE-001 is less relevant and ISSUE-002 is the primary concern. If >1000, ISSUE-001 is the primary concern.

## Follow-up reminders / deferred work

1. Verify which path (auto-capture vs background migration) the user expects for tagging
2. Check if MEMORY_MODEL/MEMORY_API_URL are configured in the user's Docker deployment
3. Check total memory count in the user's database to confirm ISSUE-001 relevance
4. Consider adding startup reconciliation for tag registry consistency (ISSUE-004)
