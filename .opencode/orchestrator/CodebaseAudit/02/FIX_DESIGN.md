# Codebase Audit Fix Design

## Source artifacts

- ISSUES.md: .opencode/orchestrator/CodebaseAudit/02/ISSUES.md
- FIX_SPEC.md: .opencode/orchestrator/CodebaseAudit/02/FIX_SPEC.md

## Design overview

The fix addresses four issues in the LLM tagging pipeline. The core problem is that the background tag migration uses an unbounded `getAllWithVectors()` call (LIMIT 1000, no scope filter) followed by in-memory filtering, which silently excludes most untagged memories. The design adds a targeted database method and uses it in the migration loop, adds startup validation for LLM config, and improves tag registry failure visibility.

## Affected components

1. **memory-repository.ts** — Add new `getUntaggedProjectMemories()` method
2. **tag-migration-service.ts** — Replace `getAllWithVectors()` + in-memory filter with new targeted method; add pagination loop
3. **server-config.ts** — Add validation for `MEMORY_MODEL` and `MEMORY_API_URL`
4. **api-handlers.ts** — Improve error logging in `linkMemoryTags()` catch blocks
5. **storage/types.ts** — Add interface for new repository method
6. **storage/factory.ts** — Wire new method through factory

## Proposed corrections

### DES-001: New `getUntaggedProjectMemories()` repository method

**File:** `src/services/storage/postgres/memory-repository.ts`

Add a new method that queries ONLY untagged project-scoped memories with pagination:

```typescript
async getUntaggedProjectMemories(limit: number = 100, offset: number = 0): Promise<MemoryRecord[]> {
  const result = await this.pool.query(
    `SELECT * FROM memories
     WHERE scope = 'project' AND (tags IS NULL OR tags = '')
     ORDER BY created_at ASC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return result.rows.map(row => this.mapRowToMemoryRecord(row));
}
```

**Rationale:**

- `getAllWithVectors()` is used by `api-handlers.ts:1514` for pairwise similarity checks — CANNOT be modified
- The new method targets exactly what `runTagMigration()` needs: untagged, project-scoped, paginated
- Uses smaller default batch size (100) to avoid loading too many records with vectors at once
- SQL-level filtering eliminates the in-memory containerTag filter issue

**Interface changes:**

- Add `getUntaggedProjectMemories(limit?: number, offset?: number): Promise<MemoryRecord[]>` to `storage/types.ts` `MemoryRepository` interface
- Wire through `storage/factory.ts` factory

### DES-002: Refactor `runTagMigration()` to use paginated targeted query

**File:** `src/services/tag-migration-service.ts`

Replace the current approach:

```typescript
// OLD: broken
const allRecords = (await memoryRepo.getAllWithVectors()).filter((r) =>
  r.containerTag.includes("_project_")
);
const untagged = allRecords.filter((r) => !r.tags || r.tags.trim() === "");
```

With paginated targeted query:

```typescript
// NEW: targeted + paginated
const BATCH_SIZE = 100;
let offset = 0;
let totalProcessed = 0;

