# Full PROFILE_KEYS_FILE Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce `PROFILE_KEYS_FILE` as a real profile-scoped authentication source so profile keys can only read and write their configured `profileId`, while `SERVER_API_KEY` remains the admin/all-profiles key.

**Architecture:** Add a small profile-auth module that parses a JSONC profile key file, resolves secret indirection, and returns a request principal (`admin` or `profile`). Wire that principal through the web server before API handlers run, inject or reject `profileId` values at the HTTP boundary, and add record-level checks for ID-based mutation/read endpoints. The WebUI and plugin should use the server-returned principal so profile keys do not rely on locally trusted `profileId` config.

**Tech Stack:** Bun, TypeScript strict mode, Bun tests, JSONC config parsing, existing `resolveSecretValue`, static WebUI JavaScript, OpenCode plugin bundle.

---

## Baseline

This plan starts from branch `strict-identity-big-bang-rewrite` after commit `7bd1098 feat: strict identity rewrite`.

Current behavior:

- `src/server-config.ts` reads `PROFILE_KEYS_FILE` and only validates that the file exists and is non-empty when configured.
- `src/services/auth.ts` authenticates only `SERVER_API_KEY`.
- `src/services/web-server.ts` trusts `profileId` from query strings and request bodies.
- `src/services/api-handlers.ts` trusts `profileId` passed by the web server and does not protect ID-based update/delete/pin/profile-snapshot endpoints from cross-profile access.
- `src/web/app.js` selects profile IDs client-side.
- `plugin/src/index-remote.ts` currently uses `CLIENT_CONFIG.profileId ?? "default"`.

Target behavior:

- `SERVER_API_KEY` authenticates as `{ kind: "admin" }` and can access any profile.
- Each `PROFILE_KEYS_FILE` entry authenticates as `{ kind: "profile", profileId }`.
- A profile principal can omit `profileId`; the server injects its configured `profileId`.
- A profile principal cannot request, mutate, list, refresh, learn, or inspect another profile.
- `/api/user-profiles` returns all profiles for admin and exactly one profile for profile keys.
- WebUI profile selectors are locked when the current key is profile-scoped.
- Plugin can use either an admin key plus configured `profileId`, or a profile key with no configured `profileId`.

## Profile Key File Schema

Use this JSONC schema:

```jsonc
{
  "profiles": [
    {
      "profileId": "phrkr",
      "displayName": "Phrkr",
      "apiKey": "env://OPENCODE_MEMNET_PROFILE_KEY_PHRKR",
    },
  ],
}
```

Rules:

- Top-level object must contain `profiles`, an array.
- `profileId` is required, trimmed, non-empty, and unique.
- `apiKey` is required, resolved through `resolveSecretValue`, trimmed, non-empty, and unique.
- `displayName` is optional display metadata.
- Profile `apiKey` values must not equal `SERVER_API_KEY`.
- The file supports comments and trailing commas via `stripJsoncComments`.
- Do not add email, nickname, git username, or local path identity fields.

---

## File Structure

Create:

- `src/services/profile-auth.ts`
  - Parses `PROFILE_KEYS_FILE`.
  - Defines `ConfiguredProfile`, `Principal`, and profile-scope enforcement helpers.
  - Provides constant-time key matching.
- `tests/profile-auth.test.ts`
  - Unit tests for JSONC parsing, secret resolution, duplicate rejection, principal resolution, and scope enforcement.
- `tests/auth-middleware-profile-key.test.ts`
  - Unit tests for `AuthMiddleware` returning admin/profile principals and honoring disabled-auth route mode.
- `tests/profile-key-route-enforcement.test.ts`
  - Source and helper tests that prove web server routes call principal enforcement for query/body/profile-list/job paths.
- `tests/profile-key-api-ownership.test.ts`
  - Source tests that prove ID-based API handlers accept a `Principal` and check record profile ownership.
- `tests/webui-profile-key-lock.test.ts`
  - Source test that proves the WebUI locks profile selectors from `/api/user-profiles` principal metadata.
- `tests/plugin-profile-key.test.ts`
  - Plugin runtime/source test for profile-key handshake and no hard-coded profile default for profile principals.

Modify:

- `src/server-config.ts`
  - Add `configuredProfiles`.
  - Load and validate parsed profile-key entries.
- `src/services/auth.ts`
  - Return a principal instead of only success/failure.
  - Authenticate profile keys from config.
  - Respect `DISABLE_WEBUI_AUTH` and `DISABLE_CLIENT_AUTH` based on request kind.
- `src/server.ts`
  - Pass configured profiles into `startWebServer`.
- `src/services/web-server.ts`
  - Resolve request kind and principal.
  - Enforce/inject profile scope on all profile-aware routes.
  - Filter `/api/user-profiles`.
  - Derive maintenance job scope from principal.
- `src/services/web-server-worker.ts`
  - Mirror web-server auth behavior or remove worker routing if the project no longer uses it. Keep type-check green either way.
- `src/services/api-handlers.ts`
  - Accept `Principal` on ID-based operations and profile snapshot reads.
  - Add profile ownership checks after loading records by ID.
  - Add profile-scoped tags/stats support.
- `src/services/storage/types.ts`
  - Add `profileId`/`repoId` filters to tag and aggregate repository methods.
- `src/services/storage/postgres/memory-repository.ts`
  - Apply profile filters to `count`, `countByType`, `getDistinctTags`, and tag value helpers where exposed through profile-scoped APIs.
- `src/services/storage/factory.ts`
  - Keep lazy proxy signatures aligned with repository interface changes.
- `src/web/app.js`
  - Use authenticated `fetchAPI` for profile-list calls.
  - Store current principal metadata.
  - Disable or hide profile selectors for profile principals.
- `plugin/src/services/remote-client.ts`
  - Omit `Authorization` when `apiKey` is empty.
  - Send a plugin request-kind header.
  - Include principal metadata in `clientConnect` response typing.
- `plugin/src/index-remote.ts`
  - Use profile principal from `clientConnect` as effective profile ID.
  - Use configured `profileId` or `"default"` only for admin principal.
- `shared/client-config.ts`
  - Keep `profileId` optional.
- `README.md`, `.env.example`
  - Document the file schema and exact admin/profile behavior.

---

### Task 1: Profile Key Parser And Scope Helpers

**Files:**

- Create: `src/services/profile-auth.ts`
- Modify: `src/server-config.ts`
- Test: `tests/profile-auth.test.ts`
- Test: `tests/profile-keys-config.test.ts`

- [ ] **Step 1: Write the failing profile auth tests**

Create `tests/profile-auth.test.ts`:

```ts
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
```

Update `tests/profile-keys-config.test.ts` so the base config includes `configuredProfiles: []`, then append:

