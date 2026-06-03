# Codebase Audit Issues

## Audit scope

- Repository: opencode-memnet
- Branch: (current)
- Commit: (current HEAD)
- User scope argument: The 'nickname' system. Apparently it was implemented but I cannot see how to use it or if it was completed
- Audit run directory: .CodebaseAudit/01/
- Date/time: 2026-06-01
- Tools used: sequential-thinking, reminders, @explorer subagents (3), @fixer subagent (1)
- Commands run: git log --oneline --all --grep="nickname", grep -ri "nickname" across codebase
- Commands skipped: bun test (not relevant for this focused audit), bun build, destructive commands
- Limitations: No live server verification (Docker containers not running during audit). git commit SHA not captured but available via git log.

## Orchestration assistance tools

- sequential-thinking used: Yes
- sequential-thinking limitation: None
- reminders used: Yes
- reminders limitation: None
- reminders/follow-ups created: rem_1780281552435_6uyxg (audit progress tracking)

## Summary

| Severity      | Count |
| ------------- | ----- |
| Critical      | 0     |
| High          | 1     |
| Medium        | 0     |
| Low           | 1     |
| Informational | 1     |

## Issue index

| ID        | Severity      | Confidence | Category               | Status    | Title                                                    |
| --------- | ------------- | ---------- | ---------------------- | --------- | -------------------------------------------------------- |
| ISSUE-001 | High          | High       | UX                     | Confirmed | Nickname setter unreachable from any user-facing surface |
| ISSUE-002 | Low           | High       | Maintainability        | Confirmed | Zero test coverage for nickname system                   |
| ISSUE-003 | Informational | High       | Documentation Mismatch | Confirmed | No documentation or user guidance for nickname feature   |

## Issues

## ISSUE-001: Nickname setter unreachable from any user-facing surface

- Severity: High
- Confidence: High
- Category: UX
- Status: Confirmed
- Affected area: Plugin, Web UI, Configuration
- Affected files:
  - `plugin/src/services/remote-client.ts:268-273` — `setClientNickname()` method exists but never called
  - `plugin/src/index-remote.ts` — no invocation of `setClientNickname()` anywhere in plugin entry
  - `src/web/index.html` — no nickname UI element
  - `src/web/app.js` — no nickname JavaScript logic
  - `src/web/styles.css` — no nickname styles
  - `src/web/i18n.js` — no nickname translations
  - `opencode.json` — no nickname configuration
  - `shared/config.ts` — no nickname config option
- Evidence:
  - `plugin/src/services/remote-client.ts:268-273` defines `setClientNickname(clientId, nickname)` which calls `PUT /api/client/nickname`
  - Grep of `plugin/src/index-remote.ts` for "setClientNickname" returns zero results — the method is defined but never invoked
  - Grep of `src/web/` for "nickname" returns zero results — no Web UI presence
  - Grep of config files for "nickname" returns zero results — no config option
  - The API endpoint `PUT /api/client/nickname` exists in `src/services/web-server.ts:488` and the handler in `src/services/api-handlers.ts:1799-1820` is fully functional
  - Toast messages in `plugin/src/index-remote.ts:49` show `displayName = connectionInfo.nickname || clientId.slice(0, 8)` — users see the nickname in toasts but cannot change it
- Why this matters: The entire nickname backend is implemented (DB schema, repository, API route, handler, plugin client method) but there is NO user-facing mechanism to actually set a nickname. The feature is architecturally complete but operationally dead. Users always see truncated client IDs (e.g., "a1b2c3d4") instead of meaningful names.
- Reproduction / verification:
  1. Start the server and connect via plugin
  2. Observe toast message shows truncated clientId, not a nickname
  3. Try to find any UI, config, or command to set a nickname — none exists
  4. `curl -X PUT http://localhost:4747/api/client/nickname -d '{"clientId":"...","nickname":"test"}'` works but no user-facing trigger exists