while (true) {
  const batch = await memoryRepo.getUntaggedProjectMemories(BATCH_SIZE, offset);
  if (batch.length === 0) break;

  for (const memory of batch) {
    const tags = await tagMemory(memory, tagList);
    if (tags && tags.length > 0) {
      await memoryRepo.updateMemoryTags(memory.id, tags.join(","));
      // dual-write to tag registry (wrapped in try/catch)
    }
    totalProcessed++;
  }

  // After processing a batch, re-query (newly tagged are excluded by SQL)
  // So we always start from offset 0 on the next batch
  offset = 0; // Reset — newly tagged memories are excluded by the WHERE clause
}
```

**Key design decisions:**

- Since the SQL query filters for untagged memories, newly-tagged memories are automatically excluded from the next query. This means we can always use offset=0 and the query naturally shrinks as we process.
- BATCH_SIZE of 100 is smaller than the old 1000 limit — reduces memory pressure (each record includes vector data)
- The `countUntagged()` call can remain as a status indicator but is no longer needed for the processing logic
- No more in-memory containerTag filter — the `scope = 'project'` filter in SQL handles this correctly

### DES-003: Add startup validation for LLM provider config

**File:** `src/server-config.ts`

Add to `validateServerConfig()`:

```typescript
if (!config.memoryModel || !config.memoryApiUrl) {
  log(
    "WARNING: MEMORY_MODEL and/or MEMORY_API_URL are not configured. LLM tagging will be disabled."
  );
  config._tagMigrationDisabled = true; // flag to skip tag migration
}
```

**File:** `src/server.ts`

Before calling `runTagMigration()`:

```typescript
if (!CONFIG._tagMigrationDisabled) {
  const { runTagMigration } = await import("./services/tag-migration-service.js");
  runTagMigration().catch((err) => logError("Tag migration loop error", { error: String(err) }));
} else {
  log("Tag migration disabled: MEMORY_MODEL/MEMORY_API_URL not configured");
}
```

**Rationale:** Graceful degradation rather than crash. Some deployments may not need LLM tagging (embedding-only mode).

### DES-004: Improve tag registry failure logging

**File:** `src/services/api-handlers.ts`

In each `linkMemoryTags()` catch block, add the memory ID and tag list to the log:

```typescript
try {
  await tagRegistry.linkMemoryTags(id, tags);
} catch (e) {
  log("tag-registry: linkMemoryTags failed", {
    memoryId: id,
    tags: tags,
    error: String(e),
    hint: "Memory tags saved to memories table but not to canonical tag registry. Data inconsistency may exist.",
  });
}
```

Same pattern in tag-migration-service.ts and any other call sites.

**Rationale:** The current logging lacks enough context to identify which memories are affected. Adding the memory ID and tags makes the discrepancy actionable.

## Issue / requirement / design mapping

| Issue     | Requirements | Design items                                      |
| --------- | ------------ | ------------------------------------------------- |
| ISSUE-001 | REQ-001      | DES-001, DES-002                                  |
| ISSUE-002 | REQ-002      | DES-001 (SQL filter replaces containerTag filter) |
| ISSUE-003 | REQ-003      | DES-003                                           |
| ISSUE-004 | REQ-004      | DES-004                                           |

## Test design

1. **Unit test for `getUntaggedProjectMemories()`**: Verify SQL query returns only untagged project-scoped memories, respects pagination.
2. **Integration test for tag migration**: With >1000 total memories, verify all untagged project memories are processed regardless of their position in the table.
3. **Integration test for containerTag diversity**: Verify memories with various containerTag values ("test-data", "my-project", etc.) are all processed if they are project-scoped and untagged.
4. **Unit test for config validation**: Verify server logs warning when MEMORY_MODEL/MEMORY_API_URL are missing and skips tag migration.
5. **Unit test for tag registry error logging**: Verify error log includes memory ID and tags when linkMemoryTags fails.

## Data/config/schema impact

- **No schema changes** — uses existing columns (scope, tags, container_tag)
- **No new env vars** — uses existing MEMORY_MODEL, MEMORY_API_URL
- **New interface method** — `getUntaggedProjectMemories()` added to MemoryRepository interface
- **New config flag** — `_tagMigrationDisabled` added to server config (internal, not user-facing)

## Security impact

- No new endpoints or API surface
- No changes to auth/permissions
- SQL query uses parameterized inputs ($1, $2) — no injection risk

## Compatibility impact

- `getAllWithVectors()` is NOT modified — existing callers (similarity checks) are unaffected
- New `getUntaggedProjectMemories()` method is additive — no breaking changes
- Tag migration behavior changes from "process first 1000 any-scope memories" to "process all untagged project memories in batches" — this is a bug fix, not a behavior change
- Graceful config degradation is backward-compatible — deployments with env vars configured see no change

## Migration/rollback notes

- If the new method causes issues, the old `getAllWithVectors()` + filter approach can be restored by reverting tag-migration-service.ts changes
- The new repository method is additive and can be removed without affecting other code
- No database migrations needed

## Risks and mitigations

| Risk                                                         | Mitigation                                                                       |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Loading vectors for large batches could consume memory       | BATCH_SIZE default of 100 (down from 1000) reduces memory pressure               |
| SQL query on untagged memories could be slow on large tables | `scope` and `tags` columns should be indexed; LIMIT clause bounds the result set |
| Tag migration processing all memories could take long        | Smaller batches with natural termination (query returns empty when all tagged)   |
| `_tagMigrationDisabled` flag pollutes config interface       | Mark as internal/optional; only used by server.ts startup                        |

## Alternatives considered

1. **Add pagination to `getAllWithVectors()` instead of new method** — Rejected because it's used by similarity checks that need ALL memories, not just untagged project ones. Modifying it would break those callers.

2. **Add `scope` and `tags` parameters to `getAllWithVectors()`** — Rejected because the method name implies "get all", and adding filters would be confusing. A new method with a clear name is better.

3. **Fail server startup when MEMORY_MODEL/MEMORY_API_URL are missing** — Rejected in favor of graceful degradation. Some deployments may intentionally not use LLM tagging.

4. **Add periodic reconciliation job for tag registry** — Deferred. The current fix only improves logging. A full reconciliation job would be a separate feature.