```ts
it("rejects profile keys that match SERVER_API_KEY", () => {
  const errors = validateServerConfig(
    makeConfig({
      serverApiKey: "admin",
      profileKeysFile: "/tmp/profile-keys.jsonc",
      configuredProfiles: [{ profileId: "phrkr", apiKey: "admin" }],
    })
  );

  expect(errors).toContain(
    "PROFILE_KEYS_FILE contains a profile apiKey that matches SERVER_API_KEY"
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
bun test tests/profile-auth.test.ts tests/profile-keys-config.test.ts
```

Expected:

- `tests/profile-auth.test.ts` fails because `src/services/profile-auth.ts` does not exist.
- `tests/profile-keys-config.test.ts` fails because `ServerConfig` has no `configuredProfiles`.

- [ ] **Step 3: Implement `src/services/profile-auth.ts`**

Create `src/services/profile-auth.ts`:

```ts
import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { stripJsoncComments } from "../../shared/jsonc.js";
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
```

- [ ] **Step 4: Update server config to load parsed profiles**

Modify `src/server-config.ts`:

```ts
import {
  loadConfiguredProfiles,
  profileKeyMatchesServerKey,
  type ConfiguredProfile,
} from "./services/profile-auth.js";
```

Add to `ServerConfig`:

```ts
configuredProfiles: ConfiguredProfile[];
```

In `initServerConfig()`, replace the current `profileKeysFile` assignment with:

```ts
profileKeysFile: env.PROFILE_KEYS_FILE || undefined,
configuredProfiles: loadConfiguredProfiles(env.PROFILE_KEYS_FILE || undefined),
```

In `validateServerConfig()`, replace the current `readFileSync` validation block with:

```ts
if (!config.disableClientAuth && config.profileKeysFile && config.configuredProfiles.length === 0) {
  errors.push("PROFILE_KEYS_FILE must contain at least one profile key");
}
if (profileKeyMatchesServerKey(config.configuredProfiles, config.serverApiKey)) {
  errors.push("PROFILE_KEYS_FILE contains a profile apiKey that matches SERVER_API_KEY");
}
```

Remove the unused `readFileSync` import from `src/server-config.ts`.

- [ ] **Step 5: Run tests and type-check**

Run:

```bash
bun test tests/profile-auth.test.ts tests/profile-keys-config.test.ts
bun run typecheck
```

Expected: both tests pass and TypeScript passes.

- [ ] **Step 6: Commit**

```bash
git add src/services/profile-auth.ts src/server-config.ts tests/profile-auth.test.ts tests/profile-keys-config.test.ts
git commit -m "feat: parse profile key config"
```

---

### Task 2: Principal-Returning Auth Middleware

**Files:**

- Modify: `src/services/auth.ts`
- Test: `tests/auth-middleware-profile-key.test.ts`
- Modify: `plugin/src/services/remote-client.ts`

- [ ] **Step 1: Write the failing auth middleware tests**

Create `tests/auth-middleware-profile-key.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { AuthMiddleware } from "../src/services/auth.js";

function requestWithBearer(key?: string): Request {
  const headers = new Headers();
  if (key !== undefined) headers.set("Authorization", `Bearer ${key}`);
  return new Request("http://localhost/api/memories", { headers });
}

describe("AuthMiddleware profile keys", () => {
  const auth = new AuthMiddleware("admin-secret", {
    disableWebuiAuth: false,
    disableClientAuth: false,
    configuredProfiles: [{ profileId: "phrkr", displayName: "Phrkr", apiKey: "profile-secret" }],
  });

  it("authenticates SERVER_API_KEY as admin", () => {
    const result = auth.authenticate(requestWithBearer("admin-secret"), "webui");

    expect(result instanceof Response).toBe(false);
    expect(result).toEqual({ principal: { kind: "admin" }, authDisabled: false });
  });

  it("authenticates configured profile keys as profile principals", () => {
    const result = auth.authenticate(requestWithBearer("profile-secret"), "client");

    expect(result instanceof Response).toBe(false);
    expect(result).toEqual({
      principal: { kind: "profile", profileId: "phrkr", displayName: "Phrkr" },
      authDisabled: false,
    });
  });

  it("rejects missing bearer tokens when route auth is enabled", async () => {
    const result = auth.authenticate(requestWithBearer(undefined), "client");

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
    await expect((result as Response).json()).resolves.toEqual({
      success: false,
      error: "Missing Authorization header",
    });
  });

  it("uses admin principal when auth is disabled and no bearer token is sent", () => {
    const disabled = new AuthMiddleware("admin-secret", {
      disableWebuiAuth: true,
      disableClientAuth: false,
      configuredProfiles: [],
    });

    const result = disabled.authenticate(requestWithBearer(undefined), "webui");

    expect(result).toEqual({ principal: { kind: "admin" }, authDisabled: true });
  });

  it("still validates an explicit bearer token when auth is disabled", async () => {
    const disabled = new AuthMiddleware("admin-secret", {
      disableWebuiAuth: true,
      disableClientAuth: false,
      configuredProfiles: [],
    });

    const result = disabled.authenticate(requestWithBearer("wrong"), "webui");

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test tests/auth-middleware-profile-key.test.ts
```

Expected: FAIL because `AuthMiddleware` does not accept `configuredProfiles` and does not return principals.

- [ ] **Step 3: Implement principal-returning auth**

Replace `src/services/auth.ts` with:

```ts
// src/services/auth.ts
import {
  findProfileByApiKey,
  timingSafeEqualString,
  type ConfiguredProfile,
  type Principal,
} from "./profile-auth.js";

export type RouteKind = "webui" | "client";

export interface AuthResult {
  principal: Principal;
  authDisabled: boolean;
}

export class AuthMiddleware {
  private readonly apiKey: string;
  private readonly disableWebuiAuth: boolean;
  private readonly disableClientAuth: boolean;
  private readonly configuredProfiles: ConfiguredProfile[];

  constructor(
    apiKey: string,
    options?: {
      disableWebuiAuth?: boolean;
      disableClientAuth?: boolean;
      configuredProfiles?: ConfiguredProfile[];
    }
  ) {
    this.apiKey = apiKey;
    this.disableWebuiAuth = options?.disableWebuiAuth ?? false;
    this.disableClientAuth = options?.disableClientAuth ?? false;
    this.configuredProfiles = options?.configuredProfiles ?? [];
  }

  get isAuthFullyDisabled(): boolean {
    return this.disableWebuiAuth && this.disableClientAuth;
  }

  get isWebuiAuthDisabled(): boolean {
    return this.disableWebuiAuth;
  }

  get isClientAuthDisabled(): boolean {
    return this.disableClientAuth;
  }

  authenticate(req: Request, routeKind: RouteKind): AuthResult | Response {
    const authHeader = req.headers.get("Authorization");
    const routeAuthDisabled =
      routeKind === "client" ? this.disableClientAuth : this.disableWebuiAuth;

    if (!authHeader) {
      if (routeAuthDisabled) {
        return { principal: { kind: "admin" }, authDisabled: true };
      }
      return this.unauthorized("Missing Authorization header");
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer" || !parts[1]) {
      return this.unauthorized("Invalid Authorization format. Use: Bearer <key>");
    }

    const key = parts[1];
    if (this.apiKey && timingSafeEqualString(key, this.apiKey)) {
      return { principal: { kind: "admin" }, authDisabled: false };
    }

    const profile = findProfileByApiKey(this.configuredProfiles, key);
    if (profile) {
      return {
        principal: profile.displayName
          ? { kind: "profile", profileId: profile.profileId, displayName: profile.displayName }
          : { kind: "profile", profileId: profile.profileId },
        authDisabled: false,
      };
    }

    return this.unauthorized("Invalid API key");
  }

  private unauthorized(message: string): Response {
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
}
```

