# Codebase Audit Fix Implementation Plan

## Source artifacts

- ISSUES.md: .CodebaseAudit/01/ISSUES.md
- FIX_SPEC.md: .CodebaseAudit/01/FIX_SPEC.md
- FIX_DESIGN.md: .CodebaseAudit/01/FIX_DESIGN.md

## Implementation policy

This is a plan only. Do not implement until explicitly instructed.

Implementation must use Red/Green/Refactor for behaviour-changing fixes.

## Phase overview

| Phase | Focus                      | Issues                       | Tasks |
| ----- | -------------------------- | ---------------------------- | ----- |
| 1     | Plugin config integration  | ISSUE-001 (REQ-001, REQ-003) | 1-2   |
| 2     | Web UI nickname management | ISSUE-001 (REQ-002)          | 3-5   |
| 3     | Test coverage              | ISSUE-002 (REQ-004)          | 6     |
| 4     | Documentation              | ISSUE-003 (REQ-005)          | 7     |

## Issue execution order

| Order | Issue     | Reason                                              |
| ----- | --------- | --------------------------------------------------- |
| 1     | ISSUE-001 | Feature is unreachable — must wire the setter first |
| 2     | ISSUE-002 | Tests validate the fix and prevent regression       |
| 3     | ISSUE-003 | Documentation follows working implementation        |

## Red phase plan

### Task 1: Red — Config-based nickname (DES-001)

**Test first**: Write a test in `tests/client-nickname.test.ts` that verifies:

- When config contains `nickname`, the plugin calls `setClientNickname()` on init
- When config does not contain `nickname`, no call is made

This test should FAIL initially because the plugin never calls `setClientNickname()`.

### Task 6: Red — Unit tests for existing backend (DES-003)

**Test first**: Write tests for:

- `PostgresClientRepository.setNickname()` — set nickname, non-existent client
- `handleSetClientNickname()` — validation, success, missing client

These tests should FAIL initially if the mock setup doesn't exist, then PASS once mocks are correct.

## Green phase plan

### Task 2: Green — Wire plugin nickname config (DES-001)

1. In `shared/config.ts` (or wherever the config type is defined): add `nickname?: string` to the config interface
2. In `plugin/src/index-remote.ts`:
   - After `clientConnect()` call (around line 40-46)
   - Read `config.nickname` from loaded config
   - If it exists and differs from `connectionInfo.nickname`, call `client.setClientNickname(clientId, config.nickname)`
   - Update `displayName` to use the new nickname

### Task 3: Green — Web UI HTML (DES-002)

In `src/web/index.html`:

- Add a nickname section to the settings/sidebar area
- Include an input field and a save button
- Use `data-i18n` attributes for label text

### Task 4: Green — Web UI JavaScript (DES-002)

In `src/web/app.js`:

- Add `loadNickname()` function that calls `GET /api/client/stats` and displays current nickname
- Add `saveNickname()` function that calls `PUT /api/client/nickname` with the input value
- Wire up the save button to call `saveNickname()`
- Call `loadNickname()` on page load (alongside other init functions)

### Task 5: Green — Web UI CSS + i18n (DES-002)

In `src/web/styles.css`:

- Style the nickname section to match existing settings UI

In `src/web/i18n.js`:

- Add translation keys: `nickname_label`, `nickname_placeholder`, `nickname_save`, `nickname_updated`

### Task 7: Green — Documentation (DES-004)

In `README.md`:

- Add a "Client Nickname" section under configuration or usage
- Explain: what it is, how to set via config, how to set via Web UI
- Include example config: `{ "nickname": "my-laptop" }`

## Refactor phase plan

After all green phases pass:

- Review the plugin init block for cleanliness — ensure nickname call doesn't clutter the existing flow
- Review Web UI nickname section for consistency with existing UI patterns
- No major refactoring expected — the changes are small and additive

## Verification plan

| Check              | Command                                  | Expected                 |
| ------------------ | ---------------------------------------- | ------------------------ |
| Full test suite    | `bun test`                               | All pass, no regressions |
| New nickname tests | `bun test tests/client-nickname.test.ts` | All pass                 |
| TypeScript check   | `bunx tsc --noEmit` (if configured)      | No new errors            |
| Build check        | `bun run build` (if configured)          | Success                  |

## Per-issue implementation packets

### ISSUE-001 implementation packet

- Objective: Make the nickname setter reachable from user-facing surfaces
- Requirements: REQ-001, REQ-002, REQ-003
- Design items: DES-001, DES-002
- Likely files:
  - `plugin/src/index-remote.ts` (wire setClientNickname call)
  - `shared/config.ts` or config type definition (add nickname field)
  - `src/web/index.html` (add nickname UI)
  - `src/web/app.js` (add nickname JS logic)
  - `src/web/styles.css` (style nickname section)
  - `src/web/i18n.js` (add translation keys)
