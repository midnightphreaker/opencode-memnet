import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function logHookDiagnostic(event: string, details: Record<string, unknown>): void {
  try {
    const path = getLogPath();
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(
      path,
      JSON.stringify({
        ts: new Date().toISOString(),
        event,
        ...sanitizeRecord(details),
      }) + "\n",
      "utf8"
    );
  } catch {
    // Hook diagnostics must never block or write to stdout/stderr.
  }
}

function getLogPath(): string {
  const dataDir = process.env.PLUGIN_DATA || process.env.CLAUDE_PLUGIN_DATA;
  return dataDir
    ? join(dataDir, "opencode-memnet-hook.log")
    : join(homedir(), ".codex", "opencode-memnet-hook.log");
}

function sanitizeRecord(value: Record<string, unknown>): Record<string, unknown> {
  return sanitize(value) as Record<string, unknown>;
}

function sanitize(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
      .replace(/(api[_-]?key|token|password|secret)=([^&\s]+)/gi, "$1=[redacted]");
  }
  if (Array.isArray(value)) {
    return value.map(sanitize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        /api[_-]?key|token|password|secret|authorization/i.test(key)
          ? "[redacted]"
          : sanitize(item),
      ])
    );
  }
  return value;
}
