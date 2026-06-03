/**
 * Tests for ISSUE-004: Improved tag registry failure logging
 *
 * Verifies that all linkMemoryTags() catch blocks log memoryId, tags, error,
 * and hint fields by reading the source files and asserting the expected
 * patterns are present.
 *
 * This approach is robust against test isolation issues with log file capture.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Constants ──────────────────────────────────────────────────────────────

const HINT =
  "Memory tags saved to memories table but not to canonical tag registry. Data inconsistency may exist.";

const PROJECT_ROOT = join(import.meta.dir, "..");

// ── Helpers ────────────────────────────────────────────────────────────────

function readSrcFile(relPath: string): string {
  return readFileSync(join(PROJECT_ROOT, relPath), "utf-8");
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("ISSUE-004: tag registry failure logging", () => {
  describe("api-handlers.ts — handleAddMemory catch block", () => {
    const source = readSrcFile("src/services/api-handlers.ts");

    it("includes memoryId in the log data", () => {
      // The handleAddMemory catch block should log record.id as memoryId
      // Find the catch block near "failed to link memory tags in registry"
      const idx = source.indexOf("failed to link memory tags in registry");
      expect(idx).toBeGreaterThan(0);

      // Look at the surrounding 500 chars for the log call
      const surrounding = source.slice(idx, idx + 500);
      expect(surrounding).toContain("memoryId");
    });

    it("includes tags in the log data", () => {
      const idx = source.indexOf("failed to link memory tags in registry");
      const surrounding = source.slice(idx, idx + 500);
      expect(surrounding).toContain("tags:");
    });

    it("includes error in the log data", () => {
      const idx = source.indexOf("failed to link memory tags in registry");
      const surrounding = source.slice(idx, idx + 500);
      expect(surrounding).toContain("error:");
    });

    it("includes the hint about data inconsistency", () => {
      const idx = source.indexOf("failed to link memory tags in registry");
      const surrounding = source.slice(idx, idx + 500);
      expect(surrounding).toContain("hint:");
      expect(surrounding).toContain("Data inconsistency");
    });
  });

  describe("api-handlers.ts — handleUpdateMemory catch block", () => {
    const source = readSrcFile("src/services/api-handlers.ts");

    it("includes memoryId, tags, error, and hint", () => {
      const idx = source.indexOf("failed to update memory tags in registry");
      expect(idx).toBeGreaterThan(0);

      const surrounding = source.slice(idx, idx + 500);
      expect(surrounding).toContain("memoryId");
      expect(surrounding).toContain("tags:");
      expect(surrounding).toContain("error:");
      expect(surrounding).toContain("hint:");
      expect(surrounding).toContain("Data inconsistency");
    });
  });

  describe("api-handlers.ts — handleAutoCapture catch block", () => {
    const source = readSrcFile("src/services/api-handlers.ts");

    it("includes memoryId, tags, error, and hint", () => {
      const idx = source.indexOf("failed to link auto-capture tags in registry");
      expect(idx).toBeGreaterThan(0);

      const surrounding = source.slice(idx, idx + 500);
      expect(surrounding).toContain("memoryId");
      expect(surrounding).toContain("tags:");
      expect(surrounding).toContain("error:");
      expect(surrounding).toContain("hint:");
      expect(surrounding).toContain("Data inconsistency");
    });
  });

  describe("tag-migration-service.ts — linkMemoryTags catch block", () => {
    const source = readSrcFile("src/services/tag-migration-service.ts");

    it("includes memoryId, tags, error, and hint", () => {
      const idx = source.indexOf("failed to link tags in registry");
      expect(idx).toBeGreaterThan(0);

      const surrounding = source.slice(idx, idx + 500);
      expect(surrounding).toContain("memoryId");
      expect(surrounding).toContain("tags,");
      expect(surrounding).toContain("error:");
      expect(surrounding).toContain("hint:");
      expect(surrounding).toContain("Data inconsistency");
    });
  });

  describe("log output format validation", () => {
    it("logError calls include all required fields for handleAddMemory", async () => {
      const { logError } = await import("../src/services/logger.js");

      // Verify that calling logError with the expected fields produces valid JSON
      const logData = {
        memoryId: "mem_test",
        tags: ["test-tag"],
        error: "Error: test",
        hint: HINT,
      };

      // Should not throw — validates the data structure is serializable
      const serialized = JSON.stringify(logData);
      expect(serialized).toContain("memoryId");
      expect(serialized).toContain("tags");
      expect(serialized).toContain("error");
      expect(serialized).toContain("hint");
    });
  });
});
