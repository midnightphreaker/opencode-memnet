# Nickname Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unify the two disconnected nickname systems into a single canonical identity store.

**Architecture:** Introduce `user_identities` table as source of truth, with `clients.nickname` and `user_profiles.nickname` as denormalized caches. All nickname reads/writes flow through the identity repository.

**Tech Stack:** TypeScript, PostgreSQL (postgres.js), Bun test runner

---

## File Structure

| Action | File                                                   | Responsibility                                          |
| ------ | ------------------------------------------------------ | ------------------------------------------------------- |
| Create | `src/services/storage/postgres/identity-repository.ts` | Postgres implementation of UserIdentityRepository       |
| Create | `tests/storage/identity-repository.test.ts`            | Tests for identity repository                           |
| Modify | `src/services/storage/postgres/migrations.ts`          | Migration 16: user_identities table + seeding           |
| Modify | `src/services/storage/types.ts`                        | Add UserIdentityRow + UserIdentityRepository interfaces |
| Modify | `src/services/storage/factory.ts`                      | Add identity repo factory + lazy proxy                  |
| Modify | `src/services/api-handlers.ts`                         | Update 5 handlers to use identity repo                  |

---

### Task 1: Identity Types and Interface

**Files:**

- Modify: `src/services/storage/types.ts`

- [ ] **Step 1: Add UserIdentityRow and UserIdentityRepository interfaces**

Add after the `ClientRepository` interface (end of file, before closing):

```typescript
// ── User identity types ──

export interface UserIdentityRow {
  id: string;
  email: string;
  nickname: string | null;
  displayName: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface UserIdentityRepository {
  initialize(): Promise<void>;
  close(): Promise<void>;
  getByEmail(email: string): Promise<UserIdentityRow | null>;
  getById(id: string): Promise<UserIdentityRow | null>;
  upsertIdentity(
    email: string,
    data: { nickname?: string; displayName?: string }
  ): Promise<UserIdentityRow>;
  setNickname(email: string, nickname: string): Promise<boolean>;
  getNickname(email: string): Promise<string | null>;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/services/storage/types.ts
git commit -m "feat: add UserIdentityRepository interface and types"
```

---

### Task 2: Migration 16

**Files:**

- Modify: `src/services/storage/postgres/migrations.ts`

- [ ] **Step 1: Add migration 16**

Add after the last migration in the array (after migration 15):

