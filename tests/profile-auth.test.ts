import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ForbiddenError,
  getConfiguredProfileById,
  loadConfiguredProfiles,
  profileKeyMatchesServerKey,
  requireProfileIdForPrincipal,
  type Principal,
} from "../src/services/profile-auth.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "memnet-profile-auth-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.PROFILE_KEY_ONE;
});

function writeProfileFile(content: string): string {
  const file = join(dir, "profiles.jsonc");
  writeFileSync(file, content, "utf-8");
  return file;
}

describe("profile key file parsing", () => {
  it("loads JSONC profile keys and resolves env secret values", () => {
    process.env.PROFILE_KEY_ONE = "secret-one";
    const file = writeProfileFile(`
      {
        // comments and trailing commas are supported
        "profiles": [
          {
            "profileId": " phrkr ",
            "displayName": "Phrkr",
            "apiKey": "env://PROFILE_KEY_ONE",
          },
        ],
      }
    `);

    const profiles = loadConfiguredProfiles(file);

    expect(profiles).toEqual([
      {
        profileId: "phrkr",
        displayName: "Phrkr",
        apiKey: "secret-one",
      },
    ]);
  });

  it("returns an empty profile list when PROFILE_KEYS_FILE is not configured", () => {
    expect(loadConfiguredProfiles(undefined)).toEqual([]);
  });

  it("rejects missing profiles array", () => {
    const file = writeProfileFile(`{ "notProfiles": [] }`);

    expect(() => loadConfiguredProfiles(file)).toThrow(
      "PROFILE_KEYS_FILE must contain a profiles array"
    );
  });

  it("rejects duplicate profile IDs", () => {
    const file = writeProfileFile(`
      {
        "profiles": [
          { "profileId": "phrkr", "apiKey": "one" },
          { "profileId": "phrkr", "apiKey": "two" }
        ]
      }
    `);

    expect(() => loadConfiguredProfiles(file)).toThrow(
      "Duplicate profileId in PROFILE_KEYS_FILE: phrkr"
    );
  });

  it("rejects duplicate API keys", () => {
    const file = writeProfileFile(`
      {
        "profiles": [
          { "profileId": "one", "apiKey": "same" },
          { "profileId": "two", "apiKey": "same" }
        ]
      }
    `);

    expect(() => loadConfiguredProfiles(file)).toThrow("Duplicate apiKey in PROFILE_KEYS_FILE");
  });

  it("rejects unsupported profile fields", () => {
    const file = writeProfileFile(`
      {
        "profiles": [
          { "profileId": "phrkr", "apiKey": "one", "userEmail": "phrkr@example.test" }
        ]
      }
    `);

    expect(() => loadConfiguredProfiles(file)).toThrow(
      "Unsupported PROFILE_KEYS_FILE field for profile phrkr: userEmail"
    );
  });
});

describe("profile key helpers", () => {
  const profiles = [
    { profileId: "phrkr", displayName: "Phrkr", apiKey: "secret-one" },
    { profileId: "work", apiKey: "secret-two" },
  ];

  it("finds configured profiles by ID", () => {
    expect(getConfiguredProfileById(profiles, "phrkr")).toEqual(profiles[0]);
    expect(getConfiguredProfileById(profiles, "missing")).toBeUndefined();
  });

  it("detects profile keys that match the admin key", () => {
    expect(profileKeyMatchesServerKey(profiles, "secret-two")).toBe(true);
    expect(profileKeyMatchesServerKey(profiles, "admin")).toBe(false);
  });

  it("uses requested profile IDs for admin principals", () => {
    const principal: Principal = { kind: "admin" };

    expect(requireProfileIdForPrincipal(principal, "phrkr")).toBe("phrkr");
  });

  it("uses the configured profile ID when a profile principal omits profileId", () => {
    const principal: Principal = { kind: "profile", profileId: "phrkr", displayName: "Phrkr" };

    expect(requireProfileIdForPrincipal(principal, undefined)).toBe("phrkr");
  });

  it("rejects profile principals that request another profile", () => {
    const principal: Principal = { kind: "profile", profileId: "phrkr" };

    expect(() => requireProfileIdForPrincipal(principal, "work")).toThrow(ForbiddenError);
  });
});
