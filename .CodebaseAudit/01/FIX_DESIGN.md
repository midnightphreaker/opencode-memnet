# Codebase Audit Fix Design

## Source artifacts

- ISSUES.md: .CodebaseAudit/01/ISSUES.md
- FIX_SPEC.md: .CodebaseAudit/01/FIX_SPEC.md

## Design overview

The nickname backend is complete. The fix focuses on three user-facing surfaces:

1. **Plugin config integration** — Read `nickname` from opencode-memnet.jsonc, call `setClientNickname()` on init
2. **Web UI nickname management** — Add nickname display and edit to the Memory Explorer SPA
3. **Test suite** — Cover repository, handler, and plugin flow
4. **Documentation** — Add README section

No database changes, no API contract changes, no new endpoints.

## Affected components

| Component             | Change Type               | Files                                              |
| --------------------- | ------------------------- | -------------------------------------------------- |
| Plugin entry          | Wire nickname config      | `plugin/src/index-remote.ts`                       |
| Plugin config reading | Read nickname from config | `shared/config.ts` or `plugin/src/index-remote.ts` |
| Web UI HTML           | Add nickname section      | `src/web/index.html`                               |
| Web UI JS             | Add nickname CRUD logic   | `src/web/app.js`                                   |
| Web UI CSS            | Style nickname section    | `src/web/styles.css`                               |
| Web UI i18n           | Add nickname translations | `src/web/i18n.js`                                  |
| Tests                 | New test file             | `tests/client-nickname.test.ts`                    |
| Documentation         | Update README             | `README.md`                                        |

## Proposed corrections

### DES-001: Plugin config-based nickname

**Approach**: Read `nickname` from the existing config system and call `setClientNickname()` during plugin initialization.

**Implementation**:

1. In `plugin/src/index-remote.ts`, after `clientConnect()` succeeds, check if a `nickname` field exists in the config
2. If it exists and differs from the server's current nickname, call `client.setClientNickname(clientId, nickname)`
3. The config is already read at plugin init time via `loadConfig()` — just need to pass the nickname field through

**Config schema addition** (in `shared/config.ts` or wherever config is parsed):

```typescript
nickname?: string  // optional display name for this client
```

**Flow**:

```
Plugin init → loadConfig() → clientConnect() → if (config.nickname && config.nickname !== connectionInfo.nickname) → setClientNickname()
```

**Key file**: `plugin/src/index-remote.ts` around line 40-85 (the init block)

### DES-002: Web UI nickname management

**Approach**: Add a small nickname section to the Memory Explorer settings/profile area.

**Implementation**:

1. In `src/web/index.html`: Add a nickname input field in the settings/sidebar area
2. In `src/web/app.js`: Add functions to load current nickname (via `GET /api/client/stats` which returns nickname) and save nickname (via `PUT /api/client/nickname`)
3. In `src/web/styles.css`: Style the nickname input to match existing UI
4. In `src/web/i18n.js`: Add translation keys for "Nickname", "Set Nickname", "Nickname updated"

**API calls used** (existing, no changes):

- `GET /api/client/stats?clientId=...` → returns `{ nickname: string | null, ... }`
- `PUT /api/client/nickname` → `{ clientId, nickname }` → `{ nickname: string }`

### DES-003: Test suite for nickname system

**Approach**: Create a new test file covering the three layers.

**Test structure**:

```
describe("Client Nickname System")
  describe("PostgresClientRepository.setNickname()")
    - it("should set nickname for existing client")
    - it("should return null for non-existent client")
  describe("handleSetClientNickname()")
    - it("should validate required fields")
    - it("should set nickname successfully")
    - it("should return error for missing client")
  describe("Plugin nickname flow")
    - it("should call setClientNickname when config has nickname")
```

**File**: `tests/client-nickname.test.ts`

### DES-004: Documentation update

**Approach**: Add a "Client Nickname" section to README.md.

**Content**:

- What nicknames are (display names for client instances)
- How to set via config: add `"nickname": "my-name"` to opencode-memnet.jsonc
- How to set via Web UI: Memory Explorer → settings → nickname field
- How it appears in toast messages

## Issue / requirement / design mapping

| Issue     | Requirements              | Design items     |
| --------- | ------------------------- | ---------------- |
| ISSUE-001 | REQ-001, REQ-002, REQ-003 | DES-001, DES-002 |
| ISSUE-002 | REQ-004                   | DES-003          |
| ISSUE-003 | REQ-005                   | DES-004          |

## Test design

- **Unit tests**: Repository `setNickname()`, API handler `handleSetClientNickname()`
- **Integration tests**: Full PUT /api/client/nickname flow (if feasible with existing test harness)
- **Config test**: Verify config parsing includes optional `nickname` field

Test runner: `bun test`
New test file: `tests/client-nickname.test.ts`
Existing test pattern: Uses `bun:test` with `describe/it/expect` and mock.module for DB mocking

## Data/config/schema impact

- **Database**: None — `nickname TEXT` column and `idx_clients_nickname` index already exist in migration
- **Config schema**: Add optional `nickname?: string` field to config type
- **API contract**: No changes — existing PUT /api/client/nickname is used as-is

## Security impact

- The PUT /api/client/nickname endpoint already validates `clientId` and `nickname` are required
- No new endpoints or auth changes
- Nickname is stored as plain text — acceptable for display names
- No risk of injection via nickname (parameterized queries in postgres driver)

## Compatibility impact

- **Backward compatible**: Adding optional config field does not break existing configs
- **No API changes**: Existing endpoints used as-is
- **Web UI additive**: New section, no existing UI modified

## Migration/rollback notes

- No database migration needed
- Rollback: Remove config field, remove Web UI section, remove tests
- Config field is optional — removing it just means nicknames won't be auto-set

## Risks and mitigations

| Risk                                                | Likelihood | Impact                                            | Mitigation                                                                       |
| --------------------------------------------------- | ---------- | ------------------------------------------------- | -------------------------------------------------------------------------------- |
| Config not available in plugin context at init time | Medium     | Low — can skip auto-set, user uses Web UI instead | Verify config reading path in plugin; add fallback                               |
| Web UI clientId not available for nickname API call | Low        | Medium — Web UI feature won't work                | The Web UI already identifies clients via session; verify clientId is accessible |
| Config nickname conflicts with Web UI nickname      | Low        | Low — last write wins                             | Acceptable behavior; document it                                                 |

## Alternatives considered

1. **Plugin tool instead of config**: Register an OpenCode tool `memory.set-nickname` that users call explicitly. Rejected because config-based is simpler and doesn't require user action every session.

2. **Nickname in server config instead of client config**: Put nickname in server-side opencode-memnet.jsonc. Rejected because nickname is per-client, not per-server.

3. **Auto-generate nickname from hostname/username**: Derive a default nickname from system info. Could be a future enhancement but not required for this fix.
