/**
 * Vector utility functions for the Postgres/pgvector storage backend.
 *
 * All functions are pure and do not touch the database, making them safe to
 * unit-test without a live Postgres instance.
 */

// ── Vector → pgvector literal ──

/**
 * Convert a Float32Array to a pgvector literal string (unquoted).
 *
 * For raw SQL (via sql.unsafe()): wrap in quotes yourself:
 *   `'${vectorToPgLiteral(vec)}'::vector(1024)`
 *
 * For parameterised queries: pass as-is, Postgres will cast via ::vector(N).
 *
 * Example: `Float32Array([0.1, 0.2, 0.3])` → `"[0.1,0.2,0.3]"`
 */
export function vectorToPgLiteral(vector: Float32Array): string {
  return `[${Array.from(vector).join(",")}]`;
}

// ── Dimension assertion ──

/**
 * Assert that a vector's dimensionality matches the expected count.
 * Throws a descriptive `Error` on mismatch.
 */
export function assertVectorDimensions(vector: Float32Array, expectedDimensions: number): void {
  if (vector.length !== expectedDimensions) {
    throw new Error(
      `Vector dimension mismatch: expected ${expectedDimensions}, got ${vector.length}`
    );
  }
}

// ── SQLite blob → Float32Array ──

/**
 * Decode a SQLite vector blob (serialised as `new Uint8Array(float32.buffer)`)
 * back into a `Float32Array`.
 *
 * **Correctness note:** We slice the underlying `ArrayBuffer` using
 * `blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength)`
 * rather than `blob.buffer` directly.  The raw `.buffer` may be a larger
 * backing `ArrayBuffer` when `blob` is a sub-view (e.g. a Node `Buffer`
 * pool slice).  Using the full buffer would silently include unrelated bytes
 * and produce a wrong-length `Float32Array`.
 */
export function decodeSqliteVectorBlob(blob: Uint8Array | Buffer): Float32Array {
  // Treat the input as Uint8Array (Buffer extends Uint8Array in Node/Bun).
  const bytes = blob as Uint8Array;
  // Slice the *exact* range out of the underlying buffer rather than using
  // `.buffer` directly — the raw ArrayBuffer may be a larger backing store
  // when `bytes` is a sub-view (e.g. a Node Buffer pool slice).
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Float32Array(buffer);
}

// ── Vector type cast string ──

/**
 * Return a pgvector column-type string like `"vector(1024)"` or `"halfvec(4000)"`.
 *
 * Validates that `dimensions` is a positive integer and within the max for
 * the chosen type (`vector` → 2000, `halfvec` → 4000).
 *
 * @throws Error on invalid dimensions or type/dimension overflow.
 */
export function getVectorCast(vectorType: "vector" | "halfvec", dimensions: number): string {
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error(`Invalid vector dimensions: ${dimensions}. Must be a positive integer.`);
  }

  const MAX_VECTOR_DIMS = 2000;
  const MAX_HALFVEC_DIMS = 4000;

  if (vectorType === "vector" && dimensions > MAX_VECTOR_DIMS) {
    throw new Error(
      `vector type supports a maximum of ${MAX_VECTOR_DIMS} dimensions, got ${dimensions}`
    );
  }
  if (vectorType === "halfvec" && dimensions > MAX_HALFVEC_DIMS) {
    throw new Error(
      `halfvec type supports a maximum of ${MAX_HALFVEC_DIMS} dimensions, got ${dimensions}`
    );
  }

  return `${vectorType}(${dimensions})`;
}

// ── URL redaction ──

/**
 * Redact the password from a database URL so it is safe for logs and error
 * messages.
 *
 * Example:
 *   `postgres://user:s3cret@host:5432/db` → `postgres://user:***@host:5432/db`
 */
export function redactDatabaseUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "[redacted-invalid-url]";
  }
}
