# Codebase Audit Fix Specification

## Source artifacts

- ISSUES.md: .opencode/orchestrator/CodebaseAudit/01/ISSUES.md (3 issues: 1 High, 1 Medium, 1 Low)

## Scope

Fix the three confirmed issues in the opencode-memnet web UI:

1. Broken nickname save/load (ISSUE-001)
2. Misleading settings panel text when auth is disabled (ISSUE-002)
3. Missing text label on Maintenance Jobs toggle button (ISSUE-003)

## Non-goals

- Redesigning the settings panel layout
- Changing the client management system or clients table
- Adding new features beyond fixing the identified issues
- Modifying the web-server-worker.ts routes (separate deployment context)
- Changing i18n infrastructure or translation files

## Requirements

- REQ-001: The nickname must be stored on the user_profiles table as a new column
- REQ-002: A new API endpoint `PUT /api/user-profile/nickname` must accept `{nickname: string}` and update the active user profile's nickname
- REQ-003: The `GET /api/user-profile` response must include the nickname field
- REQ-004: `loadNickname()` must fetch the nickname from the user profile API, not from the client stats API
- REQ-005: `saveNickname()` must call `PUT /api/user-profile/nickname` instead of `PUT /api/client/nickname`
- REQ-006: `saveNickname()` must show a success toast on successful save and an error toast with details on failure
- REQ-007: `saveNickname()` must NOT depend on `state.activeProfileId` or any client ID — it operates on the currently active profile determined by the server
- REQ-008: When `loadNickname()` runs and the profile has no nickname, the field must remain blank (no error)
- REQ-009: When DISABLE_WEBUI_AUTH=true, the settings panel title must display "Settings" instead of "API Settings"
- REQ-010: When DISABLE_WEBUI_AUTH=true, the "API key is stored in browser localStorage." note must be hidden
- REQ-011: When DISABLE_WEBUI_AUTH=false (auth enabled), the settings panel must retain its current behavior (title "API Settings", localStorage note visible)
- REQ-012: The `#job-drawer-toggle` button must display the chevron icon followed by the text "Maintenance Jobs"
- REQ-013: The `#job-drawer-toggle` button must maintain its click behavior (toggle the job drawer open/close)
- REQ-014: The `loadNickname()` call in the settings-toggle handler must be properly sequenced after profile data is available (no race condition)

## Issue-to-requirement mapping

| Issue     | Requirement IDs                                                                 |
| --------- | ------------------------------------------------------------------------------- |
| ISSUE-001 | REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-014 |
| ISSUE-002 | REQ-009, REQ-010, REQ-011                                                       |
| ISSUE-003 | REQ-012, REQ-013                                                                |

## Acceptance criteria

- AC-001: Opening the Settings panel with auth disabled shows title "Settings" and no localStorage note
- AC-002: Opening the Settings panel with auth enabled shows title "API Settings" and the localStorage note
- AC-003: Entering a nickname and clicking Save shows a success toast
- AC-004: After saving a nickname, reopening Settings shows the saved nickname in the field
- AC-005: Clearing the nickname and clicking Save clears the nickname (field blank on reopen)
- AC-006: If nickname save fails (server error), an error toast with the error message is shown
- AC-007: The Maintenance Jobs toggle button shows "^ Maintenance Jobs" (icon + text)
- AC-008: Clicking the Maintenance Jobs toggle button opens/closes the job drawer
- AC-009: The nickname persists across page reloads (stored server-side in user_profiles)
- AC-010: A new database migration adds the nickname column to user_profiles without data loss

## Verification expectations

- Rebuild docker container after code changes
- Open Settings panel in browser and verify each acceptance criterion
- Check server logs for errors during nickname save/load
- Verify no regression in auth-enabled mode (if testable)

## Constraints

- Must not break existing API contracts for other endpoints
- Must not remove the client nickname system (used by other parts of the codebase)
- Database migration must be additive (new column, no column removal)
- Must not require manual database changes

## Risks

- The user_profiles table may have many rows — adding a nullable column should be fast but needs testing
- The profile-repository.ts may have caching or query patterns that need updating for the new column
- The web-server.ts and web-server-worker.ts may both need route updates (worker is lower priority)

## Out of scope

- Refactoring the settings panel component structure
- Adding Zod validation to API endpoints
- Fixing the web-server-worker.ts missing routes (separate deployment context)
- i18n translation file updates (can be done separately)

## Completion definition

All acceptance criteria AC-001 through AC-010 pass. Server logs show no errors related to nickname operations. Settings panel displays correctly in both auth-disabled and auth-enabled modes.
