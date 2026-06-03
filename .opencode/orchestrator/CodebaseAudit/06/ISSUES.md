# CodebaseAudit/06 — User Identity Linking Issues

**Date**: 2026-06-04
**Scope**: User UUID ↔ Memories ↔ Nicknames linking
**Trigger**: User reports "server is not linking users UUID, memories and nicknames"
**Evidence**: `opencode-memnet-logs.md` — 213 lines of nickname test interactions

## Root Cause Summary

The system has **two disconnected identity models**:

1. **Client identity** (UUID-based): `clients` table stores `id`, `nickname`, `client_metadata` JSONB — tracks devices/sessions
2. **User identity** (email-based): `user_profiles` table keyed by `user_id` (email); `memories` table keyed by `user_email`

**These are never linked.** No foreign key, no mapping table, no code path connects a clientId to a userEmail.

Additionally, several API handlers derive userId from the **server's own git config** rather than from the request context, causing all users to share one identity on the server side.

## Issues

### ISSUE-001 (Critical): `handleSetProfileNickname` uses server git email, ignoring request context

- **File**: `src/services/api-handlers.ts:919-921`
- **Code**:
  ```typescript
  const tags = await getTags(process.cwd());
  const userId = tags.user.userEmail || "unknown";
  ```
- **Impact**: When ANY client (web UI or plugin) calls `PUT /api/user-profile/nickname`, the nickname is saved under the server's git email, NOT the requesting user's email. In multi-user scenarios, all nicknames go to one profile.
- **Evidence from logs**: Line 3 shows `PUT /api/user-profile/nickname` with `client:"unknown"` — no user identity in the request. Line 180 shows another PUT with same `client:"unknown"`.
- **Fix**: Accept `userId` from request body or query param. Only fallback to `getTags()` when absent.

### ISSUE-002 (Critical): No `clientId → userEmail` mapping exists

- **Files**: `src/services/storage/postgres/client-repository.ts`, `src/services/storage/postgres/profile-repository.ts`
- **Detail**: The `clients` table has no `user_email` column. `handleClientConnect` receives `metadata` (which may contain email from plugin) but stores it as opaque JSONB without extracting or linking it. The `user_profiles` table has no `client_id` column.
- **Impact**: There is no way to look up "what user does client X belong to?" or "what clients belong to user Y?"
- **Fix**: Add `user_email` column to `clients` table. Extract email from metadata during `handleClientConnect`. Create a bidirectional lookup method.

### ISSUE-003 (High): `handleGetUserProfile` falls back to server git email when no userId param

- **File**: `src/services/api-handlers.ts:871`
- **Code**:
  ```typescript
  if (!targetUserId) {
    const tags = await getTags(process.cwd());
    targetUserId = tags.user.userEmail || "unknown";
  }
  ```
- **Impact**: Web UI requests without explicit `userId` query param get the server's profile, not their own. The web UI does pass `userEmail` as a query param via profile selector, but the route handler may not always receive it.
- **Fix**: Extract `userId` from request context (query param, session, or client mapping). Fallback to git config only as last resort.

### ISSUE-004 (High): `handleClientConnect` stores metadata but never extracts user email

- **File**: `src/services/api-handlers.ts:1928`
- **Code**: `await clientRepo!.upsertClient(data.clientId, metadata);`
- **Detail**: The plugin sends `metadata` containing `{ user: "gitbot@phrk.org", ... }` but this is stored as opaque JSONB. The email is never extracted and linked to the user_profiles system.
- **Impact**: Client connects with known user identity, but that identity is lost in JSONB and never connected to profiles or memories.
- **Fix**: Parse metadata to extract `user` field. Store as `user_email` column in clients table. Use for cross-referencing.

### ISSUE-005 (Medium): Memories can be stored with NULL `user_email`

- **File**: `src/services/api-handlers.ts:339-427`
- **Detail**: `handleAddMemory` accepts `userEmail` as optional. If caller doesn't pass it, memory has `user_email: NULL`.
- **Impact**: Orphaned memories not associated with any user. These memories exist in the system but can't be filtered by user.
- **Fix**: Either make `userEmail` required in the handler (with validation), or derive it from client context when absent.

### ISSUE-006 (Medium): Profile learning service uses `"unknown"` fallback for userId

- **File**: `src/services/user-memory-learning.ts:38-39`
- **Code**: `const userId = tags.user.userEmail || "unknown";`
- **Impact**: If git email is not configured, all learned profiles go to user_id `"unknown"`, mixing data from different users.
- **Fix**: Make this a hard error or require explicit userId configuration rather than silently defaulting to "unknown".

### ISSUE-007 (Low): Web UI doesn't send `X-Client-ID` header

- **File**: `src/web/app.js`
- **Detail**: The plugin (`remote-client.ts:57`) always sends `X-Client-ID`, but the web UI never does. This only affects debug logging (`client:"unknown"` in logs) but makes debugging harder.
- **Impact**: Debug logs can't distinguish web UI requests from different users.
- **Fix**: Add `X-Client-ID` header to web UI API calls (can be a generated UUID stored in localStorage).

## Issue Summary

| ID  | Severity | File                                        | Description                                                      |
| --- | -------- | ------------------------------------------- | ---------------------------------------------------------------- |
| 001 | Critical | api-handlers.ts:919                         | Nickname saved under server git email, not request user          |
| 002 | Critical | client-repository.ts, profile-repository.ts | No clientId→userEmail mapping; two disconnected identity systems |
| 003 | High     | api-handlers.ts:871                         | Profile lookup falls back to server git email                    |
| 004 | High     | api-handlers.ts:1928                        | Client metadata email lost in JSONB, never linked                |
| 005 | Medium   | api-handlers.ts:346                         | Memories can have NULL user_email                                |
| 006 | Medium   | user-memory-learning.ts:38                  | "unknown" fallback mixes user data                               |
| 007 | Low      | web/app.js                                  | Web UI doesn't send X-Client-ID                                  |
