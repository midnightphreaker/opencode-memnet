# Codebase Audit Fix Implementation Plan

## Source artifacts

- ISSUES.md: .opencode/orchestrator/CodebaseAudit/01/ISSUES.md
- FIX_SPEC.md: .opencode/orchestrator/CodebaseAudit/01/FIX_SPEC.md
- FIX_DESIGN.md: .opencode/orchestrator/CodebaseAudit/01/FIX_DESIGN.md

## Implementation policy

This is a plan only. Do not implement until explicitly instructed.

Implementation must use Red/Green/Refactor for behaviour-changing fixes.

## Phase overview

- **Phase 1**: ISSUE-002 + ISSUE-003 (simple UI fixes, no backend changes)
- **Phase 2**: ISSUE-001 (nickname storage migration, new endpoint, frontend rewrite)

Phase 1 is independent and can be implemented first to build confidence. Phase 2 is more complex and depends on database changes.

## Issue execution order

| Order | Issue     | Reason                                                                   |
| ----- | --------- | ------------------------------------------------------------------------ |
| 1     | ISSUE-002 | Quick UI win — no backend, no DB changes, immediate visual improvement   |
| 2     | ISSUE-003 | Quick UI win — HTML/CSS only, independent of other issues                |
| 3     | ISSUE-001 | Most complex — requires DB migration, new API endpoint, frontend rewrite |

## Red phase plan

### ISSUE-002 Red (Settings title/note when auth disabled)

- Open browser with DISABLE_WEBUI_AUTH=true
- Verify Settings title shows "API Settings" (wrong)
- Verify localStorage note is visible (wrong)
- Capture as baseline screenshots

### ISSUE-003 Red (Maintenance Jobs button text)

- Open browser
- Verify `#job-drawer-toggle` button shows only icon, no text
- Capture as baseline screenshot

### ISSUE-001 Red (Nickname save/load)

