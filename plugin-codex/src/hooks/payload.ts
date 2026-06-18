export interface ParsedHookPayload {
  event?: string;
  sessionID?: string;
  prompt?: string;
  cwd?: string;
  raw?: Record<string, unknown>;
}

export function parseHookPayload(input: string): ParsedHookPayload {
  if (!input.trim()) {
    return {};
  }

  try {
    const raw = JSON.parse(input) as unknown;
    if (!isRecord(raw)) {
      return {};
    }

    return {
      event: firstString(raw.event, raw.hook_event, raw.hookEvent, raw.type, getNested(raw, ["hook", "event"])),
      sessionID: firstString(
        raw.sessionID,
        raw.session_id,
        getNested(raw, ["session", "id"]),
        getNested(raw, ["session", "sessionID"]),
        getNested(raw, ["session", "session_id"]),
      ),
      prompt: firstString(
        raw.prompt,
        raw.user_prompt,
        raw.userPrompt,
        raw.input,
        getNested(raw, ["prompt", "text"]),
        getNested(raw, ["message", "content"]),
      ),
      cwd: firstString(
        raw.cwd,
        raw.working_directory,
        raw.workingDirectory,
        getNested(raw, ["workspace", "cwd"]),
        getNested(raw, ["workspace", "root"]),
      ),
      raw,
    };
  } catch {
    return {};
  }
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function getNested(value: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = value;
  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
