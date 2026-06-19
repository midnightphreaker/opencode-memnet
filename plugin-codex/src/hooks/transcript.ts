import { readFileSync } from "node:fs";
import { stripPrivateContent } from "../privacy";

export interface TranscriptMessage {
  role: "user" | "assistant";
  parts: Array<
    { type: "text"; text: string } | { type: "tool"; tool: string; state: { input?: unknown } }
  >;
  id?: string;
}

export interface ParsedTranscript {
  sessionID?: string;
  messages: TranscriptMessage[];
  latestUserPrompt?: string;
  promptMessageId?: string;
  hasAssistantActivity: boolean;
}

export function parseTranscriptFile(path: string): ParsedTranscript {
  return parseTranscript(readFileSync(path, "utf8"));
}

export function parseTranscript(input: string): ParsedTranscript {
  const messages: TranscriptMessage[] = [];
  let sessionID: string | undefined;

  for (const line of input.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    let item: unknown;
    try {
      item = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(item)) {
      continue;
    }

    sessionID ??= firstString(item.session_id, item.sessionID, item.sessionId);
    const message = normalizeMessage(item);
    if (!message) {
      continue;
    }
    messages.push(message);
  }

  const latestUser = [...messages].reverse().find((message) => message.role === "user");
  const latestUserPrompt = latestUser ? messageText(latestUser) : undefined;
  const hasAssistantActivity = messages.some(
    (message) =>
      message.role === "assistant" &&
      message.parts.some((part) => part.type === "text" || part.type === "tool")
  );

  return {
    sessionID,
    messages,
    latestUserPrompt,
    promptMessageId: latestUser?.id,
    hasAssistantActivity,
  };
}

function normalizeMessage(item: Record<string, unknown>): TranscriptMessage | undefined {
  const candidate = isRecord(item.message) ? item.message : isRecord(item.msg) ? item.msg : item;
  const role = normalizeRole(firstString(candidate.role, getNested(candidate, ["info", "role"])));
  if (!role) {
    return undefined;
  }

  const parts = normalizeParts(candidate);
  if (parts.length === 0) {
    return undefined;
  }

  return {
    role,
    parts,
    id: firstString(candidate.id, getNested(candidate, ["info", "id"]), item.id),
  };
}

function normalizeParts(candidate: Record<string, unknown>): TranscriptMessage["parts"] {
  const rawParts = Array.isArray(candidate.parts) ? candidate.parts : undefined;
  const parts: TranscriptMessage["parts"] = [];

  if (rawParts) {
    for (const part of rawParts) {
      if (!isRecord(part)) {
        continue;
      }
      const type = firstString(part.type);
      if (type === "text") {
        addTextPart(parts, firstString(part.text, part.content));
      } else if (type === "tool") {
        parts.push({
          type: "tool",
          tool: firstString(part.tool, part.name) ?? "unknown",
          state: normalizeToolState(part.state),
        });
      } else if (type === "tool_use") {
        parts.push({
          type: "tool",
          tool: firstString(part.name, part.tool) ?? "unknown",
          state: {
            input: sanitizeToolInput(
              isRecord(part.input) || typeof part.input === "string" ? part.input : undefined
            ),
          },
        });
      }
    }
  }

  addTextPart(parts, firstString(candidate.content, candidate.text));

  const toolCalls = Array.isArray(candidate.tool_calls)
    ? candidate.tool_calls
    : Array.isArray(candidate.toolCalls)
      ? candidate.toolCalls
      : [];
  for (const toolCall of toolCalls) {
    if (!isRecord(toolCall)) {
      continue;
    }
    const fn = isRecord(toolCall.function) ? toolCall.function : undefined;
    parts.push({
      type: "tool",
      tool: firstString(toolCall.name, toolCall.tool, fn?.name) ?? "unknown",
      state: {
        input: sanitizeToolInput(firstDefined(toolCall.input, toolCall.arguments, fn?.arguments)),
      },
    });
  }

  return parts;
}

function addTextPart(parts: TranscriptMessage["parts"], value: string | undefined): void {
  if (!value) {
    return;
  }
  const text = stripPrivateContent(value).trim();
  if (text) {
    parts.push({ type: "text", text });
  }
}

function normalizeToolState(value: unknown): { input?: unknown } {
  if (!isRecord(value)) {
    return {};
  }
  return { input: sanitizeToolInput(value.input) };
}

function sanitizeToolInput(value: unknown): unknown {
  if (typeof value === "string") {
    return stripPrivateContent(value);
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeToolInput);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeToolInput(item)])
    );
  }
  return value;
}

function messageText(message: TranscriptMessage): string | undefined {
  const text = message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
  return text || undefined;
}

function normalizeRole(value: string | undefined): "user" | "assistant" | undefined {
  return value === "user" || value === "assistant" ? value : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
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