```typescript
  // ── 16: User identities table ──
  {
    version: 16,
    description: "Create user_identities table for canonical nickname storage",
    transactional: true,
    up: async (sql: SqlClient) => {
      await sql`
        CREATE TABLE IF NOT EXISTS user_identities (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          nickname TEXT,
          display_name TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_user_identities_email
        ON user_identities (email)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_user_identities_nickname
        ON user_identities (nickname) WHERE nickname IS NOT NULL
      `;

      // Seed from existing user_profiles
      await sql`
        INSERT INTO user_identities (id, email, nickname, display_name)
        SELECT
          'uid_' || encode(sha256(user_email::bytea), 'hex') || '_prof',
          user_email,
          nickname,
          display_name
        FROM user_profiles
        WHERE is_active = true
        ON CONFLICT (email) DO UPDATE SET
          nickname = COALESCE(user_identities.nickname, EXCLUDED.nickname),
          display_name = COALESCE(user_identities.display_name, EXCLUDED.display_name)
      `;

      // Seed from clients with user_email
      await sql`
        INSERT INTO user_identities (id, email, nickname, display_name)
        SELECT
          'uid_' || encode(sha256(user_email::bytea), 'hex') || '_cli',
          user_email,
          nickname,
          NULL
        FROM clients
        WHERE user_email IS NOT NULL
        ON CONFLICT (email) DO UPDATE SET
          nickname = COALESCE(user_identities.nickname, EXCLUDED.nickname)
      `;
    },
  },
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/services/storage/postgres/migrations.ts
git commit -m "feat: add migration 16 — user_identities table with seeding"
```

---

### Task 3: Identity Repository Implementation

**Files:**

- Create: `src/services/storage/postgres/identity-repository.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/storage/identity-repository.test.ts`:

```typescript
import { describe, test, expect, beforeAll, afterAll, mock } from "bun:test";
import type { UserIdentityRepository } from "../../src/services/storage/types.js";

// Will be set up after implementation
let repo: UserIdentityRepository;

describe("UserIdentityRepository", () => {
  beforeAll(async () => {
    // Mock postgres client for unit tests
    const { PostgresUserIdentityRepository } =
      await import("../../src/services/storage/postgres/identity-repository.js");
    repo = new PostgresUserIdentityRepository();
  });

  test("upsertIdentity creates new identity", async () => {
    const row = await repo.upsertIdentity("test@example.com", { nickname: "flerbnurb" });
    expect(row.email).toBe("test@example.com");
    expect(row.nickname).toBe("flerbnurb");
    expect(row.id).toBeTruthy();
  });

  test("upsertIdentity updates existing identity", async () => {
    await repo.upsertIdentity("test2@example.com", { nickname: "old" });
    const updated = await repo.upsertIdentity("test2@example.com", { nickname: "new" });
    expect(updated.nickname).toBe("new");
  });

  test("getByEmail returns identity", async () => {
    await repo.upsertIdentity("test3@example.com", { nickname: "finder" });
    const row = await repo.getByEmail("test3@example.com");
    expect(row).not.toBeNull();
    expect(row!.nickname).toBe("finder");
  });

  test("getByEmail returns null for unknown email", async () => {
    const row = await repo.getByEmail("nonexistent@example.com");
    expect(row).toBeNull();
  });

  test("setNickname updates nickname", async () => {
    await repo.upsertIdentity("test4@example.com", { nickname: "before" });
    const result = await repo.setNickname("test4@example.com", "after");
    expect(result).toBe(true);
    const row = await repo.getByEmail("test4@example.com");
    expect(row!.nickname).toBe("after");
  });

  test("setNickname returns false for unknown email", async () => {
    const result = await repo.setNickname("unknown@example.com", "test");
    expect(result).toBe(false);
  });

  test("getNickname returns nickname", async () => {
    await repo.upsertIdentity("test5@example.com", { nickname: "direct" });
    const nick = await repo.getNickname("test5@example.com");
    expect(nick).toBe("direct");
  });

  test("getNickname returns null for no identity", async () => {
    const nick = await repo.getNickname("missing@example.com");
    expect(nick).toBeNull();
  });

  test("getNickname returns null for identity with no nickname", async () => {
    await repo.upsertIdentity("test6@example.com", {});
    const nick = await repo.getNickname("test6@example.com");
    expect(nick).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --isolate tests/storage/identity-repository.test.ts`
Expected: FAIL (module not found or methods undefined)

- [ ] **Step 3: Write the implementation**

Create `src/services/storage/postgres/identity-repository.ts`:

```typescript
import type { SqlClient } from "./client.js";
import { getPostgresClient } from "./client.js";
import type { UserIdentityRepository, UserIdentityRow } from "../types.js";
import { randomUUID } from "node:crypto";
import { logDebug } from "../../logger.js";

export class PostgresUserIdentityRepository implements UserIdentityRepository {
  private sql(): SqlClient {
    return getPostgresClient();
  }

  async initialize(): Promise<void> {
    logDebug("[identity-repository] initialized");
  }

  async close(): Promise<void> {
    // Connection pool is shared
  }

  private mapRow(row: any): UserIdentityRow {
    return {
      id: row.id,
      email: row.email,
      nickname: row.nickname ?? null,
      displayName: row.display_name ?? null,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
    };
  }

  async getByEmail(email: string): Promise<UserIdentityRow | null> {
    const sql = this.sql();
    const rows = await sql`SELECT * FROM user_identities WHERE email = ${email}`;
    return rows.length > 0 ? this.mapRow(rows[0]) : null;
  }

  async getById(id: string): Promise<UserIdentityRow | null> {
    const sql = this.sql();
    const rows = await sql`SELECT * FROM user_identities WHERE id = ${id}`;
    return rows.length > 0 ? this.mapRow(rows[0]) : null;
  }

  async upsertIdentity(
    email: string,
    data: { nickname?: string; displayName?: string }
  ): Promise<UserIdentityRow> {
    const sql = this.sql();
    const id = `uid_${randomUUID().replace(/-/g, "")}`;

    const rows = await sql`
      INSERT INTO user_identities (id, email, nickname, display_name, created_at, updated_at)
      VALUES (${id}, ${email}, ${data.nickname ?? null}, ${data.displayName ?? null}, now(), now())
      ON CONFLICT (email) DO UPDATE SET
        nickname = COALESCE(${data.nickname ?? null}, user_identities.nickname),
        display_name = COALESCE(${data.displayName ?? null}, user_identities.display_name),
        updated_at = now()
      RETURNING *
    `;
    return this.mapRow(rows[0]);
  }

  async setNickname(email: string, nickname: string): Promise<boolean> {
    const sql = this.sql();
    const result = await sql`
      UPDATE user_identities SET nickname = ${nickname}, updated_at = now()
      WHERE email = ${email}
    `;
    return (result.count ?? 0) > 0;
  }

  async getNickname(email: string): Promise<string | null> {
    const sql = this.sql();
    const rows = await sql`SELECT nickname FROM user_identities WHERE email = ${email}`;
    if (rows.length === 0) return null;
    return rows[0].nickname ?? null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test --isolate tests/storage/identity-repository.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/storage/postgres/identity-repository.ts tests/storage/identity-repository.test.ts
git commit -m "feat: add UserIdentityRepository with tests"
```

---

### Task 4: Factory Integration

**Files:**

- Modify: `src/services/storage/factory.ts`

- [ ] **Step 1: Add identity repo factory and lazy proxy**

Add import for `PostgresUserIdentityRepository` and create a lazy proxy following the existing pattern (same as `PostgresClientRepositoryLazy`):

```typescript
import { PostgresUserIdentityRepository } from "./postgres/identity-repository.js";

export function createUserIdentityRepository(): UserIdentityRepository {
  return new PostgresUserIdentityRepositoryLazy();
}

class PostgresUserIdentityRepositoryLazy implements UserIdentityRepository {
  private repo?: UserIdentityRepository;
  private getRepo(): UserIdentityRepository {
    if (!this.repo) this.repo = new PostgresUserIdentityRepository();
    return this.repo;
  }
  async initialize() {
    return this.getRepo().initialize();
  }
  async close() {
    return this.getRepo().close();
  }
  async getByEmail(email: string) {
    return this.getRepo().getByEmail(email);
  }
  async getById(id: string) {
    return this.getRepo().getById(id);
  }
  async upsertIdentity(email: string, data: { nickname?: string; displayName?: string }) {
    return this.getRepo().upsertIdentity(email, data);
  }
  async setNickname(email: string, nickname: string) {
    return this.getRepo().setNickname(email, nickname);
  }
  async getNickname(email: string) {
    return this.getRepo().getNickname(email);
  }
}
```

Also add `identityRepo` to `initializeStorage()` and `closeStorage()` if they exist.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/services/storage/factory.ts
git commit -m "feat: add identity repo factory and lazy proxy"
```

---

### Task 5: Handler Integration — Identity-First Reads and Writes

**Files:**

- Modify: `src/services/api-handlers.ts`

- [ ] **Step 1: Add identity repo to ensureInit**

Add `identityRepo` alongside the existing `clientRepo` and `profileRepo` declarations and initialization.

- [ ] **Step 2: Update handleSetProfileNickname**

Replace the current implementation with identity-first write + cache sync:

```typescript
export async function handleSetProfileNickname(data: {
  nickname: string;
  userId?: string;
}): Promise<ApiResponse<{ nickname: string }>> {
  try {
    // ... validation ...
    await ensureInit();
    let userId = data.userId;
    if (!userId) {
      const { getTags } = await import("./tags.js");
      const tags = await getTags(process.cwd());
      userId = tags.user.userEmail || "unknown";
    }
    // Write to canonical store
    try {
      await identityRepo!.upsertIdentity(userId, { nickname: trimmed });
    } catch (err) {
      logDebug("Failed to write nickname to identity store", { error: String(err) });
    }
    // Sync to profile cache
    const result = await profileRepo!.setNickname(userId, trimmed);
    if (!result) {
      return { success: false, error: "No active profile found — create a profile first" };
    }
    logInfo("Nickname updated", { userId, nickname: trimmed });
    return { success: true, data: { nickname: trimmed } };
  } catch (error) {
    logError("handleSetProfileNickname: error", { error: String(error) });
    return { success: false, error: "Internal server error" };
  }
}
```

- [ ] **Step 3: Update handleClientConnect**

After the existing upsert, add identity lookup for nickname resolution:

```typescript
// After existing client connect logic...
// Resolve canonical nickname from identity store
let resolvedNickname = result.row.nickname;
if (userEmail) {
  try {
    const identityNick = await identityRepo!.getNickname(userEmail);
    if (identityNick) resolvedNickname = identityNick;
  } catch {
    /* fallback to client nickname */
  }
}
```

Use `resolvedNickname` in the response instead of `result.row.nickname`.

- [ ] **Step 4: Update handleSetClientNickname**

After updating client nickname, sync to identity if email linked:

```typescript
// After clientRepo.setNickname...
const email = await clientRepo!.getEmailByClientId(data.clientId);
if (email) {
  try {
    await identityRepo!.setNickname(email, data.nickname);
  } catch {
    /* log */
  }
  try {
    await profileRepo!.setNickname(email, data.nickname);
  } catch {
    /* log */
  }
}
```

- [ ] **Step 5: Update handleGetUserProfile**

Prefer identity nickname:

```typescript
// After profile lookup...
let nickname = profile.nickname ?? null;
try {
  const identityNick = await identityRepo!.getNickname(targetUserId);
  if (identityNick) nickname = identityNick;
} catch {
  /* use profile nickname as fallback */
}
```

- [ ] **Step 6: Update handleGetClientStats**

Prefer identity nickname when email is available:

```typescript
let nickname = stats.client?.nickname ?? null;
if (stats.client?.userEmail) {
  try {
    const identityNick = await identityRepo!.getNickname(stats.client.userEmail);
    if (identityNick) nickname = identityNick;
  } catch {
    /* use client nickname */
  }
}
```

- [ ] **Step 7: Run full test suite**

Run: `bun test --isolate`
Expected: 260+ tests pass, 0 fail

- [ ] **Step 8: Commit**

```bash
git add src/services/api-handlers.ts
git commit -m "feat: integrate identity repo into nickname handlers"
```

---

### Task 6: E2E Verification

- [ ] **Step 1: TypeScript typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 2: Full test suite**

Run: `bun test --isolate`
Expected: 260+ tests pass

- [ ] **Step 3: Format check**

Run: `npx prettier --check "src/**/*.ts" "plugin/src/**/*.ts"`
Expected: Clean (fix if needed)

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: Clean

- [ ] **Step 5: Docker build**

Run: `docker build -t opencode-memnet:audit06b .`
Expected: Success

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: complete nickname unification with shared identity table"
```
