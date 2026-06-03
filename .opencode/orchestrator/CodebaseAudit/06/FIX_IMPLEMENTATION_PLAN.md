# CodebaseAudit/06 — Implementation Plan

## Execution Strategy

4 phases, ordered by dependency. Each phase is independently testable.

## Phase 1: Data Layer — clientId → userEmail Mapping (ISSUE-002, ISSUE-004)

**Goal**: Create the bridge between the two identity systems at the storage level.

### Tasks

1. Create new migration: `ALTER TABLE clients ADD COLUMN IF NOT EXISTS user_email TEXT;` + index
2. Update `ClientRow` interface in `types.ts` — add `userEmail?: string`
3. Update `upsertClient` in `client-repository.ts` — accept and store `userEmail`
4. Add `getClientByEmail(email)` method to `ClientRepository` interface + postgres impl
5. Add `getEmailByClientId(clientId)` method to `ClientRepository` interface + postgres impl
6. Write unit tests for new methods

**Verification**: Tests pass, migration runs cleanly, existing 248 tests still pass.

## Phase 2: Client Connect — Link Identity (ISSUE-004)

**Goal**: When a plugin connects, extract and store the user email link.

### Tasks

1. Update `handleClientConnect` in `api-handlers.ts` — extract `metadata.user` as email
2. Pass extracted email to `upsertClient` as `userEmail` parameter
3. Add logging: "Client {id} linked to user {email}"
4. Write tests: connect with metadata containing user → client has userEmail

**Verification**: After plugin connect, `SELECT user_email FROM clients WHERE id = '...'` returns the email.

## Phase 3: API Handlers — Request-Based Identity (ISSUE-001, ISSUE-003, ISSUE-005)

**Goal**: All handlers prefer request-provided userId over server git config.

### Tasks

1. Update `handleSetProfileNickname` — accept optional `userId`, use before git fallback
2. Update route handler for `PUT /api/user-profile/nickname` — extract userId from query/header, pass to handler
3. Verify `handleGetUserProfile` route — ensure userId from query param reaches handler
4. Update `handleAddMemory` — when userEmail absent, try client lookup, then git config, then warn
5. Update `handleUserProfileLearn` — same pattern
6. Write tests for each handler with explicit userId

**Verification**: Can set nickname via API with explicit userId. Nickname stored under correct user.

## Phase 4: Robustness — Fallbacks and Logging (ISSUE-006, ISSUE-007)

**Goal**: Hard errors for misconfiguration, better debugging.

### Tasks

1. Update `user-memory-learning.ts` — throw on null/empty userId instead of "unknown" fallback
2. Update web UI `app.js` — generate client UUID, send as `X-Client-ID` header
3. Add structured logging for all identity resolution paths
4. Write tests for error cases

**Verification**: Profile learning fails with clear error when no email configured. Web UI logs show X-Client-ID.

## Phase Dependencies

```
Phase 1 (storage)
  ↓
Phase 2 (connect linking) ← depends on Phase 1 schema
  ↓
Phase 3 (handler updates) ← depends on Phase 1 + 2 methods
  ↓
Phase 4 (robustness) ← depends on Phase 3 handler changes
```

## Estimated Scope

- **Files modified**: ~10
- **New migration**: 1
- **New tests**: ~15-20
- **Estimated LOC**: ~200-300 changes
- **Time**: 4 focused phases

## Success Criteria

1. Plugin connects → client record has `user_email` populated
2. Web UI sets nickname → stored under correct userId (from query param)
3. Plugin sets nickname → stored under correct userId (from client mapping or request)
4. Memory added → always has `user_email` populated (never NULL without warning)
5. All 248+ existing tests pass
6. New tests cover all identity resolution paths
