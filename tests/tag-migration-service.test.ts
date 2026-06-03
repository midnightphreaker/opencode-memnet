/**
 * Tests for DES-002: Refactor runTagMigration() to use getUntaggedProjectMemories()
 *
 * These tests verify that the tag migration service:
 * 1. Uses getUntaggedProjectMemories() instead of getAllWithVectors() + in-memory filter
 * 2. Processes memories beyond the first 1000 rows (no hard limit)
 * 3. Terminates when no untagged memories remain
 * 4. Does NOT use the broken containerTag.includes("_project_") filter
 * 5. Does NOT use the in-memory !r.tags || r.tags.trim() === "" filter
 *
 * The tests read the source file and verify the expected patterns are present.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dir, "..");

function readSrcFile(relPath: string): string {
  return readFileSync(join(PROJECT_ROOT, relPath), "utf-8");
}

describe("DES-002: runTagMigration() uses getUntaggedProjectMemories()", () => {
  const source = readSrcFile("src/services/tag-migration-service.ts");

  describe("replaces getAllWithVectors() + in-memory filter", () => {
    it("does NOT call getAllWithVectors() in the migration loop", () => {
      // The old broken code called getAllWithVectors() — verify it's gone
      // from the runTagMigration function body
      const fnStart = source.indexOf("export async function runTagMigration()");
      expect(fnStart).toBeGreaterThan(-1);
      const fnBody = source.slice(fnStart);

      // getAllWithVectors should NOT appear in the function body
      expect(fnBody).not.toContain("getAllWithVectors");
    });

    it("does NOT filter by containerTag.includes('_project_')", () => {
      const fnStart = source.indexOf("export async function runTagMigration()");
      const fnBody = source.slice(fnStart);

      expect(fnBody).not.toContain("containerTag.includes");
      expect(fnBody).not.toContain("_project_");
    });

    it("does NOT use in-memory untagged filter (!r.tags || r.tags.trim())", () => {
      const fnStart = source.indexOf("export async function runTagMigration()");
      const fnBody = source.slice(fnStart);

      // The old in-memory filter pattern should not exist
      expect(fnBody).not.toContain('r.tags || r.tags.trim() === ""');
      expect(fnBody).not.toContain("!r.tags");
    });

    it("calls getUntaggedProjectMemories() instead", () => {
      const fnStart = source.indexOf("export async function runTagMigration()");
      const fnBody = source.slice(fnStart);

      expect(fnBody).toContain("getUntaggedProjectMemories");
    });
  });

  describe("paginated batch processing", () => {
    it("uses a BATCH_SIZE constant (not the old 1000 limit)", () => {
      const fnStart = source.indexOf("export async function runTagMigration()");
      const fnBody = source.slice(fnStart);

      // Should have a BATCH_SIZE constant
      expect(fnBody).toMatch(/BATCH_SIZE\s*=\s*\d+/);
      // BATCH_SIZE should be 100 (not 1000)
      const match = fnBody.match(/BATCH_SIZE\s*=\s*(\d+)/);
      expect(match).not.toBeNull();
      const batchSize = parseInt(match![1], 10);
      expect(batchSize).toBeLessThanOrEqual(200);
      expect(batchSize).toBeGreaterThan(0);
    });

    it("uses a while loop that breaks when batch is empty", () => {
      const fnStart = source.indexOf("export async function runTagMigration()");
      const fnBody = source.slice(fnStart);

      // Should have the batch processing loop pattern
      expect(fnBody).toContain("batch.length === 0");
      expect(fnBody).toContain("break");
    });

    it("always queries from offset 0 (newly tagged excluded by SQL)", () => {
      const fnStart = source.indexOf("export async function runTagMigration()");
      const fnBody = source.slice(fnStart);

      // The call to getUntaggedProjectMemories should use offset 0
      // (newly tagged memories are excluded by the SQL WHERE clause)
      expect(fnBody).toMatch(/getUntaggedProjectMemories\([^)]*0[^)]*\)/);
    });
  });

  describe("preserves existing behavior", () => {
    it("still calls countUntagged() for status reporting", () => {
      const fnStart = source.indexOf("export async function runTagMigration()");
      const fnBody = source.slice(fnStart);

      expect(fnBody).toContain("countUntagged");
    });

    it("still has the outer infinite while loop with sleep", () => {
      const fnStart = source.indexOf("export async function runTagMigration()");
      const fnBody = source.slice(fnStart);

      // The outer loop checks signal.aborted
      expect(fnBody).toContain("signal.aborted");
      // Sleep is still used between cycles
      expect(fnBody).toContain("await sleep(");
    });

    it("still performs embedding warmup", () => {
      const fnStart = source.indexOf("export async function runTagMigration()");
      const fnBody = source.slice(fnStart);

      expect(fnBody).toContain("embeddingService.warmup");
    });

    it("still dual-writes to tag registry with enhanced error logging", () => {
      const fnStart = source.indexOf("export async function runTagMigration()");
      const fnBody = source.slice(fnStart);

      expect(fnBody).toContain("linkMemoryTags");
      expect(fnBody).toContain("hint:");
      expect(fnBody).toContain("Data inconsistency");
    });

    it("uses updateTagsOnly and updateVectorsOnly for separate tag/vector updates", () => {
      const fnStart = source.indexOf("export async function runTagMigration()");
      const fnBody = source.slice(fnStart);

      // Source was refactored: tags and vectors are now updated separately
      // so that tag generation failures don't block vector updates and vice-versa.
      expect(fnBody).toContain("updateTagsOnly");
      expect(fnBody).toContain("updateVectorsOnly");
    });
  });
});
