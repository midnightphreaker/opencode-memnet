# Codebase Audit Issues

## Audit scope

- Repository: opencode-memnet
- Branch: main
- Commit: 250c9ab (250c9abe29c905b1310d027d0c871d2e772e5316)
- User scope argument: Settings modal UX issues when DISABLE_WEBUI_AUTH=true, nickname save/load broken, maintenance jobs button label
- Audit run directory: .opencode/orchestrator/CodebaseAudit/01
- Date/time: 2026-06-02
- Tools used: sequential-thinking, explorer subagents, code search
- Commands run: None (bash restricted for orchestrator)
- Commands skipped: build, test, lint, typecheck (audit-only, no destructive commands)
- Limitations: Bash restricted to JOURNAL.md paths; git info obtained via fixer subagent

## Orchestration assistance tools

- sequential-thinking used: Yes
- sequential-thinking limitation: None
- reminders used: No (follow-ups tracked in ISSUES.md)
- reminders limitation: None
- reminders/follow-ups created: None (tracked in ISSUES.md Follow-up section)

## Summary

| Severity      | Count |
| ------------- | ----- |
| Critical      | 0     |
| High          | 1     |
| Medium        | 1     |
| Low           | 1     |
| Informational | 0     |

## Issue index

| ID        | Severity | Confidence | Category | Status    | Title                                                                        |
| --------- | -------- | ---------- | -------- | --------- | ---------------------------------------------------------------------------- |
| ISSUE-001 | High     | High       | Bug      | Confirmed | Nickname save/load broken — profile ID used as client ID                     |
| ISSUE-002 | Medium   | High       | UX       | Confirmed | Settings modal shows "API Settings" and localStorage note when auth disabled |
| ISSUE-003 | Low      | High       | UX       | Confirmed | Maintenance Jobs toggle button missing visible text label                    |

## Issues

## ISSUE-001: Nickname save/load broken — profile ID used as client ID

- Severity: High
- Confidence: High
- Category: Bug
- Status: Confirmed
- Affected area: Settings modal nickname functionality
- Affected files:
  - `src/web/app.js` — lines 1588-1621 (loadNickname, saveNickname), line 3 (state.activeProfileId init), lines 1578-1580 (populateProfileDropdown auto-select), lines 1661-1677 (settings-save handler)
  - `src/services/api-handlers.ts` — lines 1818-1876 (handleSetClientNickname, handleGetClientStats)
  - `src/services/web-server.ts` — lines 495-508 (PUT /api/client/nickname, GET /api/client/stats routes)
