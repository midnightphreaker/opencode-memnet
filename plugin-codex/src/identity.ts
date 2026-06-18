import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname, platform } from "node:os";
import { dirname, join } from "node:path";
import { getProjectDetails } from "./tags";

const CLIENT_ID_FILE = getClientIdPath();

export function getClientId(): string {
  return getClientIdFromFile(CLIENT_ID_FILE);
}

export function getClientIdPath(home = homedir()): string {
  return join(home, ".codex", "opencode-memnet-client-id");
}

export function getClientIdFromFile(path: string): string {
  try {
    if (existsSync(path)) {
      const value = readFileSync(path, "utf8").trim();
      if (value.length === 36) {
        return value;
      }
    }
  } catch {
    // Generate a fresh client ID when the persisted one cannot be read.
  }

  const id = randomUUID();
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, id, "utf8");
  } catch {
    // A transient ID is still usable if the config directory is not writable.
  }
  return id;
}

export function buildClientMetadata(cwd = process.cwd()): Record<string, unknown> {
  const project = getProjectDetails(cwd);

  return {
    client: "codex",
    runtime: "codex-cli",
    hostname: hostname(),
    platform: platform(),
    cwd,
    projectName: project.projectName,
    ...(project.gitRepoUrl ? { gitRepoUrl: project.gitRepoUrl } : {}),
  };
}