- [ ] **Step 4: Add plugin request-kind header and optional Authorization**

In `plugin/src/services/remote-client.ts`, replace the `headers` object in `request()` with:

```ts
const headers: Record<string, string> = {
  "Content-Type": "application/json",
  "X-Client-ID": this.clientId,
  "X-Opencode-Memnet-Client": "plugin",
};
if (this.apiKey) {
  headers.Authorization = `Bearer ${this.apiKey}`;
}
```

Then pass `headers` to `fetch()`:

```ts
const response = await fetch(url.toString(), {
  method,
  headers,
  body: body ? JSON.stringify(body) : undefined,
  signal: controller.signal,
});
```

- [ ] **Step 5: Run tests**

Run:

```bash
bun test tests/auth-middleware-profile-key.test.ts tests/plugin-remote-client-scope.test.ts
bun run typecheck
```

Expected: tests pass and TypeScript passes.

- [ ] **Step 6: Commit**

```bash
git add src/services/auth.ts plugin/src/services/remote-client.ts tests/auth-middleware-profile-key.test.ts
git commit -m "feat: authenticate profile keys"
```

---

### Task 3: Web Server Principal Enforcement

**Files:**

- Modify: `src/server.ts`
- Modify: `src/services/web-server.ts`
- Modify: `src/services/web-server-worker.ts`
- Test: `tests/profile-key-route-enforcement.test.ts`

- [ ] **Step 1: Write failing route enforcement source tests**

Create `tests/profile-key-route-enforcement.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(import.meta.dir, "..", path), "utf-8");

describe("profile key route enforcement", () => {
  const webServer = read("src/services/web-server.ts");
  const server = read("src/server.ts");

  it("passes configured profiles into the web server", () => {
    expect(server).toContain("configuredProfiles: config.configuredProfiles");
    expect(webServer).toContain("configuredProfiles?: ConfiguredProfile[]");
  });

  it("classifies plugin requests with X-Opencode-Memnet-Client", () => {
    expect(webServer).toContain('"X-Opencode-Memnet-Client"');
    expect(webServer).toContain('=== "plugin"');
  });

  it("keeps the request principal from auth and passes it to scoped routes", () => {
    expect(webServer).toContain("const authContext = this.authenticateApiRequest(req, path)");
    expect(webServer).toContain("const principal = authContext.principal");
  });

  it("enforces profile scope on query and body profile IDs", () => {
    expect(webServer).toContain("requireProfileIdForPrincipal(principal");
    expect(webServer).toContain("applyPrincipalProfileToBody");
  });

  it("filters profile listing by principal", () => {
    expect(webServer).toContain("handleListUserProfiles(principal)");
    expect(webServer).toContain("principalResponse(principal)");
  });

  it("uses principal profile for maintenance job scope", () => {
    expect(webServer).toContain("deriveJobScope(principal)");
    expect(webServer).toContain('principal.kind === "profile"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test tests/profile-key-route-enforcement.test.ts
```

Expected: FAIL because web-server does not yet keep a principal.

- [ ] **Step 3: Pass configured profiles from server startup**

In `src/server.ts`, change the `startWebServer()` options object to:

```ts
{
  disableWebuiAuth: config.disableWebuiAuth,
  disableClientAuth: config.disableClientAuth,
  configuredProfiles: config.configuredProfiles,
}
```

In `src/services/web-server.ts`, import:

```ts
import type { ConfiguredProfile, Principal } from "./profile-auth.js";
import { principalResponse, requireProfileIdForPrincipal } from "./profile-auth.js";
import type { AuthResult, RouteKind } from "./auth.js";
```

Change the constructor options type to:

```ts
options?: {
  disableWebuiAuth?: boolean;
  disableClientAuth?: boolean;
  configuredProfiles?: ConfiguredProfile[];
}
```

Construct auth with profiles:

```ts
this.auth = new AuthMiddleware(apiKey, options);
```

- [ ] **Step 4: Add route-kind and auth-context helpers**

Add these private methods inside `WebServer`:

```ts
private getRouteKind(req: Request): RouteKind {
  return req.headers.get("X-Opencode-Memnet-Client") === "plugin" ? "client" : "webui";
}

private authenticateApiRequest(req: Request, path: string): AuthResult | Response {
  if (path === "/api/health") {
    return { principal: { kind: "admin" }, authDisabled: true };
  }
  if (!path.startsWith("/api/")) {
    return { principal: { kind: "admin" }, authDisabled: true };
  }
  if (!this.auth) {
    return this.jsonResponse({ success: false, error: "Authentication is not configured" }, 401);
  }
  return this.auth.authenticate(req, this.getRouteKind(req));
}

private profileIdForRequest(
  principal: Principal,
  requestedProfileId: string | undefined,
  options: { defaultProfileId?: string; requireAdminProfileId?: boolean } = {}
): string {
  return requireProfileIdForPrincipal(principal, requestedProfileId, options);
}

private applyPrincipalProfileToBody<T extends Record<string, any>>(
  principal: Principal,
  body: T,
  options: { requireAdminProfileId?: boolean } = {}
): T {
  return {
    ...body,
    profileId: this.profileIdForRequest(principal, body.profileId, options),
  };
}

private deriveJobScope(principal: Principal): { kind: "all" } | { kind: "profile"; profileId: string } {
  return principal.kind === "profile" ? { kind: "profile", profileId: principal.profileId } : { kind: "all" };
}
```

Remove the old no-argument `deriveJobScope()` method.

- [ ] **Step 5: Authenticate once per API request**

Replace the existing auth block in `_handleRequest()` with:

```ts
let principal: Principal = { kind: "admin" };
if (path.startsWith("/api/") && path !== "/api/health") {
  const authContext = this.authenticateApiRequest(req, path);
  if (authContext instanceof Response) return authContext;
  principal = authContext.principal;
}
```

- [ ] **Step 6: Enforce profile scope on route handlers**

Update these route bodies in `src/services/web-server.ts`:

`GET /api/tags`:

```ts
const profileId = principal.kind === "profile" ? principal.profileId : undefined;
const result = await handleListTags(profileId);
return this.jsonResponse(result);
```

