# Codebase Audit Fix Design

## Source artifacts

- ISSUES.md: .opencode/orchestrator/CodebaseAudit/01/ISSUES.md
- FIX_SPEC.md: .opencode/orchestrator/CodebaseAudit/01/FIX_SPEC.md

## Design overview

The fix addresses three independent issues:

1. **Profile-level nickname storage** — Move nickname from the clients table to the user_profiles table, with a new API endpoint and updated frontend logic
2. **Settings panel conditional text** — Dynamically update settings title and note visibility based on auth mode
3. **Maintenance Jobs button label** — Add visible text to the existing icon-only button

## Affected components

| Component          | Files                                                 | Changes                                                                                                 |
| ------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Database schema    | `src/services/storage/postgres/migrations.ts`         | New migration adding `nickname` column to `user_profiles`                                               |
| Profile repository | `src/services/storage/postgres/profile-repository.ts` | Add `setNickname()` method, update `getActiveProfile()` to include nickname                             |
| Profile types      | `src/services/storage/types.ts`                       | Add `nickname` to `UserProfileRow` interface                                                            |
| API handlers       | `src/services/api-handlers.ts`                        | New `handleSetProfileNickname()` handler, update `handleGetUserProfile()` response                      |
| Web server routes  | `src/services/web-server.ts`                          | Add `PUT /api/user-profile/nickname` route                                                              |
| Frontend JS        | `src/web/app.js`                                      | Rewrite `loadNickname()`, `saveNickname()`, fix settings-toggle handler, add auth-mode title/note logic |
| Frontend HTML      | `src/web/index.html`                                  | Add text span to `#job-drawer-toggle` button                                                            |
| Frontend CSS       | `src/web/style.css`                                   | Style adjustment for icon+text button layout                                                            |

## Proposed corrections

### DES-001: Add nickname column to user_profiles table

**Migration in `src/services/storage/postgres/migrations.ts`:**

```sql
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS nickname TEXT DEFAULT NULL;
```

Update `UserProfileRow` interface in `src/services/storage/types.ts` to include `nickname?: string | null`.

Update `profile-repository.ts`:

- `getActiveProfile()` SELECT query: add `nickname` to the column list
- New method `setNickname(userId: string, nickname: string): Promise<boolean>`:
  ```sql
  UPDATE user_profiles SET nickname = $1 WHERE user_id = $2
  ```

### DES-002: New API endpoint PUT /api/user-profile/nickname

**In `src/services/api-handlers.ts`:**

```typescript
export async function handleSetProfileNickname(data: {
  userId?: string;
  nickname: string;
}): Promise<ApiResponse<{ nickname: string }>> {
  // If userId not provided, find the active profile
  // Update nickname via profileRepo.setNickname()
  // Return success with the saved nickname
}
```

**In `src/services/web-server.ts`:**

```typescript
if (path === "/api/user-profile/nickname" && method === "PUT") {
  const body = await this.parseBody(req);
  const result = await handleSetProfileNickname(body);
  return this.jsonResponse(result);
}
```

**In `src/services/api-handlers.ts` — update `handleGetUserProfile()`:**

- Ensure the response includes `nickname` field from the profile row

### DES-003: Rewrite frontend nickname functions

**In `src/web/app.js` — rewrite `loadNickname()`:**

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

**In `src/web/app.js` — rewrite `saveNickname()`:**

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

Key change: no longer depends on `state.activeProfileId` or `clientId`. The server determines the active profile.

### DES-004: Fix settings-toggle handler sequencing

**In `src/web/app.js` — settings-toggle click handler (around line 1623):**

```javascript
document.getElementById("settings-toggle").addEventListener("click", async () => {
  document.getElementById("settings-panel").classList.toggle("hidden");
  if (!document.getElementById("settings-panel").classList.contains("hidden")) {
    await populateProfileDropdown();
    await loadNickname();
  }
});
```

Key change: both calls are `await`ed, guaranteeing `loadNickname()` runs after profile data is available.

