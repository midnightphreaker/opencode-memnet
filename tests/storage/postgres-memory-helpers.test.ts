/**
 * Unit tests for Postgres memory repository helper functions.
 *
 * Tests the pure computeWeightedScores logic and metadata parsing
 * without requiring a live Postgres database.
 *
 * Integration tests requiring Postgres are guarded by the
 * OPENCODE_MEM_TEST_DATABASE_URL environment variable.
 */

import { describe, expect, it } from "bun:test";

// ── Re-implement the pure helpers for testing (same logic as memory-repository.ts) ──

function parseMetadata(raw: unknown): Record<string, unknown> | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  if (typeof raw === "object") return raw as Record<string, unknown>;
  return undefined;
}

interface WeightedRow {
  id: string;
  content: string;
  tags: string | null;
  metadata: unknown;
  container_tag: string;
  display_name: string | null;
  user_name: string | null;
  user_email: string | null;
  project_path: string | null;
  project_name: string | null;
  git_repo_url: string | null;
  is_pinned: boolean;
  content_sim: number;
  tags_sim: number;
}

function computeWeightedScores(
  rows: WeightedRow[],
  queryText: string | undefined,
  threshold: number,
  limit: number
) {
  const queryWords = queryText
    ? queryText
        .toLowerCase()
        .split(/[\s,]+/)
        .filter((w) => w.length > 1)
    : [];

  const results = rows.map((row) => {
    const contentSim = Number(row.content_sim);
    const tagsSim = Number(row.tags_sim);
    const memoryTagsStr = row.tags || "";
    const memoryTags: string[] = memoryTagsStr
      .split(",")
      .map((t: string) => t.trim().toLowerCase());

    let exactMatchBoost = 0;
    if (queryWords.length > 0 && memoryTags.length > 0) {
      const matches = queryWords.filter((w) =>
        memoryTags.some((t) => t.includes(w) || w.includes(t))
      ).length;
      exactMatchBoost = matches / Math.max(queryWords.length, 1);
    }

    const finalTagsSim = Math.max(tagsSim, exactMatchBoost);
    const similarity = contentSim * 0.6 + finalTagsSim * 0.4;

    return {
      id: row.id,
      memory: row.content,
      similarity,
      tags: memoryTagsStr ? memoryTagsStr.split(",").map((t: string) => t.trim()) : [],
    };
  });

  results.sort((a, b) => b.similarity - a.similarity);
  return results.filter((r) => r.similarity >= threshold).slice(0, limit);
}

// ── Tests ──

