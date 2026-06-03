# Codebase Audit Fix Specification

## Source artifacts

- ISSUES.md: .opencode/orchestrator/CodebaseAudit/02/ISSUES.md

## Scope

Fix the background tag migration pipeline so that LLM tagging processes ALL untagged project-scoped memories, not just the first 1000 total memories. Add proper startup validation for required LLM configuration. Improve visibility of tag registry failures.

## Non-goals

- Do not change the auto-capture path (Path A) — it appears functional
- Do not change the tag registry schema or migration logic
- Do not add new features beyond fixing the identified issues
- Do not modify the Web UI
- Do not modify the plugin or client-side code
- Do not modify the embedding service

## Requirements

- REQ-001: Replace the unbounded `getAllWithVectors()` + in-memory filter approach in `runTagMigration()` with a targeted database query that fetches only untagged project-scoped memories, or add proper pagination that iterates through all memories in configurable batches.
- REQ-002: Ensure the containerTag filter does not silently exclude valid project-scoped memories. Use the `scope` field (already used by `countUntagged()`) as the primary filter instead of or in addition to `containerTag`.
- REQ-003: Add `MEMORY_MODEL` and `MEMORY_API_URL` validation to the server startup validation function. When missing, either (a) log a clear warning and skip tag migration gracefully, or (b) fail to start with a clear error message.
- REQ-004: Add a startup reconciliation check or periodic consistency check between `memories.tags` and `memory_tag_links` to detect and log discrepancies caused by silent `linkMemoryTags()` failures.

## Issue-to-requirement mapping

| Issue     | Requirement IDs |
| --------- | --------------- |
| ISSUE-001 | REQ-001         |
| ISSUE-002 | REQ-002         |
| ISSUE-003 | REQ-003         |
| ISSUE-004 | REQ-004         |

## Acceptance criteria

- AC-001: Background tag migration processes ALL untagged project-scoped memories regardless of total memory count (verified with >1000 memories in database).
- AC-002: Background tag migration processes untagged memories regardless of their containerTag value, as long as they are project-scoped.
- AC-003: When MEMORY_MODEL or MEMORY_API_URL is not configured, the server logs a clear actionable warning at startup and the tag migration loop skips gracefully instead of throwing on every cycle.
- AC-004: Tag registry dual-write failures are detected and logged with enough detail to identify the affected memory and the nature of the failure.
- AC-005: Existing auto-capture path (Path A) continues to work without regression.
- AC-006: Existing API handlers continue to work without regression.
- AC-007: All existing tests pass without modification.

## Verification expectations

1. Run `npm test` — all existing tests must pass
2. Manual verification: insert >1000 memories, ensure some beyond row 1000 are untagged and project-scoped, start server, verify tag migration processes them
3. Manual verification: insert untagged memories with non-_project_ containerTag values, verify they are processed
4. Manual verification: start server without MEMORY_MODEL/MEMORY_API_URL, verify clear warning message in logs
5. Check server logs for absence of repeated "tag-migration: fatal error" messages when env vars are configured

## Constraints

- Changes must be backward-compatible with existing deployments
- Database schema changes are out of scope — use existing columns (scope, tags, container_tag)
- Must not introduce new env vars (use existing MEMORY_MODEL, MEMORY_API_URL)
- Must not change the tag-migration-service's infinite loop architecture

## Risks

- Changing the SQL query in memory-repository.ts could affect other callers of `getAllWithVectors()` — need to check call sites
- Adding scope filtering to the migration query changes the semantic meaning of the function — may need a new method instead of modifying the existing one
- Tag migration batch size changes could affect server performance under load

## Out of scope

- Auto-capture path improvements
- Tag registry schema changes
- Web UI changes
- Plugin/client changes
- Embedding service changes
- Performance optimization beyond fixing the immediate bugs

## Completion definition

All four issues are addressed. Background tag migration processes all untagged project-scoped memories. Missing LLM config is clearly communicated at startup. Tag registry failures are visible. All existing tests pass.
