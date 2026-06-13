import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { stripJsoncComments } from "./jsonc.js";
import { resolveSecretValue } from "./secret-resolver.js";

export interface ConfiguredProfile {
  profileId: string;
  displayName?: string;
  apiKey: string;
}

export type Principal =
  | { kind: "admin" }
  | { kind: "profile"; profileId: string; displayName?: string };

export class UnauthorizedError extends Error {
  readonly status = 401;
}

export class ForbiddenError extends Error {
  readonly status = 403;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

export function timingSafeEqualString(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export function loadConfiguredProfiles(filePath?: string): ConfiguredProfile[] {
  if (!filePath) return [];
  if (!existsSync(filePath)) {
    throw new Error(`PROFILE_KEYS_FILE not found: ${filePath}`);
  }

  const raw = readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(stripJsoncComments(raw)) as { profiles?: unknown };
  if (!Array.isArray(parsed.profiles)) {
    throw new Error("PROFILE_KEYS_FILE must contain a profiles array");
  }

  const seenProfileIds = new Set<string>();
  const seenApiKeys = new Set<string>();
  const profiles: ConfiguredProfile[] = [];

  for (const [index, item] of parsed.profiles.entries()) {
    if (!item || typeof item !== "object") {
      throw new Error(`PROFILE_KEYS_FILE profile at index ${index} must be an object`);
    }
    const entry = item as Record<string, unknown>;
    const profileId = asString(entry.profileId);
    const apiKeySource = asString(entry.apiKey);
    const displayName = asString(entry.displayName);

    if (!profileId) {
      throw new Error(`PROFILE_KEYS_FILE profile at index ${index} is missing profileId`);
    }
    if (!apiKeySource) {
      throw new Error(`PROFILE_KEYS_FILE profile ${profileId} is missing apiKey`);
    }
    if (seenProfileIds.has(profileId)) {
      throw new Error(`Duplicate profileId in PROFILE_KEYS_FILE: ${profileId}`);
    }

    const apiKey = resolveSecretValue(apiKeySource)?.trim();
    if (!apiKey) {
      throw new Error(`PROFILE_KEYS_FILE profile ${profileId} resolved to an empty apiKey`);
    }
    if (seenApiKeys.has(apiKey)) {
      throw new Error("Duplicate apiKey in PROFILE_KEYS_FILE");
    }

    seenProfileIds.add(profileId);
    seenApiKeys.add(apiKey);
    profiles.push(displayName ? { profileId, displayName, apiKey } : { profileId, apiKey });
  }

  return profiles;
}

export function getConfiguredProfileById(
  profiles: readonly ConfiguredProfile[],
  profileId: string | undefined
): ConfiguredProfile | undefined {
  if (!profileId) return undefined;
  return profiles.find((profile) => profile.profileId === profileId);
}

export function findProfileByApiKey(
  profiles: readonly ConfiguredProfile[],
  apiKey: string
): ConfiguredProfile | undefined {
  return profiles.find((profile) => timingSafeEqualString(apiKey, profile.apiKey));
}

export function profileKeyMatchesServerKey(
  profiles: readonly ConfiguredProfile[],
  serverApiKey: string
): boolean {
  if (!serverApiKey) return false;
  return profiles.some((profile) => timingSafeEqualString(profile.apiKey, serverApiKey));
}

export function requireProfileIdForPrincipal(
  principal: Principal,
  requestedProfileId: string | undefined,
  options: { defaultProfileId?: string; requireAdminProfileId?: boolean } = {}
): string {
  const requested = requestedProfileId?.trim() || undefined;

  if (principal.kind === "admin") {
    const profileId = requested ?? options.defaultProfileId;
    if (!profileId && options.requireAdminProfileId) {
      throw new ForbiddenError("Admin requests require an explicit profileId");
    }
    return profileId ?? "";
  }

  if (!requested) return principal.profileId;
  if (requested === principal.profileId) return requested;
  throw new ForbiddenError("Profile key cannot access another profile");
}

export function principalResponse(
  principal: Principal
): { kind: "admin" } | { kind: "profile"; profileId: string; displayName?: string } {
  return principal.kind === "admin"
    ? { kind: "admin" }
    : principal.displayName
      ? { kind: "profile", profileId: principal.profileId, displayName: principal.displayName }
      : { kind: "profile", profileId: principal.profileId };
}