### DES-005: Conditional settings panel title and note

**In `src/web/app.js` — inside the auth-disabled handler (around line 1700):**

```javascript
// After hiding API key and profile fields:
document.querySelector('#settings-panel h3[data-i18n="settings-title"]').textContent = "Settings";
document.querySelector(".settings-note").style.display = "none";
```

When auth is enabled, the default HTML ("API Settings" title, visible note) remains unchanged.

### DES-006: Maintenance Jobs button text

**In `src/web/index.html` — update `#job-drawer-toggle`:**

```html
<button id="job-drawer-toggle" class="job-drawer-toggle" title="Maintenance Jobs">
  <i data-lucide="chevron-up" class="icon"></i>
  <span>Maintenance Jobs</span>
</button>
```

**In `src/web/style.css` — update `.job-drawer-toggle`:**

```css
.job-drawer-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  /* existing styles */
}
```

## Issue / requirement / design mapping

| Issue     | Requirements                                                                    | Design items                       |
| --------- | ------------------------------------------------------------------------------- | ---------------------------------- |
| ISSUE-001 | REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-014 | DES-001, DES-002, DES-003, DES-004 |
| ISSUE-002 | REQ-009, REQ-010, REQ-011                                                       | DES-005                            |
| ISSUE-003 | REQ-012, REQ-013                                                                | DES-006                            |

## Test design

### Manual E2E tests (browser):

1. Open Settings with auth disabled → title "Settings", no localStorage note
2. Enter nickname "test-device" → Save → success toast
3. Reopen Settings → nickname field shows "test-device"
4. Clear nickname → Save → reopen → field blank
5. Check Maintenance Jobs button shows "^ Maintenance Jobs"
6. Click Maintenance Jobs button → drawer opens
7. Reload page → Settings still shows correct title/note behavior

### API tests (curl):

1. `PUT /api/user-profile/nickname {"nickname":"test"}` → 200 success
2. `GET /api/user-profile` → response includes `nickname: "test"`
3. `PUT /api/user-profile/nickname {"nickname":""}` → 200 success (clears nickname)
4. `PUT /api/user-profile/nickname` (no body) → 400 error

## Data/config/schema impact

- **Schema**: New nullable `nickname TEXT` column on `user_profiles` table
- **Migration**: Additive only — no data loss, no column removal
- **Config**: No configuration changes required

## Security impact

- The new `PUT /api/user-profile/nickname` endpoint should respect the same auth model as existing profile endpoints
- No sensitive data exposed — nickname is a user-chosen display label
- Input should be length-limited to prevent abuse (suggest max 100 chars)

## Compatibility impact

- The existing `PUT /api/client/nickname` endpoint remains functional (not removed)
- The `clients` table and `clientRepo.setNickname()` are unchanged
- No breaking API changes

## Migration/rollback notes

- **Rollback**: Drop the `nickname` column from `user_profiles` and revert the frontend changes
- **Migration forward**: `ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS nickname TEXT DEFAULT NULL;`
- The migration is safe and idempotent (`IF NOT EXISTS`)

## Risks and mitigations

| Risk                                                    | Severity | Mitigation                                                |
| ------------------------------------------------------- | -------- | --------------------------------------------------------- |
| Profile repository queries need updating for new column | Low      | Add column to all relevant SELECT statements              |
| Settings toggle handler race condition                  | Medium   | Use `await` for sequential execution                      |
| Nickname length abuse                                   | Low      | Add server-side length validation (max 100 chars)         |
| web-server-worker.ts missing new route                  | Low      | Can be added later; primary deployment uses web-server.ts |

## Alternatives considered

1. **Store nickname in clients table, fix ID mapping** — Rejected because it requires maintaining a mapping between profiles and clients, adding complexity.
2. **Store nickname in localStorage only** — Rejected because it doesn't persist across devices/browsers.
3. **Add nickname to user_profiles profile_data JSONB** — Rejected because querying JSONB is less efficient than a dedicated column.