- Evidence:
  1. `saveNickname()` (app.js:1604) sends `state.activeProfileId` as the `clientId` field to `PUT /api/client/nickname`
  2. `loadNickname()` (app.js:1590) sends `state.activeProfileId` as `clientId` query param to `GET /api/client/stats`
  3. `state.activeProfileId` is set to a USER PROFILE ID (e.g., a user_id from the `user_profiles` table) by `populateProfileDropdown()` at line 1578
  4. The backend `handleSetClientNickname()` (api-handlers.ts:1818) looks up the `clientId` in the `clients` table via `clientRepo!.setNickname(data.clientId, data.nickname)`
  5. The `clients` table (migration #12) stores CLIENT connection records with their own IDs — these are DIFFERENT from user profile IDs
  6. When the profile ID doesn't match any client record, `setNickname()` returns null, and the API returns `{success: false, error: "Client not found — connect first"}`
  7. The frontend shows an error toast on save failure but the nickname field remains blank on reload
  8. Additional race condition: `loadNickname()` is called without `await` after `populateProfileDropdown()` in the settings-toggle handler (app.js:1631-1636), so if `populateProfileDropdown` hasn't finished, `activeProfileId` may still be empty and `loadNickname()` returns silently at line 1590
- Why this matters: The nickname feature is completely non-functional. Users cannot set or see device nicknames, which is a core feature for multi-device profile identification.
- Reproduction / verification:
  1. Start server with DISABLE_WEBUI_AUTH=true
  2. Open Settings panel
  3. Enter a nickname (e.g., "my-laptop") in the Nickname field
  4. Click Save
  5. Observe: either error toast ("Client not found — connect first") or silent failure (no toast if activeProfileId is empty)
  6. Reopen Settings
  7. Observe: nickname field is blank
- Expected behaviour:
  - User enters nickname, clicks Save
  - Success toast appears ("Nickname updated")
  - Reopening Settings shows the saved nickname
  - The nickname is associated with the currently active profile
- Actual behaviour:
  - Nickname save either fails with "Client not found" error or silently returns (no toast) if activeProfileId is empty
  - Nickname never persists; field is always blank on reopen
- Proposed correction:
  The nickname should be stored on the user profile, not on the client record. Options:

  **Option A (Recommended): Store nickname on user_profiles table**
  1. Add a `nickname` column to `user_profiles` table (new migration)
  2. Create a new API endpoint `PUT /api/user-profile/nickname` that accepts `{nickname: string}` and updates the active profile
  3. Update `handleGetUserProfile` to return the nickname field
  4. Update `loadNickname()` to read from the user profile API response
  5. Update `saveNickname()` to call the new endpoint
  6. Remove dependency on `state.activeProfileId` / `clientId` for nickname

  **Option B: Fix client ID mapping**
  1. When a user profile is selected, look up the corresponding client record
  2. Store the client ID separately in state
  3. Use the correct client ID for nickname operations

  Option A is recommended because the user's intent is "update the nickname of the currently selected profile," which aligns with profile-level storage, not client-level storage.

- Dependencies / related issues: ISSUE-002 (settings panel visibility affects the profile dropdown which feeds into this issue)
- Risk of fix: Low for Option A — adding a column and endpoint is non-breaking. The existing client nickname system can remain for other use cases.
- Suggested test coverage:
  - API test: PUT /api/user-profile/nickname with valid nickname → 200
  - API test: PUT /api/user-profile/nickname with empty nickname → clears nickname
  - API test: GET /api/user-profile returns nickname field
  - E2E test: Open settings, enter nickname, save, reopen → nickname persists
  - E2E test: Open settings, save with no nickname → field stays blank, no error

## ISSUE-002: Settings modal shows "API Settings" and localStorage note when auth disabled

- Severity: Medium
- Confidence: High
- Category: UX
- Status: Confirmed
- Affected area: Settings panel header and footer text
- Affected files:
  - `src/web/index.html` — line 287 (`<h3 data-i18n="settings-title">API Settings</h3>`), lines 316-318 (`<p class="settings-note" ...>API key is stored in browser localStorage.</p>`)
  - `src/web/app.js` — lines 1690-1707 (auth disabled handler — hides API key and profile fields but not title or note)
- Evidence:
  1. When `DISABLE_WEBUI_AUTH=true`, `app.js:1690-1707` sets `state.authDisabled = true` and hides the API key field and profile dropdown
  2. The settings panel title remains "API Settings" (hardcoded in index.html:287)
  3. The localStorage note remains visible (index.html:316-318)
  4. Since the API key field is hidden, the localStorage note is misleading — there is no API key being stored
  5. The title "API Settings" implies API key management, which is irrelevant when auth is disabled
- Why this matters: Confusing UX — users see "API Settings" and a note about localStorage API key storage when no API key is being used or stored.
- Reproduction / verification:
  1. Start server with DISABLE_WEBUI_AUTH=true
  2. Open Settings panel
  3. Observe: title says "API Settings", note says "API key is stored in browser localStorage."
  4. Observe: no API key field is visible (hidden), making the title and note misleading
- Expected behaviour:
  - When auth is disabled: title should be "Settings" (not "API Settings")
  - When auth is disabled: localStorage note should be hidden
  - When auth is enabled: title remains "API Settings" and note remains visible (current behavior)
- Actual behaviour:
  - Title always says "API Settings" regardless of auth mode
  - localStorage note always visible regardless of auth mode
- Proposed correction:
  1. In `app.js` auth-disabled handler (around line 1700), add:
     ```javascript
     document.querySelector("#settings-panel h3").textContent = "Settings";
     document.querySelector(".settings-note").style.display = "none";
     ```
  2. Alternatively, add data attributes or CSS classes to control visibility via the existing auth-disabled logic
- Dependencies / related issues: None
- Risk of fix: Very low — cosmetic text/visibility change only
- Suggested test coverage:
  - E2E: Open settings with auth disabled → title is "Settings", no localStorage note
  - E2E: Open settings with auth enabled → title is "API Settings", localStorage note visible

## ISSUE-003: Maintenance Jobs toggle button missing visible text label

- Severity: Low
- Confidence: High
- Category: UX
- Status: Confirmed
- Affected area: Job status bar bottom-right toggle button
- Affected files:
  - `src/web/index.html` — lines 353-355 (`#job-drawer-toggle` button with only a chevron icon)
  - `src/web/style.css` — job-drawer-toggle styles (may need adjustment for text+icon layout)
- Evidence:
  1. The `#job-drawer-toggle` button (index.html:353-355) contains only `<i data-lucide="chevron-up" class="icon"></i>` — no text
  2. The button has `title="Job Details"` for hover tooltip but no visible label
  3. User expects to see "^ Maintenance Jobs" text alongside the icon
- Why this matters: The button's purpose is not immediately clear from visual inspection alone — users must hover to see the tooltip.
- Reproduction / verification:
  1. Load the web UI
  2. Look at the bottom-right status bar
  3. Observe: only a chevron-up icon, no text label
- Expected behaviour: Button shows chevron icon + " Maintenance Jobs" text (e.g., "^ Maintenance Jobs")
- Actual behaviour: Button shows only chevron icon with no visible text
- Proposed correction:
  1. Add a text span inside the button:
     ```html
     <button id="job-drawer-toggle" class="job-drawer-toggle" title="Maintenance Jobs">
       <i data-lucide="chevron-up" class="icon"></i>
       <span>Maintenance Jobs</span>
     </button>
     ```
  2. Update CSS for `.job-drawer-toggle` to accommodate icon + text (flex layout with gap)
- Dependencies / related issues: None
- Risk of fix: Very low — adding text to a button, minor CSS adjustment
- Suggested test coverage:
  - Visual inspection: button shows icon + "Maintenance Jobs" text
  - Click: drawer still opens/closes correctly

## False positives / discarded findings

1. **web-server-worker.ts missing client/nickname routes**: The worker mode is a separate deployment path (opencode plugin) and not the primary docker-compose deployment. The main web-server.ts has all routes. Flagged as informational but not an actionable issue for the current scope.
2. **Race condition in settings-toggle handler**: The `loadNickname()` call is not awaited after `populateProfileDropdown()`. While this is a real concern, it's secondary to the core issue (ISSUE-001 — wrong ID type). Even if the race were fixed, nickname would still fail because the ID mapping is wrong. Will be addressed as part of ISSUE-001 fix.

## Unresolved questions

1. Should the existing `clients` table nickname system be deprecated in favor of profile-level nicknames? Or should both systems coexist?
2. Is the `clients` table used for any other purpose that depends on the nickname field? If so, migration needs care.
3. Does the web-server-worker.ts need the new profile nickname endpoint added too?

## Follow-up reminders / deferred work

1. **ISSUE-001 implementation**: Requires database migration (add nickname column to user_profiles), new API endpoint, frontend rewrite of loadNickname/saveNickname. This is the highest priority fix.
2. **ISSUE-002 implementation**: Simple JS/CSS changes — can be done in parallel with ISSUE-001.
3. **ISSUE-003 implementation**: HTML + CSS change — can be done in parallel.
4. **Post-fix E2E**: Rebuild container, run browser E2E tests to verify all three fixes.