`GET /api/memories`:

```ts
const requestedProfileId = url.searchParams.get("profileId") || undefined;
const profileId = this.profileIdForRequest(principal, requestedProfileId, {
  defaultProfileId: "default",
});
const repoId = url.searchParams.get("repoId") || undefined;
const result = await handleListMemories(tag, page, pageSize, includePrompts, profileId, repoId);
return this.jsonResponse(result);
```

`POST /api/memories`:

```ts
const body = await this.parseBody(req);
const scopedBody = this.applyPrincipalProfileToBody(principal, body, {
  requireAdminProfileId: true,
});
const result = await handleAddMemory(scopedBody);
return this.jsonResponse(result);
```

`GET /api/search`:

```ts
const requestedProfileId = url.searchParams.get("profileId") || undefined;
const profileId = this.profileIdForRequest(principal, requestedProfileId, {
  defaultProfileId: "default",
});
const repoId = url.searchParams.get("repoId") || undefined;
const result = await handleSearch(query, tag, page, pageSize, profileId, repoId);
return this.jsonResponse(result);
```

`GET /api/user-profile`:

```ts
const requestedProfileId = url.searchParams.get("profileId") || undefined;
const profileId =
  principal.kind === "admin"
    ? requestedProfileId
    : this.profileIdForRequest(principal, requestedProfileId);
const result = await handleGetUserProfile(profileId);
return this.jsonResponse(result);
```

`GET /api/user-profile/changelog`:

```ts
const profileId = this.profileIdForRequest(
  principal,
  url.searchParams.get("profileId") || undefined,
  {
    requireAdminProfileId: true,
  }
);
const limit = parseInt(url.searchParams.get("limit") || "5");
const result = await handleGetProfileChangelog(profileId, limit);
return this.jsonResponse(result);
```

`GET /api/user-profile/snapshot`:

```ts
const changelogId = url.searchParams.get("chlogId");
if (!changelogId) {
  return this.jsonResponse({ success: false, error: "changelogId parameter required" });
}
const result = await handleGetProfileSnapshot(changelogId, principal);
return this.jsonResponse(result);
```

`POST /api/user-profile/refresh`:

```ts
const body = await this.parseBody(req);
if (body.userId) {
  return this.jsonResponse({ success: false, error: "Use profileId, not userId" }, 400);
}
const profileId = this.profileIdForRequest(principal, body.profileId, {
  requireAdminProfileId: true,
});
const result = await handleRefreshProfile(profileId);
return this.jsonResponse(result);
```

`POST /api/context/inject`, `POST /api/auto-capture`, and `POST /api/user-profile/learn`:

```ts
const body = await this.parseBody(req);
const scopedBody = this.applyPrincipalProfileToBody(principal, body, {
  requireAdminProfileId: true,
});
const result = await (await import("./api-handlers.js")).handleContextInject(scopedBody);
return this.jsonResponse(result);
```

Use the matching handler name for each route.

`POST /api/cleanup`, `POST /api/deduplicate`, and `POST /api/tags/normalize`:

```ts
const scope = this.deriveJobScope(principal);
```

`GET /api/user-profiles`:

```ts
const result = await handleListUserProfiles(principal);
if (!result.success) return this.jsonResponse(result);
return this.jsonResponse({
  success: true,
  data: {
    ...result.data,
    principal: principalResponse(principal),
  },
});
```

`POST /api/client/connect`:

```ts
const body = await this.parseBody(req);
const result = await handleClientConnect(body, principal);
return this.jsonResponse(result);
```

For `DELETE`, `PUT`, `pin`, `unpin`, prompt delete, and bulk delete routes, pass `principal` to the handler calls. Task 4 updates those signatures.

- [ ] **Step 7: Keep CORS headers aligned**

In `src/services/web-server.ts`, add `X-Opencode-Memnet-Client` to both CORS allow-header strings:

```ts
"Content-Type, Authorization, X-Client-ID, X-Opencode-Memnet-Client";
```

- [ ] **Step 8: Mirror behavior in `web-server-worker.ts`**

If `src/services/web-server-worker.ts` is still compiled, import the same auth/profile helpers and make the same route changes there. If it is unused and not imported anywhere, delete it in this task and run type-check. Do not leave stale code that accepts profile IDs without principal enforcement.

- [ ] **Step 9: Run tests and type-check**

Run:

```bash
bun test tests/profile-key-route-enforcement.test.ts tests/auth-middleware-profile-key.test.ts
bun run typecheck
```

Expected: tests pass and TypeScript passes.

- [ ] **Step 10: Commit**

```bash
git add src/server.ts src/services/web-server.ts src/services/web-server-worker.ts tests/profile-key-route-enforcement.test.ts
git commit -m "feat: enforce request principals in web server"
```

---

### Task 4: API Handler Ownership Checks

**Files:**

- Modify: `src/services/api-handlers.ts`
- Test: `tests/profile-key-api-ownership.test.ts`

- [x] **Step 1: Write failing ownership source tests**

Create `tests/profile-key-api-ownership.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dir, "../src/services/api-handlers.ts"), "utf-8");

describe("profile key API ownership checks", () => {
  it("imports Principal and ForbiddenError", () => {
    expect(source).toContain('import type { Principal } from "./profile-auth.js"');
    expect(source).toContain("ForbiddenError");
  });

  it("checks memory record ownership for ID-based memory operations", () => {
    expect(source).toContain("function ensurePrincipalCanAccessProfile");
    expect(source).toContain("handleDeleteMemory(");
    expect(source).toContain("principal?: Principal");
    expect(source).toContain("ensurePrincipalCanAccessProfile(principal, memory.profileId)");
  });

  it("checks prompt record ownership for prompt deletion", () => {
    expect(source).toContain("ensurePrincipalCanAccessProfile(principal, prompt.profileId)");
  });

  it("checks changelog ownership for snapshot reads", () => {
    expect(source).toContain(
      "handleGetProfileSnapshot(changelogId: string, principal?: Principal)"
    );
    expect(source).toContain("ensurePrincipalCanAccessProfile(principal, changelog.profileId)");
  });

  it("filters listed profiles by principal", () => {
    expect(source).toContain("handleListUserProfiles(principal?: Principal)");
    expect(source).toContain('principal.kind === "profile"');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
bun test tests/profile-key-api-ownership.test.ts
```

Expected: FAIL because handlers do not accept principals.

- [x] **Step 3: Add ownership helper**

In `src/services/api-handlers.ts`, import:

```ts
import { ForbiddenError } from "./profile-auth.js";
import type { Principal } from "./profile-auth.js";
```

Add this helper near the other local helper functions:

