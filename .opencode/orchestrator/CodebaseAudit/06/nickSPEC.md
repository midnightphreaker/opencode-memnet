# Nickname Unification Specification

**Date**: 2026-06-04
**Status**: Draft
**Related**: CodebaseAudit/06 (ISSUE-001 through ISSUE-007)

## Problem Statement

The server has two independent nickname storage systems:

1. **Profile nickname** (`user_profiles.nickname`) — keyed by user email, set via web UI settings panel
2. **Client nickname** (`clients.nickname`) — keyed by client UUID, set via plugin config on connect

These systems are disconnected. Setting a nickname in one has no effect on the other. There is no single source of truth for "what is this user's nickname?"

### Current Data Flow (Broken)

```
Web UI settings → user_profiles.nickname ← NOT read by plugin
Plugin config   → clients.nickname       ← NOT read by web UI
Conversation    → stored as memory text   ← NOT structured
```

## Requirements

### Functional Requirements

**FR-1: Single source of truth**

- There shall be exactly ONE canonical nickname per user
- All nickname reads shall return the same value regardless of entry point (plugin, web UI, API)
- The canonical nickname is keyed by user email

**FR-2: Unified write path**

- Setting a nickname from any entry point (web UI, plugin, API) shall update the same canonical store
- `PUT /api/user-profile/nickname` shall update the canonical store
- `PUT /api/client/nickname` shall update the canonical store (when client is linked to a user)
- Plugin config nickname shall update the canonical store on connect

**FR-3: Unified read path**

- `handleClientConnect` response shall return the canonical nickname
- `handleGetUserProfile` response shall return the canonical nickname
- `handleGetClientStats` response shall return the canonical nickname
- Server logs shall use the canonical nickname

**FR-4: Backward compatibility**

- All existing API endpoints shall continue to work unchanged
- The `clients.nickname` and `user_profiles.nickname` columns shall remain as denormalized caches
- Old clients/plugins that don't support the identity system shall still function
- Existing 248+ tests shall continue to pass

**FR-5: Auto-provisioning**

- A user identity shall be created automatically when a client connects with a known email
- A user identity shall be created automatically when a profile is created
- A user identity shall be created automatically when a nickname is set

### Non-Functional Requirements

**NFR-1: Performance**

- Nickname lookup on connect shall add no more than one additional DB query
- Nickname write shall complete within the existing request timeout

**NFR-2: Consistency**

- Cache columns (clients.nickname, user_profiles.nickname) shall be updated synchronously with the canonical store
- If cache update fails, the canonical value is still correct (cache is best-effort)

**NFR-3: Extensibility**

- The identity table shall support future fields (avatar, preferences, etc.) without schema redesign
- The identity repository interface shall support future query patterns

## Success Criteria

1. Setting nickname via web UI → plugin shows it on next connect
2. Setting nickname via plugin config → web UI shows it in settings panel
3. Setting nickname via `PUT /api/client/nickname` → reflected in `GET /api/user-profile`
4. Setting nickname via `PUT /api/user-profile/nickname` → reflected in `GET /api/client/stats`
5. All 248+ existing tests pass
6. New tests cover all identity resolution paths

## Out of Scope

- Conversation-based nickname learning (extracting "my name is X" from chat)
- User avatars or additional identity fields
- Authentication/authorization changes
- Multi-tenancy or organization-level nicknames