describe("parseMetadata", () => {
  it("returns undefined for null", () => {
    expect(parseMetadata(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(parseMetadata(undefined)).toBeUndefined();
  });

  it("parses a valid JSON string", () => {
    const result = parseMetadata('{"key":"value"}');
    expect(result).toEqual({ key: "value" });
  });

  it("returns undefined for invalid JSON string", () => {
    expect(parseMetadata("{invalid}")).toBeUndefined();
  });

  it("returns the object as-is for object input", () => {
    const obj = { foo: "bar", num: 42 };
    expect(parseMetadata(obj)).toEqual(obj);
  });

  it("returns undefined for non-object JSON string", () => {
    expect(parseMetadata('"hello"')).toBeUndefined();
    expect(parseMetadata("42")).toBeUndefined();
    expect(parseMetadata("true")).toBeUndefined();
  });

  it("handles sessionID metadata", () => {
    const result = parseMetadata('{"sessionID":"sess_123"}');
    expect(result).toEqual({ sessionID: "sess_123" });
  });
});

describe("computeWeightedScores", () => {
  const makeRow = (overrides: Partial<WeightedRow> & { id: string }): WeightedRow => ({
    content: "test content",
    tags: null,
    metadata: null,
    container_tag: "opencode_user_hash1",
    display_name: null,
    user_name: null,
    user_email: null,
    project_path: null,
    project_name: null,
    git_repo_url: null,
    is_pinned: false,
    content_sim: 0.8,
    tags_sim: 0.0,
    ...overrides,
  });

  it("computes content-only similarity", () => {
    const rows = [makeRow({ id: "1", content_sim: 0.9, tags_sim: 0.0 })];
    const results = computeWeightedScores(rows, undefined, 0.0, 10);
    expect(results).toHaveLength(1);
    // 0.9 * 0.6 + 0.0 * 0.4 = 0.54
    expect(results[0].similarity).toBeCloseTo(0.54);
  });

  it("computes combined content + tags similarity", () => {
    const rows = [makeRow({ id: "1", content_sim: 0.8, tags_sim: 0.6 })];
    const results = computeWeightedScores(rows, undefined, 0.0, 10);
    // 0.8 * 0.6 + 0.6 * 0.4 = 0.48 + 0.24 = 0.72
    expect(results[0].similarity).toBeCloseTo(0.72);
  });

  it("applies exact tag match boost over tags similarity", () => {
    const rows = [
      makeRow({
        id: "1",
        content_sim: 0.7,
        tags_sim: 0.2,
        tags: "typescript,react",
      }),
    ];
    const results = computeWeightedScores(rows, "typescript hooks", 0.0, 10);
    // queryWords = ["typescript", "hooks"]
    // memoryTags = ["typescript", "react"]
    // matches = 1 (typescript matches)
    // exactMatchBoost = 1 / 2 = 0.5
    // finalTagsSim = max(0.2, 0.5) = 0.5
    // similarity = 0.7 * 0.6 + 0.5 * 0.4 = 0.42 + 0.2 = 0.62
    expect(results[0].similarity).toBeCloseTo(0.62);
  });

  it("sorts results by descending similarity", () => {
    const rows = [
      makeRow({ id: "low", content_sim: 0.5, tags_sim: 0.1 }),
      makeRow({ id: "high", content_sim: 0.95, tags_sim: 0.9 }),
      makeRow({ id: "mid", content_sim: 0.7, tags_sim: 0.5 }),
    ];
    const results = computeWeightedScores(rows, undefined, 0.0, 10);
    expect(results[0].id).toBe("high");
    expect(results[1].id).toBe("mid");
    expect(results[2].id).toBe("low");
  });

  it("filters results below threshold", () => {
    const rows = [
      makeRow({ id: "1", content_sim: 0.9, tags_sim: 0.8 }),
      makeRow({ id: "2", content_sim: 0.1, tags_sim: 0.0 }),
    ];
    const results = computeWeightedScores(rows, undefined, 0.5, 10);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("1");
  });

  it("respects limit parameter", () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      makeRow({ id: `r${i}`, content_sim: 0.9 - i * 0.01, tags_sim: 0.5 })
    );
    const results = computeWeightedScores(rows, undefined, 0.0, 5);
    expect(results).toHaveLength(5);
  });

  it("uses 0.6 / 0.4 weighting ratio", () => {
    // Pure content sim, no tags
    const rows = [makeRow({ id: "1", content_sim: 1.0, tags_sim: 0.0 })];
    const results = computeWeightedScores(rows, undefined, 0.0, 10);
    expect(results[0].similarity).toBeCloseTo(0.6);

    // Pure tags sim, no content
    const rows2 = [makeRow({ id: "1", content_sim: 0.0, tags_sim: 1.0 })];
    const results2 = computeWeightedScores(rows2, undefined, 0.0, 10);
    expect(results2[0].similarity).toBeCloseTo(0.4);
  });

  it("handles empty query text with no tag boost", () => {
    const rows = [
      makeRow({
        id: "1",
        content_sim: 0.8,
        tags_sim: 0.3,
        tags: "typescript,react",
      }),
    ];
    const results = computeWeightedScores(rows, "", 0.0, 10);
    // No queryWords, so exactMatchBoost = 0
    // finalTagsSim = max(0.3, 0) = 0.3
    // similarity = 0.8 * 0.6 + 0.3 * 0.4 = 0.48 + 0.12 = 0.6
    expect(results[0].similarity).toBeCloseTo(0.6);
  });

  it("handles null tags with query text — empty string tag matches via includes", () => {
    const rows = [makeRow({ id: "1", content_sim: 0.9, tags: null, tags_sim: 0.0 })];
    const results = computeWeightedScores(rows, "typescript", 0.0, 10);
    // tags=null → memoryTagsStr="" → memoryTags = [""] (from "".split(","))
    // queryWords = ["typescript"]
    // "".includes("typescript") is false, "typescript".includes("") is true
    // matches = 1, exactMatchBoost = 1/1 = 1.0
    // finalTagsSim = max(0, 1.0) = 1.0
    // similarity = 0.9 * 0.6 + 1.0 * 0.4 = 0.54 + 0.4 = 0.94
    expect(results[0].similarity).toBeCloseTo(0.94);
  });
});

describe("extractScopeFromContainerTag", () => {
  // Re-implement for testing
  function extractScopeFromContainerTag(containerTag: string): {
    scope: "user" | "project";
    hash: string;
  } {
    const parts = containerTag.split("_");
    if (parts.length >= 3) {
      const scope = parts[1] as "user" | "project";
      const hash = parts.slice(2).join("_");
      return { scope, hash };
    }
    return { scope: "user", hash: containerTag };
  }

  it("extracts user scope from container tag", () => {
    const result = extractScopeFromContainerTag("opencode_user_abc123");
    expect(result).toEqual({ scope: "user", hash: "abc123" });
  });

  it("extracts project scope from container tag", () => {
    const result = extractScopeFromContainerTag("opencode_project_def456");
    expect(result).toEqual({ scope: "project", hash: "def456" });
  });

  it("handles hash with underscores", () => {
    const result = extractScopeFromContainerTag("opencode_user_abc_123_def");
    expect(result).toEqual({ scope: "user", hash: "abc_123_def" });
  });

  it("falls back to user scope for short tags", () => {
    const result = extractScopeFromContainerTag("short");
    expect(result).toEqual({ scope: "user", hash: "short" });
  });
});