```ts
function ensurePrincipalCanAccessProfile(
  principal: Principal | undefined,
  profileId: string | undefined
): ApiResponse<void> | null {
  if (!principal || principal.kind === "admin") return null;
  if (profileId === principal.profileId) return null;
  return { success: false, error: "Profile key cannot access another profile" };
}

function forbiddenFromError(error: unknown): ApiResponse<void> | null {
  return error instanceof ForbiddenError ? { success: false, error: error.message } : null;
}
```

- [x] **Step 4: Protect memory ID operations**

Change signatures and add checks:

```ts
export async function handleDeleteMemory(
  id: string,
  cascade: boolean = false,
  principal?: Principal
): Promise<ApiResponse<{ deletedPrompt: boolean }>> {
```

After loading `memory`:

```ts
const accessError = ensurePrincipalCanAccessProfile(principal, memory.profileId);
if (accessError) return accessError;
```

Change `handleBulkDelete()` signature:

```ts
export async function handleBulkDelete(
  ids: string[],
  cascade: boolean = false,
  principal?: Principal
): Promise<ApiResponse<{ deleted: number; total: number; failedIds?: string[] }>> {
```

In cascade mode, call:

```ts
const result = await handleDeleteMemory(id, cascade, principal);
```

In non-cascade mode, replace direct `deleteMany(ids)` with record checks:

```ts
let deleted = 0;
const failedIds: string[] = [];
for (const id of ids) {
  const result = await handleDeleteMemory(id, false, principal);
  if (result.success) deleted++;
  else failedIds.push(id);
}
return { success: true, data: { deleted, total: ids.length, failedIds } };
```

Change `handleUpdateMemory()` signature:

```ts
export async function handleUpdateMemory(
  id: string,
  data: { content?: string; type?: MemoryType; tags?: string[]; containerTag?: string },
  principal?: Principal
): Promise<ApiResponse<void>> {
```

After loading `existingMemory`:

```ts
const accessError = ensurePrincipalCanAccessProfile(principal, existingMemory.profileId);
if (accessError) return accessError;
```

Change `handlePinMemory()` and `handleUnpinMemory()` to accept `principal?: Principal` and add the same check after loading `memory`.

- [x] **Step 5: Protect prompt deletion**

Change `handleDeletePrompt()` signature:

```ts
export async function handleDeletePrompt(
  id: string,
  cascade: boolean = false,
  principal?: Principal
): Promise<ApiResponse<{ deletedMemory: boolean }>> {
```

After loading `prompt`:

```ts
const accessError = ensurePrincipalCanAccessProfile(principal, prompt.profileId);
if (accessError) return accessError;
```

When cascade deletes linked memory:

```ts
const result = await handleDeleteMemory(prompt.linkedMemoryId, false, principal);
```

Change `handleBulkDeletePrompts()` signature:

```ts
export async function handleBulkDeletePrompts(
  ids: string[],
  cascade: boolean = false,
  principal?: Principal
): Promise<ApiResponse<{ deleted: number }>> {
```

Loop with:

```ts
const result = await handleDeletePrompt(id, cascade, principal);
```

- [x] **Step 6: Protect profile snapshots and profile list**

Change snapshot signature:

```ts
export async function handleGetProfileSnapshot(
  changelogId: string,
  principal?: Principal
): Promise<ApiResponse<any>> {
```

After loading `changelog`:

```ts
const accessError = ensurePrincipalCanAccessProfile(principal, changelog.profileId);
if (accessError) return accessError;
```

Change profile list signature:

```ts
export async function handleListUserProfiles(
  principal?: Principal
): Promise<
  ApiResponse<{
    profiles: Array<{ profileId: string }>;
  }>
> {
```

After creating `list`, filter profile principals:

```ts
const visibleProfiles =
  principal?.kind === "profile"
    ? list.filter((profile) => profile.profileId === principal.profileId)
    : list;

return {
  success: true,
  data: { profiles: visibleProfiles },
};
```

- [x] **Step 7: Update web-server handler calls**

In `src/services/web-server.ts`, pass `principal` to:

```ts
handleDeleteMemory(id, cascade, principal);
handleUpdateMemory(id, body, principal);
handleBulkDelete(body.ids || [], cascade, principal);
handlePinMemory(id, principal);
handleUnpinMemory(id, principal);
handleDeletePrompt(id, cascade, principal);
handleBulkDeletePrompts(body.ids || [], cascade, principal);
handleGetProfileSnapshot(changelogId, principal);
handleListUserProfiles(principal);
```

Apply the same call-site updates in `src/services/web-server-worker.ts` if the file remains.

- [x] **Step 8: Run tests and type-check**

Run:

```bash
bun test tests/profile-key-api-ownership.test.ts tests/profile-key-route-enforcement.test.ts
bun run typecheck
```

Expected: tests pass and TypeScript passes.

- [x] **Step 9: Commit**

```bash
git add src/services/api-handlers.ts src/services/web-server.ts src/services/web-server-worker.ts tests/profile-key-api-ownership.test.ts
git commit -m "feat: guard profile-owned API records"
```

---

### Task 5: Profile-Scoped Tags And Stats

**Files:**

- Modify: `src/services/storage/types.ts`
- Modify: `src/services/storage/postgres/memory-repository.ts`
- Modify: `src/services/storage/factory.ts`
- Modify: `src/services/api-handlers.ts`
- Test: `tests/profile-key-aggregate-scope.test.ts`

- [x] **Step 1: Write failing source tests for aggregate scope**

Create `tests/profile-key-aggregate-scope.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(import.meta.dir, "..", path), "utf-8");

describe("profile key aggregate scope", () => {
  it("adds profile filters to memory aggregate interfaces", () => {
    const types = read("src/services/storage/types.ts");

    expect(types).toContain("profileId?: string");
    expect(types).toContain("countByType(args?:");
    expect(types).toContain("getDistinctTags(args?:");
  });

  it("filters postgres aggregate SQL by profile_id", () => {
    const repo = read("src/services/storage/postgres/memory-repository.ts");

    expect(repo).toContain("profileIdFilter");
    expect(repo).toContain("profile_id = ${profileIdFilter}");
  });

  it("passes profile scope into tags and stats handlers", () => {
    const handlers = read("src/services/api-handlers.ts");

    expect(handlers).toContain("handleListTags(profileId?: string)");
    expect(handlers).toContain("handleStats(profileId?: string)");
    expect(handlers).toContain("memoryRepo.countByType({ profileId })");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
bun test tests/profile-key-aggregate-scope.test.ts
```

Expected: FAIL because aggregate methods do not accept profile filters yet.

- [x] **Step 3: Extend storage interfaces**

In `src/services/storage/types.ts`, change:

```ts
count(args?: {
  containerTag?: string;
  scope?: MemoryScopeKind;
  scopeHash?: string;
  profileId?: string;
  repoId?: string;
}): Promise<number>;
countByType(args?: { profileId?: string; repoId?: string }): Promise<Record<string, number>>;
getDistinctTags(args?: {
  scope?: MemoryScopeKind;
  scopeHash?: string;
  profileId?: string;
  repoId?: string;
}): Promise<TagInfo[]>;
getDistinctTagValues(args?: {
  scope?: MemoryScopeKind;
  profileId?: string;
  repoId?: string;
}): Promise<string[]>;
```

