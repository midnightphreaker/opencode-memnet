export interface ParsedHookPayload {
  event?: string;
  hookEventName?: string;
  sessionID?: string;
  transcriptPath?: string;
  turnID?: string;
  prompt?: string;
  cwd?: string;
  source?: string;
  trigger?: string;
  lastAssistantMessage?: string;
  stopHookActive?: boolean;
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

    const hookEventName = firstString(
      raw.hook_event_name,
      raw.hook_event,
      raw.hookEvent,
      raw.event,
      raw.type,
      getNested(raw, ["hook", "event"])
    );

    return {
      event: hookEventName,
      hookEventName,
      sessionID: firstString(
        raw.sessionID,
        raw.session_id,
        getNested(raw, ["session", "id"]),
        getNested(raw, ["session", "sessionID"]),
        getNested(raw, ["session", "session_id"])
      ),
      transcriptPath: firstString(raw.transcript_path, raw.transcriptPath),
      turnID: firstString(raw.turn_id, raw.turnID),
      prompt: firstString(
        raw.prompt,
        raw.user_prompt,
        raw.userPrompt,
        raw.input,
        getNested(raw, ["prompt", "text"]),
        getNested(raw, ["message", "content"])
      ),
      cwd: firstString(
        raw.cwd,
        raw.working_directory,
        raw.workingDirectory,
        getNested(raw, ["workspace", "cwd"]),
        getNested(raw, ["workspace", "root"])
      ),
      source: firstString(raw.source),
      trigger: firstString(raw.trigger),
      lastAssistantMessage: firstString(raw.last_assistant_message, raw.lastAssistantMessage),
      stopHookActive: firstBoolean(raw.stop_hook_active, raw.stopHookActive),
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

function firstBoolean(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === "boolean") {
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
