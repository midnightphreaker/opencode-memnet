# DESIGN.md — Issue #15: Technical Design

## Overview

This design wires the existing dead-code job queue service (`memory-maintenance-job-service.ts`) into the HTTP layer, adds a unified job status API endpoint, and builds three new frontend components (confirmation modal, status bar, status drawer) to replace the synchronous cleanup/deduplication flow with an asynchronous, visually integrated job system. The tag migration service's running state is also surfaced through the shared status model.

The approach is **minimal-backend-change / maximal-frontend-UX**: the backend job service already has all queue logic; we import it, call `enqueueJob()` from route handlers, and expose `getJobStatus()` via a new endpoint. The frontend replaces `confirm()` with a styled modal, adds a persistent status bar at the screen bottom, and provides a right-side drawer for detailed job inspection — all using vanilla HTML/CSS/JS with the existing dark theme.

## Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          BROWSER (WebUI)                            │
│                                                                     │
│  ┌──────────┐   ┌──────────────┐   ┌─────────────────────────────┐ │
│  │ Cleanup  │──▶│  Confirm     │──▶│  runCleanup() /             │ │
│  │ Button   │   │  Modal       │   │  runDeduplication()         │ │
│  └──────────┘   └──────────────┘   │  → POST /api/cleanup        │ │
│  ┌──────────┐                      │  → POST /api/deduplicate    │ │
│  │ Dedup    │──▶ (same modal)      └──────────┬──────────────────┘ │
│  │ Button   │                                  │                   │
│  └──────────┘                                  │ enqueue response  │
│                                                │ (immediate)       │
│  ┌─────────────────────────────────────────────▼─────────────────┐ │
│  │                  Job Polling System                            │ │
│  │  GET /api/jobs/memory  ◀── setInterval (2s active / 5s idle) │ │
│  │       │                                                       │ │
│  │       ├──▶ Status Bar (indicator + text + drawer toggle)      │ │
│  │       ├──▶ Job Drawer (current / queued / history)            │ │
│  │       └──▶ Toast (completion / failure / conflict)            │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌──────────────────┐                                               │
│  │ Enhanced Toast   │  ◀── triggered by poll transitions           │
│  │ (icon + color)   │      and enqueue responses                   │
│  └──────────────────┘                                               │
└──────────────────────────────────────┬──────────────────────────────┘
                                       │ HTTP
┌──────────────────────────────────────▼──────────────────────────────┐
│                     SERVER (web-server.ts / worker)                  │
│                                                                      │
│  ┌─────────────────┐   ┌────────────────────────────────────────┐  │
│  │ POST /api/      │   │ memory-maintenance-job-service.ts      │  │
│  │   cleanup       │──▶│   enqueueJob("cleanup_memories",scope) │  │
│  │   deduplicate   │──▶│   enqueueJob("deduplicate_memories",..)│  │
│  └─────────────────┘   │                                       │  │
│                         │   processQueue() loop                  │  │
│  ┌─────────────────┐   │     ├── executeCleanupJob()             │  │
│  │ GET /api/jobs/  │   │     │     └── handleCleanup()          │  │
│  │   memory        │◀──│     ├── executeDeduplicateJob()         │  │
│  └─────────────────┘   │     │     └── handleDeduplicate()      │  │
│                         │     └── getTagMigrationVirtualJob()     │  │
│                         │          └── tag-migration-service      │  │
│                         └────────────────────────────────────────┘  │
│                                                                      │
│  ┌─────────────────────────┐                                        │
│  │ api-handlers.ts         │                                        │
│  │   handleCleanup()       │◀── called by job executors            │
│  │   handleDeduplicate()   │    (guards bypassed via skipGuard)    │
│  └─────────────────────────┘                                        │
└──────────────────────────────────────────────────────────────────────┘
```

### Data Flow

**Cleanup Button Click → Completion Toast:**

```
1. User clicks #cleanup-btn
2. runCleanup() opens confirm-modal with title "Run Cleanup?" and desc text
3. User clicks Confirm → modal closes
4. runCleanup() calls POST /api/cleanup
5. Route handler calls enqueueJob("cleanup_memories", scope)
6. enqueueJob pushes to queue, starts processQueue() loop (if not running)
7. HTTP response returns immediately: { success: true, data: { jobId, status: "queued", ... } }
8. Frontend shows info toast: "Job queued successfully"
9. Frontend polling (already running) picks up the new job on next cycle
10. processQueue() calls executeCleanupJob() → handleCleanup(skipGuard=true)
11. handleCleanup runs to completion, returns result
12. executeCleanupJob stores summary on job object, moves to history
13. Next poll: frontend sees current changed (running→null), history[0] is completed
14. Frontend shows success toast with summary, calls loadMemories() + loadStats()
15. Status bar indicator returns to gray, text returns to "Idle"
```

## Backend Design

### B1: Job Service Integration

**File:** `src/services/web-server.ts` and `src/services/web-server-worker.ts`

**Import strategy:** Add a dynamic import of `memory-maintenance-job-service.ts` at the top of the route handler section (or use top-level static import). The job service is a pure module with no constructor or initialization — its state is module-level singletons. No lifecycle management needed.

**In `web-server.ts`** — add to the existing import block from `api-handlers.js`:
```typescript
// At top, add import:
import {
  enqueueJob,
  getJobStatus,
  getTagMigrationVirtualJob,
} from "./memory-maintenance-job-service.js";
```

The functions `enqueueJob`, `getJobStatus`, and `getTagMigrationVirtualJob` are all named exports from the job service module. No class instantiation required.

**In `web-server-worker.ts`** — add the same import at the top:
```typescript
import {
  enqueueJob,
  getJobStatus,
  getTagMigrationVirtualJob,
} from "./memory-maintenance-job-service.js";
```

No initialization or teardown needed — the module's `processQueue()` loop is fire-and-forget (started by `enqueueJob` when the first job is enqueued). The in-memory queue is per-process, which is acceptable for single-process mode.

### B2: Route Handler Changes

**In `web-server.ts` (lines 382-390):**

**BEFORE:**
```typescript
if (path === "/api/cleanup" && method === "POST") {
  const result = await handleCleanup();
  return this.jsonResponse(result);
}