Update the lazy proxy in `src/services/storage/factory.ts` to forward these widened signatures:

```ts
async count(args?: Parameters<MemoryRepository["count"]>[0]): Promise<number> {
  return (await this.repo()).count(args);
}
async countByType(args?: Parameters<MemoryRepository["countByType"]>[0]): Promise<Record<string, number>> {
  return (await this.repo()).countByType(args);
}
async getDistinctTags(args?: Parameters<MemoryRepository["getDistinctTags"]>[0]): Promise<TagInfo[]> {
  return (await this.repo()).getDistinctTags(args);
}
async getDistinctTagValues(args?: Parameters<MemoryRepository["getDistinctTagValues"]>[0]): Promise<string[]> {
  return (await this.repo()).getDistinctTagValues(args);
}
```

- [x] **Step 4: Apply profile filters in Postgres repository**

In `src/services/storage/postgres/memory-repository.ts`, update `count()`:

```ts
const profileIdFilter = args?.profileId ?? "";
const repoIdFilter = args?.repoId ?? "";

const rows = await sql`
  SELECT COUNT(*) as count FROM memories
  WHERE scope = ${scope}
    AND (${scopeHashFilter}::text = '' OR scope_hash = ${scopeHashFilter})
    AND (${containerTagFilter}::text = '' OR container_tag = ${containerTagFilter})
    AND (${profileIdFilter}::text = '' OR profile_id = ${profileIdFilter})
    AND (${repoIdFilter}::text = '' OR repo_id = ${repoIdFilter})
`;
```

Change `countByType()` to:

```ts
async countByType(args?: { profileId?: string; repoId?: string }): Promise<Record<string, number>> {
  const sql = getPostgresClient();
  const profileIdFilter = args?.profileId ?? "";
  const repoIdFilter = args?.repoId ?? "";
  const rows = await sql`
    SELECT type, COUNT(*) as count
    FROM memories
    WHERE (${profileIdFilter}::text = '' OR profile_id = ${profileIdFilter})
      AND (${repoIdFilter}::text = '' OR repo_id = ${repoIdFilter})
    GROUP BY type
  `;
  const result: Record<string, number> = {};
  for (const row of rows) {
    const key = row.type ?? "(unclassified)";
    result[key] = Number(row.count);
  }
  return result;
}
```

Update `getDistinctTags()` with `profileIdFilter` and `repoIdFilter`:

```ts
AND (${profileIdFilter}::text = '' OR profile_id = ${profileIdFilter})
AND (${repoIdFilter}::text = '' OR repo_id = ${repoIdFilter})
```

Update `getDistinctTagValues()` with the same filters.

- [x] **Step 5: Use profile filters in handlers**

In `src/services/api-handlers.ts`, change signatures:

```ts
export async function handleListTags(profileId?: string): Promise<ApiResponse<{ project: TagInfo[] }>> {
```

Use:

```ts
const allTags = await memoryRepo.getDistinctTags({ scope: "project", profileId });
```

Change `getProjectScopeFromTag()` to accept profile scope:

```ts
async function getProjectScopeFromTag(
  tag: string,
  profileId?: string
): Promise<{ profileId: string; repoId?: string } | undefined> {
  const tags = await memoryRepo.getDistinctTags({ scope: "project", profileId });
  const match = tags.find((t) => t.tag === tag);
  return match?.profileId ? { profileId: match.profileId, repoId: match.repoId } : undefined;
}
```

Update callers to pass `profileId`.

Change stats:

```ts
export async function handleStats(profileId?: string): Promise<
  ApiResponse<{
    total: number;
    byScope: { user: number; project: number };
    byType: Record<string, number>;
  }>
> {
  try {
    await ensureInit();
    const [userCount, projectCount, typeCount] = await Promise.all([
      memoryRepo.count({ scope: "user", profileId }),
      memoryRepo.count({ scope: "project", profileId }),
      memoryRepo.countByType({ profileId }),
    ]);
    return {
      success: true,
      data: {
        total: userCount + projectCount,
        byScope: { user: userCount, project: projectCount },
        byType: typeCount,
      },
    };
  } catch (error) {
    log("handleStats: error", { error: String(error) });
    return { success: false, error: "Internal server error" };
  }
}
```

In `src/services/web-server.ts`, pass:

```ts
const profileFilter = principal.kind === "profile" ? principal.profileId : undefined;
const result = await handleStats(profileFilter);
```

Apply the same stats/tag call updates in `src/services/web-server-worker.ts` if the file remains.

- [x] **Step 6: Run tests and type-check**

Run:

```bash
bun test tests/profile-key-aggregate-scope.test.ts tests/profile-key-route-enforcement.test.ts
bun run typecheck
```

Expected: tests pass and TypeScript passes.

- [x] **Step 7: Commit**

```bash
git add src/services/storage/types.ts src/services/storage/postgres/memory-repository.ts src/services/storage/factory.ts src/services/api-handlers.ts src/services/web-server.ts src/services/web-server-worker.ts tests/profile-key-aggregate-scope.test.ts
git commit -m "feat: scope aggregate reads by profile"
```

---

### Task 6: WebUI Profile-Key Lock

**Files:**

- Modify: `src/web/app.js`
- Test: `tests/webui-profile-key-lock.test.ts`

- [x] **Step 1: Write failing WebUI source test**

Create `tests/webui-profile-key-lock.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const app = readFileSync(join(import.meta.dir, "../src/web/app.js"), "utf-8");

describe("WebUI profile key lock", () => {
  it("tracks principal metadata from /api/user-profiles", () => {
    expect(app).toContain("principal: null");
    expect(app).toContain("applyProfilePrincipal");
    expect(app).toContain("data.data.principal");
  });

  it("uses fetchAPI for profile list calls so Authorization is sent", () => {
    expect(app).toContain('fetchAPI("/api/user-profiles")');
    expect(app).not.toContain('fetch("/api/user-profiles"');
  });

  it("locks profile selectors for profile principals", () => {
    expect(app).toContain('state.principal?.kind === "profile"');
    expect(app).toContain("select.disabled = state.profileLocked");
    expect(app).toContain("state.activeProfileId = state.principal.profileId");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
bun test tests/webui-profile-key-lock.test.ts
```

Expected: FAIL because WebUI does not track principal metadata.

- [x] **Step 3: Add principal state and helper**

In `src/web/app.js`, add state fields:

```js
principal: null,
profileLocked: false,
```

Add this helper after `fetchAPI()`:

```js
function applyProfilePrincipal(principal) {
  state.principal = principal || null;
  state.profileLocked = state.principal?.kind === "profile";
  if (state.profileLocked) {
    state.activeProfileId = state.principal.profileId;
    localStorage.setItem("opencode-memnet-active-profile", state.activeProfileId);
  }
}
```

