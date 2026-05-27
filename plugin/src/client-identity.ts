// plugin/src/client-identity.ts — Generate and persist a unique client ID
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir, hostname, platform } from "node:os";
import { randomUUID } from "node:crypto";
import { logDebug } from "../../shared/logger.js";

const CLIENT_ID_FILE = join(homedir(), ".config", "opencode", "opencode-memnet-client-id");

export function getClientId(): string {
  try {
    if (existsSync(CLIENT_ID_FILE)) {
      const id = readFileSync(CLIENT_ID_FILE, "utf-8").trim();
      if (id && id.length === 36) return id;
    }
  } catch {
    // fall through to generate
  }

  const id = randomUUID();
  try {
    const dir = join(homedir(), ".config", "opencode");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(CLIENT_ID_FILE, id, "utf-8");
    logDebug("Generated new client ID", { clientId: id });
  } catch (err) {
    logDebug("Failed to persist client ID", { error: String(err) });
  }
  return id;
}

export function getClientMetadata(): Record<string, unknown> {
  return {
    hostname: hostname(),
    platform: platform(),
  };
}