if (path === "/api/deduplicate" && method === "POST") {
  const result = await handleDeduplicate();
  return this.jsonResponse(result);
}
```

**AFTER:**
```typescript
if (path === "/api/cleanup" && method === "POST") {
  const scope = this.deriveJobScope();  // "all_profiles" or "current_profile"
  const result = enqueueJob("cleanup_memories", scope);
  if (!result.success) {
    return this.jsonResponse(
      { success: false, error: result.error, code: result.code },
      409
    );
  }
  return this.jsonResponse({
    success: true,
    data: {
      jobId: result.data!.id,
      status: result.data!.status,
      type: result.data!.type,
      message: "Job queued successfully",
    },
  });
}

if (path === "/api/deduplicate" && method === "POST") {
  const scope = this.deriveJobScope();
  const result = enqueueJob("deduplicate_memories", scope);
  if (!result.success) {
    return this.jsonResponse(
      { success: false, error: result.error, code: result.code },
      409
    );
  }
  return this.jsonResponse({
    success: true,
    data: {
      jobId: result.data!.id,
      status: result.data!.status,
      type: result.data!.type,
      message: "Job queued successfully",
    },
  });
}
```

**In `web-server-worker.ts` (lines 291-299):**

**BEFORE:**
```typescript
if (path === "/api/cleanup" && method === "POST") {
  const result = await handleCleanup();
  return jsonResponse(result);
}

if (path === "/api/deduplicate" && method === "POST") {
  const result = await handleDeduplicate();
  return jsonResponse(result);
}
```

**AFTER:** Same logic as web-server.ts but using the module-level `jsonResponse()` function and a module-level `deriveJobScope()` helper instead of `this.deriveJobScope()`.

**Helper function** (added to both files):
```typescript
// In web-server.ts, add as private method on WebServer class:
private deriveJobScope(): "all_profiles" | "current_profile" {
  return this.disableWebuiAuth ? "all_profiles" : "current_profile";
}

// In web-server-worker.ts, add as module-level function:
function deriveJobScope(): "all_profiles" | "current_profile" {
  return disableWebuiAuth ? "all_profiles" : "current_profile";
}
```

The imports of `handleCleanup` and `handleDeduplicate` can remain in the import block (they're still used transitively via the job service's dynamic imports). However, they are no longer called directly from route handlers — the job service's `executeCleanupJob` and `executeDeduplicateJob` functions import them dynamically via `await import("./api-handlers.js")`.

### B3: New API Endpoint — GET /api/jobs/memory

**In `web-server.ts`** — add after the existing `/api/cleanup` handler block (around line 391):

```typescript
if (path === "/api/jobs/memory" && method === "GET") {
  const status = getJobStatus();

  // Merge tag migration virtual job if running
  const tagJob = await getTagMigrationVirtualJob();
  if (tagJob && !status.current) {
    // No queue job running — tag migration takes the current slot
    status.current = tagJob;
    status.activity.active = true;
    status.activity.text = `Tag Untagged in progress...`;
  } else if (tagJob && status.current) {
    // Both running — queue job takes priority for display,
    // but tag migration appears in activity text if queue is idle
    // (already handled by getJobStatus priority logic)
  }

  return this.jsonResponse({ success: true, data: status });
}
```

**In `web-server-worker.ts`** — add the same route handler after the `/api/deduplicate` block (around line 300):

```typescript
if (path === "/api/jobs/memory" && method === "GET") {
  const status = getJobStatus();

  const tagJob = await getTagMigrationVirtualJob();
  if (tagJob && !status.current) {
    status.current = tagJob;
    status.activity.active = true;
    status.activity.text = `Tag Untagged in progress...`;
  }

  return jsonResponse({ success: true, data: status });
}
```

**Request format:**
```
GET /api/jobs/memory
Authorization: Bearer <api-key>  (unless auth disabled)
```

**Response format** (see API Contract section for full examples):
```json
{
  "success": true,
  "data": {
    "activity": { "active": false, "text": "Idle", "queuedCount": 0 },
    "current": null,
    "queued": [],
    "history": []
  }
}
```

**Data mapping:** The response is a direct pass-through of `getJobStatus()` return value (type `JobStatusResponse`), with optional tag migration virtual job merged in. No transformation needed.

### B4: Auth-Derived Scope Logic

**Where the logic lives:**
- `web-server.ts`: Private method `deriveJobScope()` on the `WebServer` class
- `web-server-worker.ts`: Module-level function `deriveJobScope()`

**Logic:**
```typescript
function deriveJobScope(): "all_profiles" | "current_profile" {
  // When DISABLE_WEBUI_AUTH is true (disableWebuiAuth flag),
  // there's no authenticated user context, so operations run across all profiles.
  // When auth is enabled, scope to the current authenticated user's profile.
  return disableWebuiAuth ? "all_profiles" : "current_profile";
}
```

This logic mirrors the existing behavior: both `handleCleanup()` and `handleDeduplicate()` currently operate on all memories regardless of profile (they don't filter by `userEmail`). The `all_profiles` scope preserves this behavior. The `current_profile` scope is future-ready for when auth-scoped operations are needed.

**Note:** The job service's `isConflict()` already checks scope, so even in `all_profiles` mode, only one cleanup job for `all_profiles` can run at a time.

### B5: Boolean Guard Resolution

**Problem:** `handleCleanup()` (api-handlers.ts:1392) and `handleDeduplicate()` (api-handlers.ts:1458) have `_cleanupInProgress` and `_dedupInProgress` boolean guards that reject concurrent calls. The job service's `processQueue()` loop calls these handlers, and if a second enqueue triggers while the first is running, the guard would reject the second handler call.

**Solution:** Add an optional `skipGuard` parameter to both functions:

**In `api-handlers.ts`:**

```typescript
// Line 1392 — change from:
export async function handleCleanup(): Promise<...> {
  if (_cleanupInProgress) {
    return { success: false, error: "Cleanup is already in progress" };
  }
  _cleanupInProgress = true;
  // ...
  finally { _cleanupInProgress = false; }
}

// Change to:
export async function handleCleanup(skipGuard = false): Promise<...> {
  if (!skipGuard && _cleanupInProgress) {
    return { success: false, error: "Cleanup is already in progress" };
  }
  if (!skipGuard) _cleanupInProgress = true;
  // ...
  if (!skipGuard) { _cleanupInProgress = false; }  // in finally block
}
```

Same pattern for `handleDeduplicate()`:
```typescript
// Line 1450 — change from:
export async function handleDeduplicate(): Promise<...> {
  if (_dedupInProgress) {
    return { success: false, error: "Deduplication is already in progress" };
  }
  _dedupInProgress = true;
  // ...
  finally { _dedupInProgress = false; }
}