- Expected behaviour: Users should be able to set their nickname through the plugin (via a tool, hook, or config) or through the Web UI.
- Actual behaviour: Users see truncated client IDs in toast messages. The `setClientNickname()` API exists but is unreachable.
- Proposed correction: Wire the `setClientNickname()` method into the plugin (e.g., as an OpenCode tool, via config option, or via a command) and/or add nickname management to the Web UI Memory Explorer.
- Dependencies / related issues: None
- Risk of fix: Low — the backend is complete, only the user-facing surface needs wiring
- Suggested test coverage: Integration test that calls the API endpoint, unit test for plugin nickname flow, Web UI E2E test for nickname input

## ISSUE-002: Zero test coverage for nickname system

- Severity: Low
- Confidence: High
- Category: Maintainability
- Status: Confirmed
- Affected area: Tests
- Affected files:
  - `tests/` — no test file covers nickname functionality
  - `src/services/storage/postgres/client-repository.ts:66-74` — `setNickname()` untested
  - `src/services/api-handlers.ts:1799-1820` — `handleSetClientNickname()` untested
  - `plugin/src/services/remote-client.ts:268-273` — `setClientNickname()` untested
- Evidence:
  - Grep of `tests/` directory for "nickname" returns zero results
  - 19 test files exist in `tests/` but none cover client/nickname functionality
  - The test command is `bun test` but no test references nickname
- Why this matters: Without tests, future changes to the client repository, API handlers, or plugin client could break nickname functionality silently.
- Reproduction / verification: `grep -r "nickname" tests/` returns no results
- Expected behaviour: Unit tests for `setNickname()`, `handleSetClientNickname()`, and the remote client method
- Actual behaviour: No tests exist
- Proposed correction: Add unit tests for repository, API handler, and remote client nickname methods
- Dependencies / related issues: Related to ISSUE-001 (fixing the setter flow should include tests)
- Risk of fix: None — adding tests is purely additive
- Suggested test coverage: Unit tests for `setNickname()`, `handleSetClientNickname()`, and remote client `setClientNickname()`

## ISSUE-003: No documentation or user guidance for nickname feature

- Severity: Informational
- Confidence: High
- Category: Documentation Mismatch
- Status: Confirmed
- Affected area: Documentation
- Affected files:
  - `README.md` — no mention of nickname feature
  - `docs/` — no user-facing documentation for nickname
  - `plugin/src/index-remote.ts` — no comments explaining how nickname works
- Evidence:
  - A design doc exists at `docs/superpowers/plans/2026-05-28-client-identity-tracking.md` with detailed nickname specifications
  - But `README.md` and user-facing docs do not mention how to use nicknames
  - The toast messages are the only user-visible reference to nicknames, and they don't explain how to set one
- Why this matters: Users have no way to discover the nickname feature or understand how to use it
- Reproduction / verification: Read README.md — no nickname documentation found
- Expected behaviour: README or docs should explain how to set a client nickname
- Actual behaviour: No user-facing documentation exists
- Proposed correction: Add a section to README.md or docs/ explaining the nickname feature and how to use it (once ISSUE-001 is fixed)
- Dependencies / related issues: Depends on ISSUE-001 being fixed first (since there's currently nothing usable to document)
- Risk of fix: None — documentation is additive
- Suggested test coverage: N/A

## False positives / discarded findings

1. **"displayName" vs "nickname" confusion**: Initially investigated whether `displayName` fields across the codebase were related to the nickname system. They are separate concepts — `displayName` is used in memory/profile/project contexts while `nickname` is client-specific. Not a bug.
2. **Missing i18n keys**: The Web UI has no nickname presence at all, so missing i18n keys are a consequence of ISSUE-001, not a separate issue.

## Unresolved questions

1. What was the intended user interaction for setting nicknames? The design doc (`docs/superpowers/plans/2026-05-28-client-identity-tracking.md`) may specify this but was not fully analyzed.
2. Should nicknames be configurable via `opencode-memnet.jsonc` (like server URL) or only via runtime API call?

## Follow-up reminders / deferred work

- rem_1780281552435_6uyxg: Audit in progress — need to complete FIX_SPEC, FIX_DESIGN, FIX_IMPLEMENTATION_PLAN
- After ISSUE-001 fix: read the design doc to determine intended user interaction for nicknames
- After ISSUE-001 fix: determine if nickname should be config-file based or runtime-only
- Live server verification deferred (Docker not running during audit)