- [x] **Step 4: Use authenticated profile list calls**

In `loadProfilePanelSelector()`, replace raw `fetch("/api/user-profiles", ...)` with:

```js
const data = await fetchAPI("/api/user-profiles");
```

In `populateProfileDropdown()`, replace raw `fetch("/api/user-profiles", { headers })` with:

```js
const data = await fetchAPI("/api/user-profiles");
```

Remove now-unused local `headers` variables in those functions.

- [x] **Step 5: Apply principal metadata to selectors**

In both profile-list success branches, call:

```js
applyProfilePrincipal(data.data.principal);
```

After populating the select element, add:

```js
if (state.profileLocked) {
  select.value = state.activeProfileId;
}
select.disabled = state.profileLocked;
```

In the settings profile change listener, add this guard at the top:

```js
if (state.profileLocked) return;
```

In `openProfileSheet()`, show the profile selector when either auth is disabled or an admin key is in use:

```js
if (state.authDisabled || state.principal?.kind === "admin") {
  loadProfilePanelSelector();
} else {
  document.getElementById("profile-selector-row").style.display = "none";
  state.panelViewProfileId = state.activeProfileId;
  loadUserProfile();
}
```

- [x] **Step 6: Run WebUI tests**

Run:

```bash
bun test tests/webui-profile-key-lock.test.ts tests/webui-strict-identity.test.ts
bun run build
```

Expected: tests and server build pass.

- [x] **Step 7: Commit**

```bash
git add src/web/app.js tests/webui-profile-key-lock.test.ts
git commit -m "feat: lock webui to profile key principal"
```

---

### Task 7: Plugin Effective Profile Principal

**Files:**

- Modify: `plugin/src/services/remote-client.ts`
- Modify: `plugin/src/index-remote.ts`
- Modify: `shared/client-config.ts`
- Test: `tests/plugin-profile-key.test.ts`
- Test: `tests/plugin-remote-client-scope.test.ts`

- [x] **Step 1: Write failing plugin test**

Create `tests/plugin-profile-key.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const indexRemote = readFileSync(join(import.meta.dir, "../plugin/src/index-remote.ts"), "utf-8");
const remoteClient = readFileSync(
  join(import.meta.dir, "../plugin/src/services/remote-client.ts"),
  "utf-8"
);
const clientConfig = readFileSync(join(import.meta.dir, "../shared/client-config.ts"), "utf-8");

describe("plugin profile key support", () => {
  it("keeps profileId optional in client config", () => {
    expect(clientConfig).toContain("profileId?: string");
  });

  it("uses clientConnect principal as effective profile for profile keys", () => {
    expect(indexRemote).toContain("let effectiveProfileId = CLIENT_CONFIG.profileId");
    expect(indexRemote).toContain('connectionInfo.principal?.kind === "profile"');
    expect(indexRemote).toContain("effectiveProfileId = connectionInfo.principal.profileId");
  });

  it("falls back to default only for admin principals", () => {
    expect(indexRemote).toContain('connectionInfo.principal?.kind !== "profile"');
    expect(indexRemote).toContain('effectiveProfileId = effectiveProfileId ?? "default"');
  });

  it("types clientConnect principal metadata", () => {
    expect(remoteClient).toContain(
      'principal: { kind: "admin" } | { kind: "profile"; profileId: string; displayName?: string }'
    );
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
bun test tests/plugin-profile-key.test.ts
```

Expected: FAIL because plugin does not use server principal metadata.

- [x] **Step 3: Type `clientConnect` principal response**

In `plugin/src/services/remote-client.ts`, update the `clientConnect()` return type:

```ts
ApiResponse<{
  firstTime: boolean;
  daysSinceLastSeen: number | null;
  welcomeBack: boolean;
  stats: { totalMemories: number; memoriesToday: number; totalPrompts: number } | null;
  principal: { kind: "admin" } | { kind: "profile"; profileId: string; displayName?: string };
}>;
```

- [x] **Step 4: Return principal from server client connect**

In `src/services/api-handlers.ts`, change `handleClientConnect` signature:

```ts
export async function handleClientConnect(
  data: {
    clientId: string;
    metadata?: Record<string, unknown>;
  },
  principal: Principal = { kind: "admin" }
): Promise<ApiResponse<{
  firstTime: boolean;
  daysSinceLastSeen: number | null;
  welcomeBack: boolean;
  stats: { totalMemories: number; memoriesToday: number; totalPrompts: number } | null;
  principal: ReturnType<typeof principalResponse>;
}>> {
```

Import `principalResponse` from `./profile-auth.js` and add to returned data:

```ts
principal: principalResponse(principal),
```

- [x] **Step 5: Use effective profile ID in plugin runtime**

In `plugin/src/index-remote.ts`, replace:

```ts
const profileId = CLIENT_CONFIG.profileId ?? "default";
```

with:

```ts
let effectiveProfileId = CLIENT_CONFIG.profileId;
```

After `client.clientConnect(...)` succeeds and `connectionInfo` is available, add:

```ts
if (connectionInfo.principal?.kind === "profile") {
  effectiveProfileId = connectionInfo.principal.profileId;
} else if (connectionInfo.principal?.kind !== "profile") {
  effectiveProfileId = effectiveProfileId ?? "default";
}
```

Replace later uses of `profileId` with `effectiveProfileId`. For calls that require a string, use:

```ts
const profileId = effectiveProfileId ?? "default";
```

Do not use the fallback before `clientConnect` has had a chance to return a profile principal.

- [x] **Step 6: Run plugin tests and build**

Run:

```bash
bun test tests/plugin-profile-key.test.ts tests/plugin-remote-client-scope.test.ts tests/profile-tool-runtime.test.ts
bun run build:plugin
bun run typecheck:plugin
```

Expected: tests pass, plugin build passes, plugin type-check passes.

- [x] **Step 7: Commit**

```bash
git add src/services/api-handlers.ts plugin/src/services/remote-client.ts plugin/src/index-remote.ts shared/client-config.ts tests/plugin-profile-key.test.ts
git commit -m "feat: use profile principal in plugin"
```

---

### Task 8: Documentation And Example Config

**Files:**

- Modify: `README.md`
- Modify: `.env.example`
- Test: `tests/docs-strict-identity.test.ts`

- [x] **Step 1: Extend docs test**

Append to `tests/docs-strict-identity.test.ts`:

```ts
it("documents profile key file schema and enforcement", () => {
  const readme = readFileSync(join(import.meta.dir, "../README.md"), "utf-8");
  const env = readFileSync(join(import.meta.dir, "../.env.example"), "utf-8");

  expect(readme).toContain('"profiles"');
  expect(readme).toContain('"profileId"');
  expect(readme).toContain('"apiKey"');
  expect(readme).toContain("Profile keys are restricted to their configured profileId");
  expect(readme).toContain("SERVER_API_KEY remains the admin/all-profiles key");
  expect(env).toContain("PROFILE_KEYS_FILE=");
  expect(env).toContain("profileId");
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
bun test tests/docs-strict-identity.test.ts
```