// Change to:
export async function handleDeduplicate(skipGuard = false): Promise<...> {
  if (!skipGuard && _dedupInProgress) {
    return { success: false, error: "Deduplication is already in progress" };
  }
  if (!skipGuard) _dedupInProgress = true;
  // ...
  if (!skipGuard) { _dedupInProgress = false; }  // in finally block
}
```

**In `memory-maintenance-job-service.ts`:**

Update the executor functions to pass `skipGuard = true`:

```typescript
// Line 248 — executeCleanupJob:
const result = await handleCleanup(true);  // skip the boolean guard

// Line 274 — executeDeduplicateJob:
const result = await handleDeduplicate(true);  // skip the boolean guard
```

**Rationale:** The job service's own `_running` flag and `isConflict()` check provide equivalent protection. The boolean guards in api-handlers.ts were a simpler version of the same concept; the job queue supersedes them.

### B6: Tag Migration Status Integration

**Current state:** Tag migration runs as a perpetual background loop in `tag-migration-service.ts` with `getMigrationProgress()` returning `{ status, processed, total, errors }`. The frontend polls `/api/migration/tags/progress` every 2s (app.js:1421-1440) and updates `#migration-status-bar`.

**Integration approach:** The job service already has `getTagMigrationVirtualJob()` (line 175) which maps tag migration state into a `MemoryMaintenanceJob` object. The new `/api/jobs/memory` endpoint will call this function and merge the virtual job into the response.

**Merging logic** (in the route handler, see B3):
1. Get `JobStatusResponse` from `getJobStatus()`
2. Call `getTagMigrationVirtualJob()`
3. If tag migration is running AND no queue job is running (`status.current === null`), set the virtual job as `status.current` and update `activity.active = true`
4. If both are running, the queue job takes priority in `current` — the tag migration will appear when the queue job finishes
5. If tag migration is idle, no change

**Backward compatibility:** The existing `GET /api/migration/tags/progress` endpoint (api-handlers.ts:985-990) and frontend polling (app.js:1421-1440) remain unchanged. The frontend will eventually be updated to stop the old polling once the new status bar fully replaces the migration-status-bar, but during transition both work simultaneously.

### B7: Job History Retention

**Approach:** The job service already implements in-memory history with `MAX_HISTORY = 50` (line 52). Completed/failed jobs are moved from `currentJob` to the `history` array (line 219), which is capped at 50 entries (line 221).

**No changes needed** to the retention logic. The history is:
- Stored in module-level `let history: MemoryMaintenanceJob[] = []`
- Capped at `MAX_HISTORY = 50` entries
- Newest entries first (`history.unshift()`)
- Cleared on server restart (in-memory only, per NFR scope)

**Cleanup:** No explicit cleanup mechanism needed — the `if (history.length > MAX_HISTORY)` check in `processQueue()` handles it automatically.

## Frontend Design

### F1: Confirmation Modal Component

**Markup (added to `index.html` before `</body>`):**

```html
<!-- Confirm Modal (replaces browser confirm() for cleanup/dedup) -->
<div id="confirm-modal" class="modal hidden">
  <div class="modal-content confirm-modal-content">
    <div class="modal-header">
      <h3 id="confirm-modal-title"></h3>
    </div>
    <div class="confirm-modal-body">
      <p id="confirm-modal-desc"></p>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn-secondary" id="confirm-modal-cancel"></button>
      <button type="button" class="btn-primary btn-danger" id="confirm-modal-confirm"></button>
    </div>
  </div>
</div>
```

> **Note on data-i18n attributes:** Text content for the confirm modal is set imperatively via `t()` calls in JavaScript (see `openConfirmModal()` below). `data-i18n` attributes are **NOT used** for this dynamic content, consistent with the existing pattern where dynamic text (like memory content, stats, etc.) is set via JS rather than declarative attributes. This avoids stale translations when the modal is reused for different job types.

**CSS classes:** Reuses existing `.modal`, `.modal-content`, `.modal-header`, `.modal-actions` patterns from the edit-modal (styles.css:1004-1075). New class `.confirm-modal-content` constrains max-width to `420px`. New class `.confirm-modal-body` adds padding and `p` styling.

**Open/close behavior (in `app.js`):**
```javascript
// New state variable
let confirmModalResolver = null;

function openConfirmModal(titleKey, descKey) {
  return new Promise((resolve) => {
    confirmModalResolver = resolve;
    document.getElementById("confirm-modal-title").textContent = t(titleKey);
    document.getElementById("confirm-modal-desc").textContent = t(descKey);
    document.getElementById("confirm-modal-cancel").textContent = t("btn-cancel");
    document.getElementById("confirm-modal-confirm").textContent = t("btn-confirm");
    document.getElementById("confirm-modal").classList.remove("hidden");
  });
}

function closeConfirmModal(result) {
  document.getElementById("confirm-modal").classList.add("hidden");
  if (confirmModalResolver) {
    confirmModalResolver(result);
    confirmModalResolver = null;
  }
}
```

**Event listeners (in DOMContentLoaded):**
```javascript
document.getElementById("confirm-modal-cancel").addEventListener("click", () => closeConfirmModal(false));
document.getElementById("confirm-modal-confirm").addEventListener("click", () => closeConfirmModal(true));
document.getElementById("confirm-modal").addEventListener("click", (e) => {
  if (e.target.id === "confirm-modal") closeConfirmModal(false);  // backdrop click
});
// Escape key: extend existing keydown listener
```

**Keyboard handling:** The existing `document.addEventListener("keydown", ...)` at app.js:1380 handles Escape for settings panel and profile sheet. Extend it to also close the confirm modal:

```javascript
// In existing keydown handler:
if (e.key === "Escape") {
  document.getElementById("settings-panel").classList.add("hidden");
  closeProfileSheet();
  closeConfirmModal(false);  // Add this line
}
```

### F2: Job Status Bar Enhancement

**The existing `#migration-status-bar`** at index.html:341 will be **replaced** with a unified job status bar:

> **Note:** The existing `setInterval` at `app.js` ~1420-1440 that polls `/api/migration/tags/progress` must be **REMOVED entirely** since its HTML target (`#migration-status-bar`) is being replaced by `#job-status-bar`. The new job polling system (`startJobPolling()`) supersedes this old polling entirely.

```html
<div id="job-status-bar" class="job-status-bar">
  <span id="job-status-indicator" class="job-status-indicator"></span>
  <span id="job-status-text" class="job-status-text">Idle</span>
  <button id="job-drawer-toggle" class="job-drawer-toggle" title="Job Details">
    <i data-lucide="chevron-up" class="icon"></i>
  </button>
</div>
```

