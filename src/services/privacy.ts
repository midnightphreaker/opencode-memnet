/**
 * Privacy filtering utilities.
 *
 * Re-exports the canonical implementation from `shared/privacy.ts`.
 * This wrapper exists because the server-side tsconfig sets `rootDir` to `./src`,
 * preventing direct imports from `../../shared/`.
 *
 * IMPORTANT: Keep the logic in sync with `shared/privacy.ts`. Any changes to
 * the filtering rules MUST be made in `shared/privacy.ts` first, then mirrored here.
 */

/**
 * Strip `<private>...</private>` blocks from content, replacing them with `[REDACTED]`.
 */
export function stripPrivateContent(content: string): string {
  return content.replace(/<private>[\s\S]*?<\/private>/gi, "[REDACTED]");
}

/**
 * Returns true if the content consists entirely of private blocks (or is empty after stripping).
 */
export function isFullyPrivate(content: string): boolean {
  const stripped = stripPrivateContent(content).trim();
  return stripped === "" || /^(\[REDACTED\])+$/.test(stripped);
}
