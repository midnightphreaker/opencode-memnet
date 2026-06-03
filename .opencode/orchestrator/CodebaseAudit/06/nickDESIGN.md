# Nickname Unification Design

**Date**: 2026-06-04
**Approach**: Shared Identity Table (Option C)
**Related**: nickSPEC.md

## Architecture Overview

Introduce a `user_identities` table as the canonical identity store. All nickname reads and writes flow through this table. The existing `clients.nickname` and `user_profiles.nickname` columns become denormalized caches synced from the identity on every write.

```
┌──────────────────┐     ┌──────────────────┐
│  clients         │     │  user_profiles   │
│  nickname (cache)│     │  nickname (cache)│
│  user_email ─────┼─────┼── user_id        │
└──────────────────┘     └──────────────────┘
            │                    │
            │    email (shared key)
            └────────┬───────────┘
                     │
           ┌─────────▼─────────┐
           │  user_identities  │
           │  nickname (truth) │
           │  email (unique)   │
           │  display_name     │
           └───────────────────┘
```

## Data Model

### New Table: `user_identities`

| Column         | Type        | Purpose                                                         |
| -------------- | ----------- | --------------------------------------------------------------- |
| `id`           | TEXT PK     | UUID — internal identity identifier                             |
| `email`        | TEXT UNIQUE | Canonical user identifier (from git config, plugin metadata)    |
| `nickname`     | TEXT        | The ONE canonical nickname for this user                        |
| `display_name` | TEXT        | Computed or set display name (nickname → email prefix fallback) |
| `created_at`   | TIMESTAMPTZ | Row creation time                                               |
| `updated_at`   | TIMESTAMPTZ | Last modification time                                          |

Indexes: `idx_user_identities_email` (unique), `idx_user_identities_nickname` (partial, where not null).

### New Interface: `UserIdentityRepository`

```typescript
interface UserIdentityRow {
  id: string;
  email: string;
  nickname: string | null;
  displayName: string | null;
  createdAt: number;
  updatedAt: number;
}

interface UserIdentityRepository {
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

## Write Paths

### WP-1: Web UI → PUT /api/user-profile/nickname

1. `identityRepo.upsertIdentity(userId, { nickname })` — canonical write
2. `profileRepo.setNickname(userId, nickname)` — cache sync
3. `clientRepo.getClientsByEmail(userId)` → `setNickname` for each — cache sync

### WP-2: Plugin Config → handleClientConnect

1. `clientRepo.upsertClient(clientId, metadata, email)` — existing
2. If config has nickname: `identityRepo.upsertIdentity(email, { nickname: configNickname })`
3. Return `identity.nickname || clientRow.nickname || shortId`

### WP-3: Client API → PUT /api/client/nickname

1. `clientRepo.setNickname(clientId, nickname)` — existing
2. `email = clientRepo.getEmailByClientId(clientId)`
3. If email: `identityRepo.upsertIdentity(email, { nickname })` — canonical write
4. If email: `profileRepo.setNickname(email, nickname)` — cache sync

## Read Paths

### RP-1: handleClientConnect response

1. `email = client.userEmail`
2. If email: `identity.getNickname(email)`
3. Return `identity.nickname || client.nickname || shortId`

### RP-2: handleGetUserProfile response

1. Resolve userId from request or git config
2. `identity.getNickname(userId)`
3. Return `identity.nickname || profile.nickname || null`

### RP-3: handleGetClientStats response

1. `email = client.userEmail`
2. If email: `identity.getNickname(email)`
3. Return `identity.nickname || client.nickname || null`

## Sync Strategy

On every nickname write to `user_identities`, synchronously update cache columns:

- `profileRepo.setNickname(email, nickname)` — best-effort, logged on failure
- `clientRepo.getClientsByEmail(email)` → `setNickname` for each — best-effort

Cache sync failures are logged but do NOT fail the canonical write.

## Migration: Migration 16

Creates `user_identities` table, seeds from existing `user_profiles` and `clients` (using `ON CONFLICT DO UPDATE` to merge). Existing nicknames are preserved and merged into the identity table.

## File Changes

| File                                                   | Change                                       |
| ------------------------------------------------------ | -------------------------------------------- |
| `src/services/storage/postgres/migrations.ts`          | Migration 16                                 |
| `src/services/storage/types.ts`                        | `UserIdentityRow` + `UserIdentityRepository` |
| `src/services/storage/postgres/identity-repository.ts` | New — postgres impl                          |
| `src/services/storage/factory.ts`                      | Identity repo lazy proxy                     |
| `src/services/api-handlers.ts`                         | 5 handlers updated for identity-first        |
| `tests/storage/identity-repository.test.ts`            | New — identity repo tests                    |