**CSS classes:**
- `.job-status-bar` — Replaces `.migration-status-bar`. Same fixed-bottom positioning, but with flex layout for indicator + text + button.
- `.job-status-indicator` — A 6px circle (`border-radius: 50%`) that is gray when idle, green (#39ff14) when active. Active state has a CSS `pulse` animation.
- `.job-status-text` — Uses `--foreground-soft` color, 10px font, uppercase, letter-spacing.
- `.job-drawer-toggle` — Small button, `icon-btn` style, 24x24px.

**Indicator circle styling:**
```css
.job-status-indicator {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--faint-foreground);
  flex-shrink: 0;
  transition: background 0.3s;
}

.job-status-indicator.active {
  background: #39ff14;
  animation: pulse 1.5s ease-in-out infinite;
}
```

**Text priority logic** (in JavaScript, updated on each poll):
```javascript
function updateStatusBar(data) {
  const indicator = document.getElementById("job-status-indicator");
  const textEl = document.getElementById("job-status-text");

  const active = data.activity.active;
  indicator.classList.toggle("active", active);

  // Use activity.text from backend (already has priority logic in getJobStatus)
  textEl.textContent = t("job-status-" + mapActivityTextToKey(data));
}
```

**`mapActivityTextToKey()` definition** — maps structured job data to an i18n key suffix:

```javascript
function mapActivityTextToKey(data) {
  if (!data.activity.active) {
    // Check for recent unannounced failure in history
    if (data.history?.some(j => j.status === "failed" && !j._seen)) {
      const failed = data.history.find(j => j.status === "failed" && !j._seen);
      return failed?.type === "cleanup_memories"
        ? "job-status-cleanup-failed"
        : "job-status-dedup-failed";
    }
    return "job-status-idle";
  }
  if (data.current?.type === "cleanup_memories") return "job-status-cleanup-running";
  if (data.current?.type === "deduplicate_memories") return "job-status-dedup-running";
  if (data.current?.type === "tag_untagged_memories") return "job-status-tag-running";
  if (data.activity.queuedCount > 0) return "job-status-queued";
  return "job-status-idle";
}
```

> **Note on `{count}` placeholder:** The key `"job-status-queued"` has the value `"{count} job(s) queued"`. When this key is selected, the caller must replace `{count}` with `data.activity.queuedCount` before setting `textContent`. This can be handled with: `textEl.textContent = t("job-status-queued").replace("{count}", data.activity.queuedCount);`

The backend's `getJobStatus()` already implements priority: running job progress > queued count > recent failure > "Idle". The frontend maps the activity text to i18n keys. For dynamic values (e.g., "Cleanup memories 42/100..."), the backend provides the formatted text directly; the frontend passes it through with a `t()` call only for static strings like "Idle".

### F3: Job Status Drawer Component

**Markup (added to `index.html` before `</body>`):**

```html
<!-- Job Status Drawer (right-side slide-in) -->
<div id="job-drawer" class="sheet-overlay">
  <div class="sheet-panel job-drawer-panel">
    <div class="sheet-header">
      <h3 data-i18n="drawer-title">MAINTENANCE JOBS</h3>
      <button id="job-drawer-close" class="icon-btn">
        <i data-lucide="x" class="icon"></i>
      </button>
    </div>
    <div class="sheet-body">
      <!-- Current Job Section -->
      <div class="drawer-section">
        <h4 data-i18n="drawer-section-current">CURRENT</h4>
        <div id="drawer-current" class="drawer-current">
          <div class="drawer-empty" data-i18n="job-status-idle">Idle</div>
        </div>
      </div>

      <!-- Queued Jobs Section -->
      <div class="drawer-section">
        <h4 data-i18n="drawer-section-queued">QUEUED</h4>
        <div id="drawer-queued" class="drawer-queued">
          <div class="drawer-empty" data-i18n="drawer-no-queued">No queued jobs</div>
        </div>
      </div>

      <!-- History Section -->
      <div class="drawer-section">
        <h4 data-i18n="drawer-section-history">HISTORY</h4>
        <div id="drawer-history" class="drawer-history">
          <div class="drawer-empty" data-i18n="drawer-no-history">No recent jobs</div>
        </div>
      </div>
    </div>
  </div>
</div>
```

**CSS:** Reuses `.sheet-overlay`, `.sheet-panel`, `.sheet-header`, `.sheet-body` from the profile-sheet (styles.css:1102-1155). New class `.job-drawer-panel` with `width: 360px` (narrower than profile sheet's 480px).

**New CSS classes:**
- `.drawer-section` — Section container with border-bottom separator
- `.drawer-section h4` — Section heading, reuses `.dashboard-section h4` styling
- `.drawer-current` — Container for current job card
- `.drawer-queued` — Container for queued job list items
- `.drawer-history` — Container for history job list items
- `.drawer-empty` — Empty state text, uses `--faint-foreground`
- `.drawer-job-card` — Individual job card with type badge, status, time
- `.drawer-job-card.completed` — Green left border
- `.drawer-job-card.failed` — Red left border
- `.drawer-job-card.running` — Animated left border (pulse)

**Open/close behavior:**
```javascript
function openJobDrawer() {
  document.getElementById("job-drawer").classList.add("sheet-open");
}

function closeJobDrawer() {
  document.getElementById("job-drawer").classList.remove("sheet-open");
}
```

**Event listeners:**
```javascript
document.getElementById("job-drawer-toggle").addEventListener("click", openJobDrawer);
document.getElementById("job-drawer-close").addEventListener("click", closeJobDrawer);
document.getElementById("job-drawer").addEventListener("click", (e) => {
  if (e.target.id === "job-drawer") closeJobDrawer();
});
```

**Escape key:** Extend existing keydown handler to close drawer.

**Content rendering** (called on each poll):
```javascript
function renderDrawerContent(data) {
  renderCurrentJob(data.current);
  renderQueuedJobs(data.queued);
  renderHistoryJobs(data.history);
}

function jobTypeLabel(type) {
  const labels = {
    cleanup_memories: "Cleanup",
    deduplicate_memories: "Deduplicate",
    tag_untagged_memories: "Tag Untagged",
  };
  return labels[type] || type;
}

function renderCurrentJob(job) {
  const container = document.getElementById("drawer-current");
  if (!job) {
    container.innerHTML = `<div class="drawer-empty">${t("job-status-idle")}</div>`;
    return;
  }
  const label = jobTypeLabel(job.type);
  const progress = job.totalItems
    ? `${job.processedItems || 0}/${job.totalItems}`
    : "";
  container.innerHTML = `
    <div class="drawer-job-card running">
      <div class="drawer-job-header">
        <span class="badge badge-job-type">${escapeHtml(label)}</span>
        <span class="drawer-job-status running">
          <i data-lucide="loader" class="icon icon-spin"></i> Running
        </span>
      </div>
      ${progress ? `<div class="drawer-job-progress">${progress}</div>` : ""}
      <div class="drawer-job-time">${formatDate(job.startedAt || job.createdAt)}</div>
    </div>`;
  lucide.createIcons();
}
```

Similar render functions for queued and history sections, with appropriate status badges (completed = green check, failed = red X).

### F4: Button Handler Changes

**New `runCleanup()` function (replaces app.js:768-781):**

```javascript
async function runCleanup() {
  // Check if cleanup job already running/queued (frontend guard)
  if (isJobTypeActive("cleanup_memories")) return;

  const confirmed = await openConfirmModal(
    "modal-confirm-cleanup-title",
    "modal-confirm-cleanup-desc"
  );
  if (!confirmed) return;

  const result = await fetchAPI("/api/cleanup", { method: "POST" });

  if (result.success) {
    showToast(t("job-queued"), "info");
    // Trigger immediate poll to update status bar
    pollJobStatus();
  } else if (result.code === "JOB_ALREADY_QUEUED_OR_RUNNING") {
    showToast(t("job-already-running"), "error");
  } else {
    showToast(result.error || t("toast-cleanup-failed"), "error");
  }
}
```

**New `runDeduplication()` function (replaces app.js:783-800):**

```javascript
async function runDeduplication() {
  if (isJobTypeActive("deduplicate_memories")) return;

  const confirmed = await openConfirmModal(
    "modal-confirm-dedup-title",
    "modal-confirm-dedup-desc"
  );
  if (!confirmed) return;

  const result = await fetchAPI("/api/deduplicate", { method: "POST" });

  if (result.success) {
    showToast(t("job-queued"), "info");
    pollJobStatus();
  } else if (result.code === "JOB_ALREADY_QUEUED_OR_RUNNING") {
    showToast(t("job-already-running"), "error");
  } else {
    showToast(result.error || t("toast-dedup-failed"), "error");
  }
}
```

**Helper function:**
```javascript
function isJobTypeActive(type) {
  // Check if a job of the given type is running or queued
  return (
    (state.lastJobStatus.current?.type === type &&
     state.lastJobStatus.current?.status === "running") ||
    state.lastJobStatus.queued.some(j => j.type === type)
  );
}
```

### F5: Job Polling System

**State tracking (added to `state` object in app.js):**
```javascript
// Add to state object:
lastJobStatus: { activity: { active: false, text: "Idle", queuedCount: 0 }, current: null, queued: [], history: [] },
lastSeenJobId: null,      // Track last running job ID for toast dedup
lastSeenJobStatus: null,  // Track last running job status for transition detection
jobPollTimer: null,       // setInterval reference
```

**Poll function:**
```javascript
async function pollJobStatus() {
  try {
    const result = await fetchAPI("/api/jobs/memory");
    if (!result.success) {
      // 401 = auth error, stop polling
      if (result.error?.includes("401") || result.error?.includes("Unauthorized")) {
        stopJobPolling();
      }
      return;
    }

    const data = result.data;
    const prev = state.lastJobStatus;

    // Detect job state transitions for toasts
    handleJobTransitions(prev, data);

    // Update state
    state.lastJobStatus = data;

    // Update status bar
    updateStatusBar(data);

    // Update drawer if open
    if (document.getElementById("job-drawer").classList.contains("sheet-open")) {
      renderDrawerContent(data);
    }

    // Update button disabled states
    updateButtonStates(data);

    // Adjust polling interval
    adjustPollInterval(data.activity.active);

  } catch (e) {
    // Network error — don't crash, retry on next interval
    console.warn("Job poll error:", e);
  }
}
```

**Transition detection (toast deduplication):**
```javascript
function handleJobTransitions(prev, curr) {
  // Detect: running → completed/failed (current was non-null, now null or different job)
  if (prev.current && prev.current.status === "running") {
    // Check if the previous current job is now in history
    const prevJobId = prev.current.id;
    const completedJob = curr.history.find(j => j.id === prevJobId);

    if (completedJob) {
      if (completedJob.status === "completed") {
        const summary = completedJob.summary || t("toast-cleanup-success");
        showToast(truncateText(summary, 240), "success");
        // Refresh memories/stats on completion
        loadMemories();
        loadStats();
      } else if (completedJob.status === "failed") {
        const error = completedJob.error || t("toast-cleanup-failed");
        showToast(truncateText(error, 240), "error");
      }
    }
  }

  // Detect: new job started running (current changed to a different running job)
  // No toast needed — status bar update is sufficient
}
```

**Poll interval management:**
```javascript
function adjustPollInterval(isActive) {
  const desiredInterval = isActive ? 2000 : 5000;
  if (state.jobPollInterval !== desiredInterval) {
    state.jobPollInterval = desiredInterval;
    clearInterval(state.jobPollTimer);
    state.jobPollTimer = setInterval(pollJobStatus, desiredInterval);
  }
}

function startJobPolling() {
  if (state.jobPollTimer) return;
  state.jobPollInterval = 5000;
  state.jobPollTimer = setInterval(pollJobStatus, 5000);
  pollJobStatus();  // Initial poll immediately
}

function stopJobPolling() {
  if (state.jobPollTimer) {
    clearInterval(state.jobPollTimer);
    state.jobPollTimer = null;
  }
}
```

**Initialization:** Call `startJobPolling()` in the DOMContentLoaded handler, after auth check and initial data load (after line 1407 in app.js).

**Button state update:**
```javascript
function updateButtonStates(data) {
  const cleanupBtn = document.getElementById("cleanup-btn");
  const dedupBtn = document.getElementById("deduplicate-btn");

  const cleanupActive = isJobTypeActive("cleanup_memories");
  const dedupActive = isJobTypeActive("deduplicate_memories");

  cleanupBtn.disabled = cleanupActive;
  dedupBtn.disabled = dedupActive;
}
```

**DOM optimization:** Only update DOM elements when data has actually changed. Simple approach: stringify the previous and current `activity` and `current` objects and compare before updating DOM.

### F6: Toast Enhancement

**Enhanced `showToast()` function (replaces app.js:707-718):**

> **Note:** `truncateText()` is a **module-level** utility function, NOT nested inside `showToast()`. Both `showToast()` and `handleJobTransitions()` call it. It is defined at module scope alongside other utility functions like `escapeHtml()`.

```javascript
let toastTimer = null;

function truncateText(text, maxLength) {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + "...";
}

function showToast(message, type = "success") {
  if (toastTimer) clearTimeout(toastTimer);
  const toast = document.getElementById("toast");
  const truncatedMsg = truncateText(message, 240);

  // Icon mapping using Lucide icon names
  const icons = {
    success: "check-circle",
    error: "x-circle",
    info: "info",
  };
  const iconName = icons[type] || icons.info;

  toast.innerHTML = `<i data-lucide="${iconName}" class="toast-icon toast-icon-${type}"></i> <span class="toast-message">${escapeHtml(truncatedMsg)}</span>`;
  toast.className = `toast ${type}`;
  toast.classList.remove("hidden");
  lucide.createIcons({ nodes: [toast] });  // Only process toast's new icons

  toastTimer = setTimeout(() => {
    toast.classList.add("hidden");
    toastTimer = null;
  }, 3000);
}
```

**Toast icon styling:** Each type has a different accent color on the icon:
```css
.toast-icon-success { color: #00FF00; }
.toast-icon-error { color: var(--danger); }
.toast-icon-info { color: var(--primary-bright); }
```

> **Note:** The success toast uses explicit hex color `#00FF00` (pure green) rather than `var(--success)` (#35e49d, a muted teal-green). This matches FR-8.2's requirement for a visually distinct success indication. The CSS variable `--success` remains used elsewhere (drawer-job-card borders, etc.) but is NOT used for toast coloring.

**Toast layout change:**
```css
.toast {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toast-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.toast-message {
  flex: 1;
}
```

**Position:** Already bottom-right (`bottom: 40px; right: 20px;` in styles.css:1079-1080). No change needed.

### F7: i18n Keys

**Complete list of new translation keys** (added to both `en` and `zh` objects in `src/web/i18n.js`):

| Key | EN Value | ZH Value |
|-----|----------|----------|
| `modal-confirm-cleanup-title` | "Run Cleanup?" | "运行清理？" |
| `modal-confirm-dedup-title` | "Run Deduplication?" | "运行去重？" |
| `modal-confirm-cleanup-desc` | "This will remove all memories that are no longer relevant. Continue?" | "这将删除所有不再相关的记忆。是否继续？" |
| `modal-confirm-dedup-desc` | "This will merge duplicate or highly similar memories. Continue?" | "这将合并重复或高度相似的记忆。是否继续？" |
| `btn-confirm` | "Confirm" | "确认" |
| `job-status-idle` | "Idle" | "空闲" |
| `job-status-cleanup-running` | "Cleanup in progress..." | "清理进行中..." |
| `job-status-dedup-running` | "Deduplication in progress..." | "去重进行中..." |
| `job-status-tag-running` | "Tag Untagged in progress..." | "标签迁移进行中..." |
| `job-status-queued` | "{count} job(s) queued" | "{count} 个任务排队中" |
| `job-status-cleanup-failed` | "Cleanup failed" | "清理失败" |
| `job-status-dedup-failed` | "Deduplication failed" | "去重失败" |
| `job-queued` | "Job queued successfully" | "任务已加入队列" |
| `job-already-running` | "Job is already queued or running" | "任务已在队列中或正在运行" |
| `drawer-title` | "MAINTENANCE JOBS" | "维护任务" |
| `drawer-section-current` | "CURRENT" | "当前" |
| `drawer-section-queued` | "QUEUED" | "排队中" |
| `drawer-section-history` | "HISTORY" | "历史" |
| `drawer-no-queued` | "No queued jobs" | "无排队任务" |
| `drawer-no-history` | "No recent jobs" | "无最近任务" |
| `drawer-job-completed` | "Completed" | "已完成" |
| `drawer-job-failed` | "Failed" | "失败" |

**Note on `drawer-title`, `drawer-section-*`:** These follow the existing pattern of uppercase section headers in the app (compare `section-project`, `section-profile`). The EN values use uppercase for consistency with the existing dark dashboard UI.

## CSS Design

### C1: New CSS Variables

Add to `:root` in styles.css:

```css
:root {
  /* ... existing variables ... */

  /* Job status colors */
  --job-active: #39ff14;
  --job-idle: var(--faint-foreground);
  --job-success: var(--success);
  --job-failed: var(--danger);
}
```

### C2: New Selectors

```css
/* ── Confirm Modal ── */
.confirm-modal-content {
  max-width: 420px;
}

.confirm-modal-body {
  padding: 16px 24px;
}

.confirm-modal-body p {
  color: var(--foreground-soft);
  font-size: 11px;
  line-height: 1.6;
}

.btn-danger {
  background: var(--danger);
  border-color: var(--danger);
  color: var(--foreground);
}

.btn-danger:hover:not(:disabled) {
  background: #e85d6e;
  border-color: #e85d6e;
}

/* ── Job Status Bar (replaces .migration-status-bar) ── */
.job-status-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 28px;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--card);
  border-top: 1px solid var(--border);
  padding: 0 12px;
  z-index: 200;
  font-family: var(--font-main);
  font-size: 10px;
  letter-spacing: 0.04em;
}

.job-status-indicator {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--job-idle);
  flex-shrink: 0;
  transition: background 0.3s;
}

.job-status-indicator.active {
  background: var(--job-active);
  animation: pulse 1.5s ease-in-out infinite;
}

.job-status-text {
  color: var(--foreground-soft);
  flex: 1;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.job-drawer-toggle {
  width: 24px;
  height: 24px;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--muted-foreground);
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
}

.job-drawer-toggle:hover {
  background: var(--card-raised);
  color: var(--foreground);
}

.job-drawer-toggle .icon {
  width: 14px;
  height: 14px;
  margin: 0;
}

/* ── Job Drawer (extends sheet-panel) ── */
.job-drawer-panel {
  width: 360px;
}

.drawer-section {
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}

.drawer-section:last-child {
  border-bottom: none;
  margin-bottom: 0;
}

.drawer-section h4 {
  color: var(--muted-foreground);
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.drawer-empty {
  color: var(--faint-foreground);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 8px 0;
}

.drawer-job-card {
  background: var(--card-alt);
  border: 1px solid var(--border);
  border-left: 3px solid var(--primary);
  padding: 10px 12px;
  margin-bottom: 6px;
}

.drawer-job-card.completed {
  border-left-color: var(--success);
}

.drawer-job-card.failed {
  border-left-color: var(--danger);
}

.drawer-job-card.running {
  border-left-color: var(--job-active);
  animation: pulse 2s infinite;
}

.drawer-job-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.badge-job-type {
  font-size: 9px;
  padding: 2px 6px;
  border: 1px solid var(--primary-bright);
  color: var(--primary-bright);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 700;
}

.drawer-job-status {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  display: flex;
  align-items: center;
  gap: 4px;
}

.drawer-job-status.running {
  color: var(--job-active);
}

.drawer-job-status.completed {
  color: var(--success);
}

.drawer-job-status.failed {
  color: var(--danger);
}

.drawer-job-progress {
  color: var(--foreground-soft);
  font-size: 10px;
  margin: 4px 0;
}

.drawer-job-time {
  color: var(--faint-foreground);
  font-size: 9px;
}

.drawer-job-summary {
  color: var(--foreground-soft);
  font-size: 10px;
  margin-top: 4px;
  line-height: 1.4;
}

.drawer-job-error {
  color: var(--danger);
  font-size: 10px;
  margin-top: 4px;
}

/* ── Enhanced Toast ── */
.toast {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toast.success {
  border-color: #00FF00;
}

.toast-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.toast-icon-success {
  color: #00FF00;
}

.toast-icon-error {
  color: var(--danger);
}

.toast-icon-info {
  color: var(--primary-bright);
}

.toast-message {
  flex: 1;
  line-height: 1.4;
}
```

### C3: Modified Selectors

**`.migration-status-bar`** — This selector will be **removed** (or left as dead CSS) since `#migration-status-bar` in HTML is replaced by `#job-status-bar`. The old element is removed from `index.html`.

**`.toast`** — Modified to add `display: flex; align-items: center; gap: 8px;` for icon + text layout. The `animation` property remains. The `.toast.error` and `.toast.success` selectors remain (they control border color). The new toast type colors are on the icon, not the toast border.

**`.toast.info`** — Add new selector for info-type toast border:
```css
.toast.info {
  border-color: var(--primary-bright);
}
```

## File Change Map

| File | Change Summary |
|------|---------------|
| `src/services/api-handlers.ts` | Add `skipGuard = false` parameter to `handleCleanup()` (line 1384) and `handleDeduplicate()` (line 1450). Conditionally skip guard check and flag set/reset. |
| `src/services/memory-maintenance-job-service.ts` | Update `executeCleanupJob()` (line 248) to call `handleCleanup(true)` and `executeDeduplicateJob()` (line 274) to call `handleDeduplicate(true)`. No other changes. |
| `src/services/web-server.ts` | Add imports for `enqueueJob`, `getJobStatus`, `getTagMigrationVirtualJob` from job service. Replace `/api/cleanup` and `/api/deduplicate` route handlers (lines 382-390) with `enqueueJob()` calls. Add `GET /api/jobs/memory` route. Add `deriveJobScope()` private method. Remove direct `handleCleanup`/`handleDeduplicate` imports from route code (keep in import block for backward compat). |
| `src/services/web-server-worker.ts` | Same changes as web-server.ts: add job service imports, replace cleanup/dedup route handlers, add `/api/jobs/memory` route, add `deriveJobScope()` module-level function. |
| `src/web/index.html` | Replace `#migration-status-bar` with `#job-status-bar`. Add `#confirm-modal` div. Add `#job-drawer` sheet-overlay div. |
| `src/web/styles.css` | Remove `.migration-status-bar` styles. Add confirm modal, job status bar, job drawer, enhanced toast CSS. Add `--job-active`, `--job-idle` CSS variables. Add `.toast.info` selector. |
| `src/web/app.js` | Replace `runCleanup()` and `runDeduplication()`. Add `openConfirmModal()`, `closeConfirmModal()`, `pollJobStatus()`, `startJobPolling()`, `stopJobPolling()`, `adjustPollInterval()`, `handleJobTransitions()`, `updateStatusBar()`, `updateButtonStates()`, `renderDrawerContent()`, `isJobTypeActive()`, `truncateText()`, `jobTypeLabel()`, `mapActivityTextToKey()`. Enhance `showToast()` with icons and truncation. Add job poll state to `state` object. Update DOMContentLoaded: add confirm-modal, drawer event listeners, call `startJobPolling()`. Extend Escape key handler. **Remove old migration-status-bar polling code (~lines 1420-1440)** since its HTML target is being replaced. |
| `src/web/i18n.js` | Add 21 new translation keys to both `en` and `zh` objects (see F7 section). |

## API Contract

### POST /api/cleanup (New Behavior)

**Request:**
```
POST /api/cleanup
Authorization: Bearer <api-key>
Content-Length: 0
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "jobId": "job_1748683200000_abc123def",
    "status": "queued",
    "type": "cleanup_memories",
    "message": "Job queued successfully"
  }
}
```

**Conflict Response (409):**
```json
{
  "success": false,
  "error": "A cleanup job is already queued or running for this scope.",
  "code": "JOB_ALREADY_QUEUED_OR_RUNNING"
}
```

**Error Response (500):**
```json
{
  "success": false,
  "error": "Internal server error"
}
```

### POST /api/deduplicate (New Behavior)

**Request:**
```
POST /api/deduplicate
Authorization: Bearer <api-key>
Content-Length: 0
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "jobId": "job_1748683200000_xyz789ghi",
    "status": "queued",
    "type": "deduplicate_memories",
    "message": "Job queued successfully"
  }
}
```

**Conflict Response (409):**
```json
{
  "success": false,
  "error": "A deduplicate job is already queued or running for this scope.",
  "code": "JOB_ALREADY_QUEUED_OR_RUNNING"
}
```

### GET /api/jobs/memory

**Request:**
```
GET /api/jobs/memory
Authorization: Bearer <api-key>
```

**Response — Idle State:**
```json
{
  "success": true,
  "data": {
    "activity": { "active": false, "text": "Idle", "queuedCount": 0 },
    "current": null,
    "queued": [],
    "history": [
      {
        "id": "job_1748683200000_abc123",
        "type": "cleanup_memories",
        "status": "completed",
        "scope": "all_profiles",
        "createdAt": "2026-05-31T06:00:00.000Z",
        "startedAt": "2026-05-31T06:00:00.100Z",
        "completedAt": "2026-05-31T06:00:05.200Z",
        "processedItems": 12,
        "totalItems": 12,
        "summary": "Processed cleanup. Removed 8 memories (5 project, 3 user) and 4 prompts."
      }
    ]
  }
}
```

**Response — Active Cleanup Running:**
```json
{
  "success": true,
  "data": {
    "activity": { "active": true, "text": "Cleanup memories 42/100...", "queuedCount": 1 },
    "current": {
      "id": "job_1748683260000_def456",
      "type": "cleanup_memories",
      "status": "running",
      "scope": "all_profiles",
      "createdAt": "2026-05-31T06:01:00.000Z",
      "startedAt": "2026-05-31T06:01:00.050Z",
      "processedItems": 42,
      "totalItems": 100
    },
    "queued": [
      {
        "id": "job_1748683261000_ghi789",
        "type": "deduplicate_memories",
        "status": "queued",
        "scope": "all_profiles",
        "createdAt": "2026-05-31T06:01:01.000Z"
      }
    ],
    "history": []
  }
}
```

**Response — Tag Migration Running (no queue jobs):**
```json
{
  "success": true,
  "data": {
    "activity": { "active": true, "text": "Tag Untagged in progress...", "queuedCount": 0 },
    "current": {
      "id": "tag-migration-perpetual",
      "type": "tag_untagged_memories",
      "status": "running",
      "scope": "all_profiles",
      "createdAt": "2026-05-31T06:00:00.000Z",
      "processedItems": 25,
      "totalItems": 100,
      "summary": "3 errors"
    },
    "queued": [],
    "history": []
  }
}
```

**Response — Failed Job in History:**
```json
{
  "success": true,
  "data": {
    "activity": { "active": false, "text": "Cleanup failed", "queuedCount": 0 },
    "current": null,
    "queued": [],
    "history": [
      {
        "id": "job_1748683200000_abc123",
        "type": "cleanup_memories",
        "status": "failed",
        "scope": "all_profiles",
        "createdAt": "2026-05-31T06:00:00.000Z",
        "startedAt": "2026-05-31T06:00:00.100Z",
        "completedAt": "2026-05-31T06:00:02.300Z",
        "error": "Error: Storage connection failed"
      },
      {
        "id": "job_1748683100000_xyz456",
        "type": "deduplicate_memories",
        "status": "completed",
        "scope": "all_profiles",
        "createdAt": "2026-05-31T05:58:00.000Z",
        "startedAt": "2026-05-31T05:58:00.100Z",
        "completedAt": "2026-05-31T05:58:15.200Z",
        "processedItems": 500,
        "totalItems": 500,
        "summary": "Processed 500 memories. Removed 3 duplicates."
      }
    ]
  }
}
```

### GET /api/migration/tags/progress (Unchanged)

**Backward compatible** — this endpoint continues to work as before:

```json
{
  "success": true,
  "data": {
    "status": "running",
    "processed": 25,
    "total": 100,
    "errors": []
  }
}
```

## Risk Assessment

### 1. Race Condition: Double Enqueue Between Poll Updates

**Risk:** User clicks Cleanup button while a cleanup is already running, but the last poll hasn't updated the button state yet.

**Mitigation:** Three layers:
1. Frontend disables button on click (optimistic) and re-enables only when poll confirms no conflict
2. Backend `enqueueJob()` rejects with `JOB_ALREADY_QUEUED_OR_RUNNING` via `isConflict()`
3. Frontend shows error toast on 409 response

### 2. Job Service State Lost on Server Restart

**Risk:** In-memory queue is cleared on restart. Running job's promise may or may not complete.

**Mitigation:** Acceptable per spec (Out of Scope §1). The queue is explicitly in-memory only. On restart, the user can re-trigger the job. No data corruption risk — the handlers are idempotent.

### 3. Tag Migration Virtual Job Conflicts with Queue Job

**Risk:** Tag migration runs perpetually while a cleanup/dedup job is also running. Both could appear as `current`.

**Mitigation:** The `/api/jobs/memory` handler merges tag migration into `current` only when `status.current === null`. When a queue job is running, it takes priority. The tag migration's state is still available through the separate `/api/migration/tags/progress` endpoint.

### 4. Boolean Guard Skipped on Direct API Call

**Risk:** If someone calls `handleCleanup(true)` directly (bypassing the queue), the guard is skipped.

**Mitigation:** The `skipGuard` parameter defaults to `false`. Only the job service passes `true`. Direct API calls (if any external consumers exist) still go through the old guard. The route handlers no longer call these functions directly.

### 5. Toast Spam on Rapid Polling

**Risk:** Multiple poll cycles detecting the same job completion could fire duplicate toasts.

**Mitigation:** `handleJobTransitions()` compares `prev.current.id` against `curr.history[0].id` — it only fires when a specific job ID transitions from running to history. Once the job is in history on the next poll, `prev.current` will be null (or a different job), so no duplicate toast fires.

### 6. Memory Leak from Poll Timer

**Risk:** `setInterval` continues running even if the page is backgrounded.

**Mitigation:** The poll interval is lightweight (one GET request every 2-5s). No cleanup on page unload is needed — the interval is garbage collected when the page closes. For long-running idle sessions, the 5s idle interval is negligible.

### 7. Drawer Rendering Performance

**Risk:** Re-rendering drawer content on every poll cycle (every 2s when active) could cause DOM thrashing.

**Mitigation:** Only render drawer content if the drawer is open (`sheet-open` class check). Use simple innerHTML replacement (no virtual DOM needed for this scale). The drawer has at most ~50 history items + a few queued items.

### 8. i18n Key Collision

**Risk:** New keys like `btn-confirm` might collide with existing keys like `btn-cancel`.

**Mitigation:** `btn-confirm` is new and doesn't exist in current translations. `btn-cancel` already exists (i18n.js:35). No collision.

### 9. CSS z-index Layering

**Risk:** New confirm modal, drawer, and status bar may overlap with existing modals/toasts.

**Mitigation:** Existing z-index stack:
- Settings panel: `z-index: 100`
- Profile sheet: `z-index: 900`
- Edit modal: `z-index: 1000`
- Toast: `z-index: 2000`

New components use:
- Job status bar: `z-index: 200` (replacing migration-status-bar which was `z-index: 200`)
- Job drawer: `z-index: 900` (same as profile sheet — only one open at a time)
- Confirm modal: `z-index: 1000` (same as edit modal — only one open at a time)

No conflicts. The Escape key handler closes all overlays.

### 10. `handleCleanup(true)` / `handleDeduplicate(true)` Type Safety

**Risk:** Adding a parameter to exported functions may break TypeScript type checking.

**Mitigation:** The parameter has a default value (`skipGuard = false`), so existing callers are unaffected. The type signature changes from `() => Promise<...>` to `(skipGuard?: boolean) => Promise<...>`. TypeScript handles this correctly.