- Forbidden files:
  - `src/services/storage/postgres/migrations.ts` (schema is correct)
  - `src/services/storage/postgres/client-repository.ts` (repository is correct)
  - `src/services/api-handlers.ts` (handler is correct)
  - `src/services/web-server.ts` (route is correct)
  - `src/services/storage/types.ts` (types are correct)
  - `src/services/storage/factory.ts` (factory is correct)
  - `plugin/src/services/remote-client.ts` (API method is correct)
- Red tests/checks:
  - Test that plugin calls setClientNickname when config has nickname
  - Test that plugin does not call setClientNickname when config has no nickname
- Green implementation notes:
  - Plugin: Add 3-5 lines after clientConnect() in index-remote.ts
  - Web UI: Add nickname section (HTML + JS + CSS + i18n)
- Refactor notes: Minimal — ensure nickname call is clean and doesn't bloat init
- Verification commands: `bun test`, manual plugin test with nickname in config
- Rollback notes: Remove nickname field from config type, remove Web UI section, remove plugin call
- Risks: Config may not be accessible at plugin init — verify config reading path

### ISSUE-002 implementation packet

- Objective: Add test coverage for the nickname system
- Requirements: REQ-004
- Design items: DES-003
- Likely files:
  - `tests/client-nickname.test.ts` (new file)
- Forbidden files:
  - All source files (tests only)
- Red tests/checks:
  - Tests are the deliverable — no separate red phase
- Green implementation notes:
  - Create `tests/client-nickname.test.ts` with:
    - Mock setup for postgres client repository
    - Tests for setNickname() (success, not found)
    - Tests for handleSetClientNickname() (validation, success, error)
- Refactor notes: None — new file
- Verification commands: `bun test tests/client-nickname.test.ts`
- Rollback notes: Delete the test file
- Risks: Mock setup may need adjustment based on actual DB interface

### ISSUE-003 implementation packet

- Objective: Document the nickname feature for users
- Requirements: REQ-005
- Design items: DES-004
- Likely files:
  - `README.md`
- Forbidden files:
  - All source and test files
- Red tests/checks: N/A — documentation only
- Green implementation notes:
  - Add "Client Nickname" section to README.md
  - Explain config-based and Web UI approaches
  - Include example config snippet
- Refactor notes: None
- Verification commands: Manual review of README.md
- Rollback notes: Remove the section
- Risks: None

## Parallelisation guidance

| Tasks                                 | Parallelizable? | Reason                                                                      |
| ------------------------------------- | --------------- | --------------------------------------------------------------------------- |
| Task 1-2 (plugin) + Task 3-5 (Web UI) | Yes             | Different files, no overlap                                                 |
| Task 1-2 (plugin) + Task 6 (tests)    | Partially       | Tests can be written in parallel but should reference final plugin behavior |
| Task 7 (docs) + any other             | Yes             | Documentation is independent                                                |

Recommended batch:

1. Batch 1: Tasks 1-2 (plugin), Tasks 3-5 (Web UI), Task 6 (tests) — all in parallel
2. Batch 2: Task 7 (docs) — after Task 1-2 complete to document the actual behavior

## Final verification checklist

- [ ] Plugin reads nickname from config and calls setClientNickname()
- [ ] Web UI displays current nickname
- [ ] Web UI allows changing nickname
- [ ] Toast messages show nickname instead of truncated ID
- [ ] All new tests pass (`bun test tests/client-nickname.test.ts`)
- [ ] Full test suite passes (`bun test`)
- [ ] README.md documents nickname feature
- [ ] No regressions in existing functionality

## Stop conditions

- All acceptance criteria from FIX_SPEC.md pass
- All tests pass with no regressions
- Documentation is complete
- OR: After 3 repair loop iterations without success

## Handoff notes

- The backend is fully implemented and working. Only the user-facing surface needs wiring.
- The `setClientNickname()` method in `plugin/src/services/remote-client.ts:268-273` is ready to call — it just needs to be invoked from `index-remote.ts`.
- The API endpoint `PUT /api/client/nickname` is fully functional and tested manually via curl.
- Config system is in `shared/config.ts` — verify how optional fields are handled before adding `nickname`.

## Reminder / follow-up state

- rem_1780281552435_6uyxg: Audit in progress — all artifacts now written
- Post-implementation: Verify live behavior with Docker containers running
- Post-implementation: Check if design doc at `docs/superpowers/plans/2026-05-28-client-identity-tracking.md` specifies additional intended behavior