Expected: FAIL until README and `.env.example` contain the schema and enforcement text.

- [x] **Step 3: Update README**

Add this subsection under strict identity documentation:

````md
### Profile Key File

`SERVER_API_KEY` remains the admin/all-profiles key. `PROFILE_KEYS_FILE` points to a JSONC file of profile-scoped keys:

```jsonc
{
  "profiles": [
    {
      "profileId": "phrkr",
      "displayName": "Phrkr",
      "apiKey": "env://OPENCODE_MEMNET_PROFILE_KEY_PHRKR",
    },
  ],
}
```

Profile keys are restricted to their configured profileId. A profile-key request may omit `profileId`; the server injects it. If a profile-key request supplies another `profileId`, the server returns `403`.

Use `SERVER_API_KEY` for admin WebUI sessions that need to list or switch profiles. Use a profile key for one profile's plugin or WebUI session. Profile key `apiKey` values support plain values, `env://NAME`, and `file:///path/to/key` through the same secret indirection used by other server secrets.
````

- [x] **Step 4: Update `.env.example`**

Replace the existing `PROFILE_KEYS_FILE` comment block with:

```env
# PROFILE_KEYS_FILE
# Optional JSONC file declaring static profile API keys. SERVER_API_KEY remains
# the admin/all-profiles key. Each profile key maps to one profileId and cannot
# read or write another profile. The file supports apiKey secret indirection with
# env://NAME and file:///path/to/key.
#
# Example file:
# {
#   "profiles": [
#     {
#       "profileId": "phrkr",
#       "displayName": "Phrkr",
#       "apiKey": "env://OPENCODE_MEMNET_PROFILE_KEY_PHRKR"
#     }
#   ]
# }
#
# Default: (empty)
# Required: no
PROFILE_KEYS_FILE=
```

- [x] **Step 5: Run docs tests**

Run:

```bash
bun test tests/docs-strict-identity.test.ts
bun run format:check
```

Expected: docs tests pass and formatting check passes.

- [x] **Step 6: Commit**

```bash
git add README.md .env.example tests/docs-strict-identity.test.ts
git commit -m "docs: document profile key enforcement"
```

---

### Task 9: Full Verification

**Files:**

- Review all changed files.

- [ ] **Step 1: Run targeted profile-key tests**

Run:

```bash
bun test \
  tests/profile-auth.test.ts \
  tests/profile-keys-config.test.ts \
  tests/auth-middleware-profile-key.test.ts \
  tests/profile-key-route-enforcement.test.ts \
  tests/profile-key-api-ownership.test.ts \
  tests/profile-key-aggregate-scope.test.ts \
  tests/webui-profile-key-lock.test.ts \
  tests/plugin-profile-key.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run existing strict identity tests**

Run:

```bash
bun test \
  tests/identity-scope.test.ts \
  tests/profile-auth.test.ts \
  tests/profile-repo-scope.test.ts \
  tests/webui-strict-identity.test.ts \
  tests/docs-strict-identity.test.ts \
  tests/client-nickname.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Run plugin and build checks**

Run:

```bash
bun run build:plugin
bun run typecheck:all
bun run build
```

Expected: all commands pass.

- [ ] **Step 4: Run full isolated test suite**

Run:

```bash
bun run test
```

Expected: `bun test --isolate` passes with 0 failures.

- [ ] **Step 5: Check for stale legacy or unenforced profile paths**

Run:

```bash
rg -n "PROFILE_KEYS_FILE|configuredProfiles|profileId|userEmail=|userId=|nickname" \
  src shared plugin README.md .env.example tests
```

Expected:

- `PROFILE_KEYS_FILE` and `configuredProfiles` appear in parser/config/docs/tests.
- `profileId` appears in strict identity code and tests.
- `userEmail=`, `userId=`, and nickname endpoint strings appear only in negative tests.

- [ ] **Step 6: Check diff hygiene**

Run:

```bash
git diff --check
git status --short
git diff --stat
```

Expected:

- No whitespace errors.
- Status only includes files intentionally changed for this plan.
- Diff stat matches parser/auth/server/API/WebUI/plugin/docs/test work.

- [ ] **Step 7: Final commit if needed**

If the previous tasks left staged or unstaged verification-only changes, commit them:

```bash
git add .
git commit -m "test: verify profile key enforcement"
```

If there are no changes, do not create an empty commit.

---

## Manual Runtime Smoke Test

After automated checks pass, run one fresh-database smoke test.

1. Create a profile keys file outside the repo:

```bash
tmpdir="$(mktemp -d)"
cat > "$tmpdir/profile-keys.jsonc" <<'JSON'
{
  "profiles": [
    { "profileId": "phrkr", "apiKey": "profile-key-phrkr" },
    { "profileId": "work", "apiKey": "profile-key-work" }
  ]
}
JSON
```

2. Start the server with `PROFILE_KEYS_FILE=$tmpdir/profile-keys.jsonc` and a fresh Postgres database.

3. Verify admin can list all profiles:

```bash
curl -sS \
  -H "Authorization: Bearer $SERVER_API_KEY" \
  http://localhost:4747/api/user-profiles
```

Expected: response contains all active profiles and `"principal":{"kind":"admin"}`.

4. Verify profile key is locked:

```bash
curl -sS \
  -H "Authorization: Bearer profile-key-phrkr" \
  http://localhost:4747/api/user-profiles
```

Expected: response contains only `phrkr` and `"principal":{"kind":"profile","profileId":"phrkr"}`.

5. Verify cross-profile request is rejected:

```bash
curl -sS -i \
  -H "Authorization: Bearer profile-key-phrkr" \
  "http://localhost:4747/api/user-profile?profileId=work"
```

Expected: HTTP 403 and error text `Profile key cannot access another profile`.

6. Verify omitted profile ID is injected:

```bash
curl -sS \
  -H "Authorization: Bearer profile-key-phrkr" \
  "http://localhost:4747/api/user-profile"
```

Expected: response is for `phrkr`.

---

## Self-Review Notes

- Spec coverage: Tasks cover parser/schema, config validation, admin/profile principal auth, request-kind auth, route profile injection/rejection, ID-based record ownership, tags/stats aggregate scoping, WebUI locking, plugin effective profile selection, docs, automated verification, and runtime smoke testing.
- Placeholder scan: The plan contains concrete file paths, code snippets, commands, and expected outcomes for each implementation task.
- Type consistency: The plan consistently uses `ConfiguredProfile`, `Principal`, `configuredProfiles`, `profileId`, `apiKey`, `displayName`, `requireProfileIdForPrincipal`, and `principalResponse`.
