# CodebaseAudit/06 — Fix Specification

## Overview

Unify the two disconnected identity systems (clientId and userEmail) by:

1. Adding a `user_email` column to the `clients` table
2. Extracting user email from client metadata during connect
3. Updating all API handlers to prefer request-provided userId over server git config
4. Ensuring memories always have a user_email

## Fixes by Issue

### ISSUE-001: handleSetProfileNickname — accept userId from request

**Files to modify**: `src/services/api-handlers.ts`, `src/services/web-server.ts` (or web-server-worker.ts)

**Changes**:

1. Add `userId?: string` to `handleSetProfileNickname`'s data parameter
2. In the handler, use `data.userId` when provided, fallback to `getTags()` only when absent
3. In the route handler (web-server), extract `userId` from query param or `X-User-Email` header and pass it through

**Before**:

```typescript
const tags = await getTags(process.cwd());
const userId = tags.user.userEmail || "unknown";
```

**After**:

```typescript
let userId = data.userId;
if (!userId) {
  const tags = await getTags(process.cwd());
  userId = tags.user.userEmail || "unknown";
}
```

### ISSUE-002: Add clientId → userEmail mapping

**Files to modify**: `src/services/storage/postgres/migrations.ts`, `src/services/storage/postgres/client-repository.ts`, `src/services/storage/types.ts`

**Changes**:

1. Add migration: `ALTER TABLE clients ADD COLUMN IF NOT EXISTS user_email TEXT;`
2. Add `userEmail?: string` to `ClientRow` interface
3. Update `upsertClient` to accept and store `userEmail`
4. Add method `getClientByEmail(email: string): Promise<ClientRow | null>`
5. Add method `getEmailByClientId(clientId: string): Promise<string | null>`

### ISSUE-003: handleGetUserProfile — prefer request userId

**Files to modify**: `src/services/api-handlers.ts`

**Changes**:

1. Already accepts optional `userId` — ensure the route handler passes it from request context
2. Verify web UI profile selector flow: `state.activeProfileId` → `userEmail` query param → handler

### ISSUE-004: Extract email from client metadata during connect

**Files to modify**: `src/services/api-handlers.ts`, `src/services/storage/types.ts`

**Changes**:

1. In `handleClientConnect`, extract `metadata.user` (the email field sent by plugin)
2. Pass it to `upsertClient` as the new `userEmail` field
3. This creates the link: clientId → userEmail on every connect

### ISSUE-005: Require user_email for memories

**Files to modify**: `src/services/api-handlers.ts`

**Changes**:

1. In `handleAddMemory`, if `data.userEmail` is not provided, attempt to derive it:
   - Check if the request has a clientId → look up userEmail from clients table
   - Fallback to `getTags()` email
   - If still null, log a warning (don't reject — memories are valuable)
2. Never store a memory with NULL user_email silently

### ISSUE-006: Profile learning — hard error on unknown userId

**Files to modify**: `src/services/user-memory-learning.ts`

**Changes**:

1. If `tags.user.userEmail` is empty/null, throw an explicit error with guidance
2. Log a clear message: "Cannot perform profile learning: no user email configured. Set git user.email or provide userEmailOverride."

### ISSUE-007: Web UI X-Client-ID header

**Files to modify**: `src/web/app.js`

**Changes**:

1. Generate a UUID on first load, store in localStorage as `opencode-memnet-client-id`
2. Include `X-Client-ID` header in all API requests from web UI

## Migration Required

New migration file needed:

```sql
-- Migration N: Add user_email to clients table
ALTER TABLE clients ADD COLUMN IF NOT EXISTS user_email TEXT;
CREATE INDEX IF NOT EXISTS idx_clients_user_email ON clients(user_email);
```

## Testing Requirements

1. Unit tests for `handleSetProfileNickname` with explicit userId
2. Unit tests for `upsertClient` with userEmail
3. Unit tests for `getClientByEmail` and `getEmailByClientId`
4. Integration test: plugin connect → client has userEmail → memory stored with correct email
5. Integration test: web UI nickname set → stored under correct userId
6. Verify existing 248 tests still pass

## Risk Assessment

- **Low risk**: Adding nullable column to clients table (backward compatible)
- **Medium risk**: Changing userId resolution in handlers (could affect single-user setups that rely on git config fallback)
- **Mitigation**: Always fallback to git config when request doesn't provide userId — single-user setups unaffected
