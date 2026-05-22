/**
 * Unit tests for Postgres vector utilities.
 *
 * All functions under test are pure — no live database required.
 */

import { describe, expect, it } from "bun:test";
import {
  assertVectorDimensions,
  decodeSqliteVectorBlob,
  getVectorCast,
  redactDatabaseUrl,
  vectorToPgLiteral,
} from "../../src/services/storage/postgres/vector.js";

// ── vectorToPgLiteral ──

describe("vectorToPgLiteral", () => {
  it("formats a Float32Array as a pgvector literal (unquoted)", () => {
    const vec = new Float32Array([1, 2, 3]);
    expect(vectorToPgLiteral(vec)).toBe("[1,2,3]");
  });

  it("handles a single-element vector", () => {
    const vec = new Float32Array([1.5]);
    expect(vectorToPgLiteral(vec)).toBe("[1.5]");
  });

  it("handles a 1024-dimension vector (count only)", () => {
    const vec = new Float32Array(1024).fill(0.5);
    const lit = vectorToPgLiteral(vec);
    expect(lit.startsWith("[")).toBe(true);
    expect(lit.endsWith("]")).toBe(true);
    const commas = lit.split(",").length - 1;
    expect(commas).toBe(1023);
  });

  it("handles zeros", () => {
    expect(vectorToPgLiteral(new Float32Array([0, 0, 0]))).toBe("[0,0,0]");
  });

  it("handles negative values", () => {
    expect(vectorToPgLiteral(new Float32Array([-1, 2]))).toBe("[-1,2]");
  });
});

// ── assertVectorDimensions ──

describe("assertVectorDimensions", () => {
  it("passes when dimensions match", () => {
    expect(() => assertVectorDimensions(new Float32Array(768), 768)).not.toThrow();
  });

  it("throws when dimensions do not match", () => {
    expect(() => assertVectorDimensions(new Float32Array(512), 768)).toThrow(
      "expected 768, got 512"
    );
  });

  it("throws for empty vector vs non-zero expected", () => {
    expect(() => assertVectorDimensions(new Float32Array(0), 1024)).toThrow("expected 1024, got 0");
  });
});

// ── decodeSqliteVectorBlob ──

describe("decodeSqliteVectorBlob", () => {
  it("round-trips a Float32Array through blob encoding", () => {
    const original = new Float32Array([1.0, -2.5, 3.14, 0.0]);
    // Simulate SQLite storage: new Uint8Array(vector.buffer)
    const blob = new Uint8Array(original.buffer);

    const decoded = decodeSqliteVectorBlob(blob);
    expect(decoded).toHaveLength(4);
    expect(decoded[0]).toBeCloseTo(1.0);
    expect(decoded[1]).toBeCloseTo(-2.5);
    expect(decoded[2]).toBeCloseTo(3.14);
    expect(decoded[3]).toBeCloseTo(0.0);
  });

  it("handles a sub-view of a larger buffer correctly", () => {
    // Create a larger buffer and place the vector in the middle.
    const backing = new ArrayBuffer(64); // 64 bytes = 16 float32s
    const fullView = new Float32Array(backing);
    fullView[0] = 999; // garbage before
    fullView[1] = 888;
    fullView[2] = 1.5; // actual data starts here
    fullView[3] = 2.5;
    fullView[4] = 3.5;
    fullView[5] = 777; // garbage after

    // Create a Uint8Array sub-view covering only elements [2..4]
    const byteOffset = 2 * 4; // 2 float32s = 8 bytes
    const byteLength = 3 * 4; // 3 float32s = 12 bytes
    const subBlob = new Uint8Array(backing, byteOffset, byteLength);

    const decoded = decodeSqliteVectorBlob(subBlob);
    expect(decoded).toHaveLength(3);
    expect(decoded[0]).toBeCloseTo(1.5);
    expect(decoded[1]).toBeCloseTo(2.5);
    expect(decoded[2]).toBeCloseTo(3.5);
  });

  it("handles a 768-dimension blob", () => {
    const original = new Float32Array(768);
    for (let i = 0; i < 768; i++) original[i] = i * 0.01;

    const blob = new Uint8Array(original.buffer);
    const decoded = decodeSqliteVectorBlob(blob);

    expect(decoded).toHaveLength(768);
    expect(decoded[0]).toBeCloseTo(0);
    expect(decoded[767]).toBeCloseTo(7.67);
  });
});

// ── getVectorCast ──

describe("getVectorCast", () => {
  it("returns vector(1024) for default config", () => {
    expect(getVectorCast("vector", 1024)).toBe("vector(1024)");
  });

  it("returns halfvec(1024)", () => {
    expect(getVectorCast("halfvec", 1024)).toBe("halfvec(1024)");
  });

  it("returns vector(768) for default embedding dimensions", () => {
    expect(getVectorCast("vector", 768)).toBe("vector(768)");
  });

  it("rejects zero dimensions", () => {
    expect(() => getVectorCast("vector", 0)).toThrow("positive integer");
  });

  it("rejects negative dimensions", () => {
    expect(() => getVectorCast("vector", -5)).toThrow("positive integer");
  });

  it("rejects non-integer dimensions", () => {
    expect(() => getVectorCast("vector", 1.5)).toThrow("positive integer");
  });

  it("rejects vector dimension > 2000", () => {
    expect(() => getVectorCast("vector", 2001)).toThrow("2000");
  });

  it("accepts vector dimension = 2000 (boundary)", () => {
    expect(getVectorCast("vector", 2000)).toBe("vector(2000)");
  });

  it("rejects halfvec dimension > 4000", () => {
    expect(() => getVectorCast("halfvec", 4001)).toThrow("4000");
  });

  it("accepts halfvec dimension = 4000 (boundary)", () => {
    expect(getVectorCast("halfvec", 4000)).toBe("halfvec(4000)");
  });
});

// ── redactDatabaseUrl ──

describe("redactDatabaseUrl", () => {
  it("redacts password from a standard postgres URL", () => {
    const url = "postgres://admin:s3cret@db.example.com:5432/mydb?sslmode=require";
    const redacted = redactDatabaseUrl(url);
    expect(redacted).not.toContain("s3cret");
    expect(redacted).toContain("***");
    expect(redacted).toContain("db.example.com");
    expect(redacted).toContain("mydb");
  });

  it("handles URL without password", () => {
    const url = "postgres://admin@localhost:5432/testdb";
    const redacted = redactDatabaseUrl(url);
    expect(redacted).toBe(url);
  });

  it("handles invalid URL gracefully", () => {
    expect(redactDatabaseUrl("not-a-url")).toBe("[redacted-invalid-url]");
  });

  it("handles empty string", () => {
    // Empty string is technically a valid URL (resolves to "")
    // but new URL("") throws in most runtimes.
    const result = redactDatabaseUrl("");
    // Either it parses successfully or it returns the redacted fallback.
    expect(typeof result).toBe("string");
  });

  it("handles URL with encoded special characters in password", () => {
    const url = "postgres://user:p%40ss%20word@host/db";
    const redacted = redactDatabaseUrl(url);
    expect(redacted).not.toContain("p%40ss");
    expect(redacted).toContain("***");
  });
});