- Open browser
- Enter nickname in Settings, click Save
- Verify: no success toast or error toast with "Client not found"
- Reopen Settings
- Verify: nickname field is blank
- Verify via curl: `PUT /api/user-profile/nickname` returns 404 (endpoint doesn't exist yet)

## Green phase plan

### ISSUE-002 Green (Settings title/note)

1. Edit `src/web/app.js` — in the auth-disabled handler (around line 1700, after hiding API key and profile fields):
   ```javascript
   // Change title from "API Settings" to "Settings" when auth disabled
   document.querySelector('#settings-panel h3[data-i18n="settings-title"]').textContent =
     "Settings";
   // Hide the localStorage note when auth disabled
   document.querySelector(".settings-note").style.display = "none";
   ```
2. Test: Open Settings → title is "Settings", no localStorage note

### ISSUE-003 Green (Maintenance Jobs button text)

1. Edit `src/web/index.html` — update `#job-drawer-toggle` (line 353-355):
   ```html
   <button id="job-drawer-toggle" class="job-drawer-toggle" title="Maintenance Jobs">
     <i data-lucide="chevron-up" class="icon"></i>
     <span>Maintenance Jobs</span>
   </button>
   ```
2. Edit `src/web/style.css` — ensure `.job-drawer-toggle` has flex layout:
   ```css
   .job-drawer-toggle {
     display: inline-flex;
     align-items: center;
     gap: 6px;
   }
   ```
3. Test: Button shows "^ Maintenance Jobs", click still toggles drawer

### ISSUE-001 Green (Nickname — backend)

1. **Migration**: Edit `src/services/storage/postgres/migrations.ts`:
   - Add new migration number (next available)
   - SQL: `ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS nickname TEXT DEFAULT NULL;`

2. **Types**: Edit `src/services/storage/types.ts`:
   - Add `nickname?: string | null` to `UserProfileRow` interface

3. **Repository**: Edit `src/services/storage/postgres/profile-repository.ts`:
   - Add `nickname` to all SELECT queries for user_profiles
   - Add method `setNickname(userId: string, nickname: string): Promise<boolean>`:
     ```sql
     UPDATE user_profiles SET nickname = $1 WHERE user_id = $2
     ```

4. **API Handler**: Edit `src/services/api-handlers.ts`:
   - New function `handleSetProfileNickname(data: { nickname: string }): Promise<ApiResponse<{ nickname: string }>>`
   - If no userId provided, find the active profile via profileRepo
   - Validate nickname length (max 100 chars)
   - Call profileRepo.setNickname()
   - Return success/error

5. **Route**: Edit `src/services/web-server.ts`:
   - Add route:
     ```typescript
     if (path === "/api/user-profile/nickname" && method === "PUT") {
       const body = await this.parseBody(req);
       const result = await handleSetProfileNickname(body);
       return this.jsonResponse(result);
     }
     ```
   - Place after existing user-profile routes (around line 360)

6. **Update handleGetUserProfile**: Ensure `GET /api/user-profile` response includes `nickname` field from the profile row

### ISSUE-001 Green (Nickname — frontend)

7. **Rewrite `loadNickname()`** in `src/web/app.js` (around line 1588):

   ```javascript
   async function loadNickname() {
     try {
       const result = await fetchAPI("/api/user-profile");
       if (result.success && result.data) {
         document.getElementById("settings-nickname").value = result.data.nickname || "";
       }
     } catch (e) {
       console.warn("Failed to load nickname:", e);
     }
   }
   ```

8. **Rewrite `saveNickname()`** in `src/web/app.js` (around line 1602):

   ```javascript
   async function saveNickname() {
     const nickname = document.getElementById("settings-nickname").value.trim();
     try {
       const result = await fetchAPI("/api/user-profile/nickname", {
         method: "PUT",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ nickname }),
       });
       if (result.success) {
         showToast(t("nickname-updated"), "success");
       } else {
         showToast(result.error || t("nickname-update-failed"), "error");
       }
     } catch (e) {
       showToast(t("nickname-update-failed"), "error");
     }
   }
   ```

9. **Fix settings-toggle handler** in `src/web/app.js` (around line 1623):
   - Ensure `loadNickname()` is called with `await` after `populateProfileDropdown()`:
     ```javascript
     await populateProfileDropdown();
     await loadNickname();
     ```

## Refactor phase plan

- Review all changed files for consistency
- Ensure the old `clientId`-based nickname code is no longer referenced in the settings flow
- Verify that `saveNickname()` and `loadNickname()` no longer reference `state.activeProfileId` or `/api/client/` endpoints
- Check that CSS for `.job-drawer-toggle` is clean and doesn't break responsive layout
- Ensure the settings-title i18n key is not needed for auth-disabled mode (hardcoded "Settings" is acceptable)

## Verification plan

### Phase 1 verification (ISSUE-002 + ISSUE-003):

1. Rebuild container: `docker compose build --no-cache server && docker compose up -d`
2. Open Settings with auth disabled → title is "Settings", no localStorage note
3. Check Maintenance Jobs button shows icon + "Maintenance Jobs"
4. Click Maintenance Jobs button → drawer opens/closes
5. Server logs: no errors

### Phase 2 verification (ISSUE-001):

1. Rebuild container (includes migration)
2. Open Settings → enter nickname "test-e2e" → Save → success toast
3. Reopen Settings → nickname field shows "test-e2e"
4. Clear nickname → Save → success toast
5. Reopen Settings → nickname field is blank
6. `curl PUT /api/user-profile/nickname {"nickname":"api-test"}` → success
7. `curl GET /api/user-profile` → response includes nickname
8. Server logs: no errors

### Full regression:

- Memory CRUD still works
- Search still works
- Tags, pagination still work
- Profile panel still works
- Job drawer still works

## Per-issue implementation packets

### ISSUE-001 implementation packet

- Objective: Fix nickname save/load by storing nickname on user_profiles table and creating a dedicated API endpoint
- Requirements: REQ-001 through REQ-008, REQ-014
- Design items: DES-001, DES-002, DES-003, DES-004
- Likely files:
  - `src/services/storage/postgres/migrations.ts`
  - `src/services/storage/types.ts`
  - `src/services/storage/postgres/profile-repository.ts`
  - `src/services/api-handlers.ts`
  - `src/services/web-server.ts`
  - `src/web/app.js`
- Forbidden files:
  - `src/services/web-server-worker.ts` (out of scope)
  - `src/services/storage/postgres/client-repository.ts` (no changes needed)
  - Any `.env` or config files
- Red tests/checks:
  - curl PUT /api/user-profile/nickname returns 404
  - Settings nickname field is blank on reopen after save
- Green implementation notes:
  - Add migration first, then types, then repository, then API handler, then route, then frontend
  - Test each layer incrementally
- Refactor notes:
  - Remove `clientId` parameter from `saveNickname()` and `loadNickname()` signatures
  - Ensure old `/api/client/nickname` route is NOT removed (used elsewhere)
- Verification commands:
  - `docker compose build --no-cache server && docker compose up -d`
  - `curl -s -X PUT http://10.9.9.20:4747/api/user-profile/nickname -H "Content-Type: application/json" -d '{"nickname":"test"}'`
  - Browser E2E: Settings → nickname → Save → reopen
- Rollback notes:
  - Drop nickname column: `ALTER TABLE user_profiles DROP COLUMN IF EXISTS nickname;`
  - Revert frontend changes in app.js
- Risks:
  - Migration may need to be the next sequential number — check existing migrations first
  - Profile repository may have cached queries — verify all SELECT paths

### ISSUE-002 implementation packet

- Objective: Fix settings panel title and note visibility when auth is disabled
- Requirements: REQ-009, REQ-010, REQ-011
- Design items: DES-005
- Likely files:
  - `src/web/app.js`
- Forbidden files:
  - `src/web/index.html` (no HTML changes needed — JS-only fix)
  - Any backend files
- Red tests/checks:
  - Open Settings with auth disabled → title is "API Settings", note visible
- Green implementation notes:
  - Add 2 lines to the auth-disabled handler in app.js
- Refactor notes:
  - None needed — minimal change
- Verification commands:
  - Browser: Open Settings → check title and note
- Rollback notes:
  - Revert the 2 added lines
- Risks: Very low

### ISSUE-003 implementation packet

- Objective: Add "Maintenance Jobs" text to the toggle button
- Requirements: REQ-012, REQ-013
- Design items: DES-006
- Likely files:
  - `src/web/index.html`
  - `src/web/style.css`
- Forbidden files:
  - Any backend files
  - `src/web/app.js` (no JS changes needed)
- Red tests/checks:
  - `#job-drawer-toggle` has no text content
- Green implementation notes:
  - Add `<span>Maintenance Jobs</span>` to button HTML
  - Ensure CSS handles icon+text layout
- Refactor notes:
  - None needed
- Verification commands:
  - Browser: Visual inspection of button
  - Click test: drawer opens/closes
- Rollback notes:
  - Remove the span from HTML, revert CSS
- Risks: Very low

## Parallelisation guidance

- ISSUE-002 and ISSUE-003 can be implemented in parallel by separate fixers (different files)
- ISSUE-001 must be done sequentially: migration → types → repository → handler → route → frontend
- ISSUE-001 Phase 1 (backend) can be done by one fixer while ISSUE-002/003 are done by another

## Final verification checklist

- [ ] All 3 issues have green implementation
- [ ] Container rebuilds without errors
- [ ] Server starts and reports healthy
- [ ] AC-001 through AC-010 all pass
- [ ] No new console errors in browser
- [ ] No new server log errors
- [ ] Existing features (memories CRUD, search, tags, pagination) still work
- [ ] Server logs clean after all tests

## Stop conditions

- All acceptance criteria pass
- No new errors introduced
- Container rebuild and E2E verification complete

## Handoff notes

- The fixer implementing ISSUE-001 should check the next migration number in `src/services/storage/postgres/migrations.ts` before writing the migration
- The `handleGetUserProfile` function already returns profile data — just ensure the nickname column is included in the SELECT query
- The `fetchAPI` helper in app.js already handles auth headers — no changes needed there
- Consider adding `web-server-worker.ts` route for the new nickname endpoint as a follow-up (not blocking)

## Reminder / follow-up state

- **Follow-up 1**: Add `PUT /api/user-profile/nickname` route to `web-server-worker.ts` (low priority)
- **Follow-up 2**: Add i18n translations for "Settings" title when auth disabled (if i18n coverage is desired)
- **Follow-up 3**: Consider adding input length validation UI hint for nickname field (max 100 chars)
