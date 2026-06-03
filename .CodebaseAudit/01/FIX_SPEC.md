# Codebase Audit Fix Specification

## Source artifacts

- ISSUES.md: .CodebaseAudit/01/ISSUES.md

## Scope

Fix the nickname system so it is user-accessible, tested, and documented. The backend implementation is complete (DB schema, repository, API route, handler, plugin client method). The fix focuses entirely on the user-facing surface, test coverage, and documentation.

## Non-goals

- Redesigning the nickname data model or API contract
- Adding nickname validation rules (length, character restrictions) — beyond basic non-empty check that already exists
- Adding nickname to any system other than the OpenCode plugin and Web UI
- Changing the toast message format beyond using the nickname
- Multi-user nickname management (admin features)
- Nickname uniqueness enforcement

## Requirements

- REQ-001: Users must be able to set their client nickname through the OpenCode plugin configuration (opencode-memnet.jsonc)
- REQ-002: Users must be able to view and change their nickname through the Web UI (Memory Explorer)
- REQ-003: The plugin must call `setClientNickname()` on initialization when a nickname is configured, making the API reachable
- REQ-004: Unit tests must cover the nickname repository method, API handler, and plugin flow
- REQ-005: README.md or equivalent documentation must explain the nickname feature and how to use it

## Issue-to-requirement mapping

| Issue     | Requirement IDs           |
| --------- | ------------------------- |
| ISSUE-001 | REQ-001, REQ-002, REQ-003 |
| ISSUE-002 | REQ-004                   |
| ISSUE-003 | REQ-005                   |

## Acceptance criteria

- AC-001: Adding `"nickname": "my-name"` to opencode-memnet.jsonc results in the server storing that nickname for the client on next plugin connection
- AC-002: The Web UI Memory Explorer displays the current client nickname and provides a way to change it
- AC-003: After setting a nickname, toast messages in the plugin show the nickname instead of the truncated clientId
- AC-004: `bun test` passes with new nickname tests included and no regressions
- AC-005: README.md contains a section explaining the nickname feature with configuration example

## Verification expectations

- Config-based: Set nickname in opencode-memnet.jsonc, restart plugin, verify toast shows nickname
- Web UI: Open Memory Explorer, find nickname display, change it, verify update persisted
- Tests: `bun test` runs and passes all new nickname tests
- API: `curl -X PUT /api/client/nickname` still works as before (no regression)

## Constraints

- Must not break existing API contract for PUT /api/client/nickname
- Must not change the database schema (already correct)
- Must not require server restart for nickname changes via Web UI
- Config-based nickname should be sent on every plugin initialization (not just first time)

## Risks

- Config-based nickname may conflict with Web UI changes if both are used — last write wins, which is acceptable
- Plugin may not have access to config at the right lifecycle point — need to verify config reading in plugin context

## Out of scope

- Nickname history or audit trail
- Nickname deletion (setting to empty/null)
- Admin interface for managing all client nicknames
- Nickname uniqueness constraints
- Nickname in API responses beyond existing fields

## Completion definition

All acceptance criteria pass. The nickname feature is accessible via both plugin config and Web UI. Tests cover the critical paths. Documentation exists.
