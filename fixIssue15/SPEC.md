# SPEC.md — Issue #15: Backend Job Queue with Unified Status Drawer

## Issue Reference

- **Forgejo Issue:** #15
- **URL:** https://git.phrk.org/pub/opencode-memnet/issues/15
- **Title:** Move Deduplicate and Cleanup to backend maintenance jobs with unified status drawer
- **Previous PR:** #16 (partial — introduced `memory-maintenance-job-service.ts` as dead code, never wired in)

## Problem Statement

The existing cleanup (`/api/cleanup`) and deduplicate (`/api/deduplicate`) operations suffer from several problems:

1. **Synchronous blocking:** Both endpoints call `handleCleanup()` / `handleDeduplicate()` directly and `await` the full result before returning an HTTP response. These operations can take seconds to minutes on large datasets, during which the HTTP connection remains open and the browser's fetch promise hangs.

2. **Browser `confirm()` popups:** The frontend triggers destructive operations using the native browser `confirm()` dialog (`runCleanup()` at app.js:769, `runDeduplication()` at app.js:784). These are blocking, non-stylable, and inconsistent with the application's dark dashboard UI.

3. **No unified job visibility:** There is no shared status model. The tag migration service has its own progress polling (`/api/migration/progress`), while cleanup/deduplication have no progress reporting at all — they either succeed or fail as a single black-box result.

4. **Dead job service code:** PR #16 introduced `memory-maintenance-job-service.ts` with a full queue implementation, but it is **never imported or used** by any route handler or other module. It exists solely as dead code.

5. **Duplicate request vulnerability:** While `handleCleanup` and `handleDeduplicate` have in-process `_cleanupInProgress` / `_dedupInProgress` guards (api-handlers.ts:1392, 1458), these are simple boolean flags with no queue semantics — a second request is simply rejected rather than queued.

## Current State (What Exists)

### Backend

| Component | File | Status |
|-----------|------|--------|
| **Job queue service** | `src/services/memory-maintenance-job-service.ts` | **Dead code** — full implementation (types, queue, processor, executeCleanupJob, executeDeduplicateJob, executeTagMigrationJob, getJobStatus, enqueueJob, getTagMigrationVirtualJob) but **never imported** by any other module |
| **Cleanup handler** | `src/services/api-handlers.ts:1384-1448` | `handleCleanup()` — synchronous, uses `_cleanupInProgress` boolean guard, deletes stale memories/prompts inline |
| **Deduplicate handler** | `src/services/api-handlers.ts:1450-1595` | `handleDeduplicate()` — synchronous, uses `_dedupInProgress` boolean guard, pairwise cosine similarity with union-find clustering |
| **Web server routes** | `src/services/web-server.ts:382-390` | `POST /api/cleanup` and `POST /api/deduplicate` call handlers directly and `await` the full result |
| **Worker server routes** | `src/services/web-server-worker.ts:291-299` | Same pattern as web-server.ts |
| **Tag migration service** | `src/services/tag-migration-service.ts` | Perpetual background loop with `getMigrationProgress()` — separate status model, not integrated with job queue |
| **Auth middleware** | `src/services/auth.ts` | Bearer token auth with `disableWebuiAuth` / `disableClientAuth` flags |
| **No job status endpoint** | — | No `/api/jobs/memory` route exists |

### Frontend

| Component | File | Status |
|-----------|------|--------|
| **Cleanup button** | `src/web/index.html:69-71` | `<button id="cleanup-btn">` triggers `runCleanup()` |
| **Deduplicate button** | `src/web/index.html:72-74` | `<button id="deduplicate-btn">` triggers `runDeduplication()` |
| **runCleanup()** | `src/web/app.js:768-781` | Uses `confirm(t("confirm-cleanup"))` → `fetchAPI("/api/cleanup", POST)` → shows toast |
| **runDeduplication()** | `src/web/app.js:783-800` | Uses `confirm(t("confirm-dedup"))` → `fetchAPI("/api/deduplicate", POST)` → shows toast |
| **Toast system** | `src/web/app.js:706-718` | Single toast element, 3-second auto-hide, types: success/error/info |
| **i18n** | `src/web/i18n.js` | EN + ZH translations; existing keys: `confirm-cleanup`, `confirm-dedup`, `toast-cleanup-*`, `toast-dedup-*`, `status-cleanup`, `status-dedup` |
| **CSS** | `src/web/styles.css` | Dark theme (Oxanium font, `--background: #09090b`, `--card: #18181b`, etc.) — no modal, status bar, or drawer components exist |
| **No confirmation modal** | — | Uses native `confirm()` |
| **No job status bar** | — | No persistent status indicator |
| **No job status drawer** | — | No drawer component |
| **No job polling** | — | No polling mechanism |

### Dead Code from PR #16

The job service (`memory-maintenance-job-service.ts`) provides:

- **Types:** `JobType`, `JobStatus`, `JobScope`, `MemoryMaintenanceJob`, `JobStatusResponse`
- **Queue management:** `enqueueJob(type, scope)` with duplicate detection (`isConflict`)
- **Status query:** `getJobStatus()` returning `{ activity, current, queued, history }`
- **Tag migration virtual job:** `getTagMigrationVirtualJob()` mapping tag migration progress into job model
- **Queue processor:** `processQueue()` loop — shifts jobs, executes, moves to history (max 50)
- **Job executors:** `executeCleanupJob`, `executeDeduplicateJob`, `executeTagMigrationJob` — all delegate to existing `api-handlers.js` functions

## Required Changes Overview

1. **Wire the dead job service into the HTTP layer** — Replace direct `handleCleanup()`/`handleDeduplicate()` calls with `enqueueJob()`, returning immediately with job metadata.
2. **Add a `/api/jobs/memory` GET endpoint** — Expose `getJobStatus()` (and optionally `getTagMigrationVirtualJob()`) for frontend polling.
3. **Build a custom confirmation modal** — Replace browser `confirm()` with a styled centered modal matching the dark theme.
4. **Build a job status bar** — Persistent bar showing activity indicator, current job text, and a button to open the drawer.
5. **Build a job status drawer** — Right-side slide-in panel showing current job, queued jobs, and job history.
6. **Add enhanced toast notifications** — Colored toasts with icons for success/failure/info states.
7. **Implement frontend polling** — Periodic `GET /api/jobs/memory` calls to update status bar/drawer.
8. **Add duplicate job prevention** — Frontend disables buttons when same job is queued/running; backend returns `JOB_ALREADY_QUEUED_OR_RUNNING`.
9. **Integrate tag migration into shared status model** — Show tag migration progress in the same status bar/drawer.
10. **Add i18n keys** for all new UI text (EN + ZH).

## Functional Requirements

### FR-1: Backend Job Queue Service (Wire Dead Code)

**FR-1.1:** The existing `memory-maintenance-job-service.ts` must be activated by importing it in the web server module(s).

**FR-1.2:** The `POST /api/cleanup` and `POST /api/deduplicate` route handlers must be changed to call `enqueueJob("cleanup_memories", scope)` and `enqueueJob("deduplicate_memories", scope)` respectively instead of directly calling `handleCleanup()` / `handleDeduplicate()`.

**FR-1.3:** The scope parameter for both jobs shall be derived from the auth state per **FR-4.5** (matching current behavior — both handlers operate on all memories regardless of profile).

**FR-1.4:** On successful enqueue, the HTTP response must return immediately with status `200` and body:
```json
{
  "success": true,
  "data": {
    "jobId": "job_1234567890_abc123",
    "status": "queued",
    "type": "cleanup_memories",
    "message": "Job queued successfully"
  }
}
```

**FR-1.5:** If the job conflicts with a running/queued job of the same type and scope, the response must return status `409` (or `200` with `success: false`) and body:
```json
{
  "success": false,
  "error": "A cleanup job is already queued or running for this scope.",
  "code": "JOB_ALREADY_QUEUED_OR_RUNNING"
}
```

**FR-1.6:** The existing `_cleanupInProgress` and `_dedupInProgress` boolean guards in `api-handlers.ts` shall be removed OR modified to accept an optional `skipGuard` parameter. The job queue processor must be able to call `handleCleanup()`/`handleDeduplicate()` without being blocked by these guards.

**FR-1.7:** The same wiring must be applied to **both** `web-server.ts` and `web-server-worker.ts` to maintain feature parity.

### FR-2: API Route Changes

**FR-2.1:** `POST /api/cleanup` — Changed from synchronous execution to asynchronous job enqueue (see FR-1.2). Returns immediately.

**FR-2.2:** `POST /api/deduplicate` — Changed from synchronous execution to asynchronous job enqueue (see FR-1.2). Returns immediately.

**FR-2.3:** Existing response schemas for successful completion (with `deletedMemories`, `duplicatesRemoved`, etc.) are preserved in the `job.summary` field, not in the HTTP response body. The HTTP response only confirms enqueue.

**FR-2.4:** Both routes must continue to require the same auth as before (Bearer token unless `disableWebuiAuth` is true).

### FR-3: Shared Job Status Endpoint

**FR-3.1:** A new route `GET /api/jobs/memory` must be added to both `web-server.ts` and `web-server-worker.ts`.

**FR-3.2:** The endpoint must call `getJobStatus()` from the job service and also incorporate `getTagMigrationVirtualJob()` if tag migration is running.

**FR-3.3:** The response schema must match `JobStatusResponse`:
```json
{
  "success": true,
  "data": {
    "activity": {
      "active": true,
      "text": "Cleanup in progress...",
      "queuedCount": 1
    },
    "current": {
      "id": "job_...",
      "type": "cleanup_memories",
      "status": "running",
      "scope": "all_profiles",
      "createdAt": "2026-05-31T...",
      "startedAt": "2026-05-31T...",
      "processedItems": 42,
      "totalItems": 100,
      "summary": null
    },
    "queued": [...],
    "history": [...]
  }
}
```

**FR-3.4:** If tag migration is running (as a virtual job), it must appear in the `current` field (or be merged appropriately) so the frontend shows a unified view.

**FR-3.5:** The `history` array must be capped at the most recent 50 jobs (matching `MAX_HISTORY` in the job service).

**FR-3.6:** This endpoint must also require the same auth as other `/api/*` routes.

### FR-4: Auth and Scope Rules

**FR-4.1:** `GET /api/jobs/memory` must follow the same auth rules as all other `/api/*` routes: Bearer token required unless `disableWebuiAuth` is `true`.

**FR-4.2:** When `DISABLE_WEBUI_AUTH` is `true` (i.e., `disableWebuiAuth` flag), the `/api/jobs/memory` endpoint is accessible without authentication, matching the behavior of all other API endpoints.

**FR-4.3:** Job scope is derived from the auth state per **FR-4.5**.

**FR-4.4:** The `JobScope` type already exists in the dead job service. No changes needed to the type definition.

**FR-4.5:** The scope parameter for cleanup and deduplication jobs shall be derived from the auth state: `all_profiles` when `DISABLE_WEBUI_AUTH` is true (no auth), and `current_profile` when auth is enabled (`DISABLE_WEBUI_AUTH` is false). The profile is determined from the authenticated user's profile, not from a frontend-supplied parameter.

### FR-5: Frontend Confirmation Modal

**FR-5.1:** The native browser `confirm()` calls in `runCleanup()` (app.js:769) and `runDeduplication()` (app.js:784) must be replaced with a custom modal component.

**FR-5.2:** The modal must be visually centered on screen with a semi-transparent dark overlay backdrop.

**FR-5.3:** The modal must use the existing dark theme CSS variables (`--background`, `--card`, `--card-raised`, `--foreground`, `--border`, `--primary`, `--danger`, etc.).

**FR-5.4:** The modal must contain:
- **Title text** — e.g., "Run Cleanup?" or "Run Deduplication?" (i18n keys)
- **Description text** — The current `confirm-cleanup` / `confirm-dedup` message text
- **Cancel button** — Styled as secondary/neutral, closes the modal without action
- **Confirm button** — Styled with primary color, triggers the job enqueue

**FR-5.5:** The modal must be closeable by:
- Clicking the Cancel button
- Clicking the backdrop/overlay
- Pressing the Escape key

**FR-5.6:** Only one modal should be visible at a time.

**FR-5.7:** The modal must be added to `index.html` as a new `<div>` element with appropriate CSS classes.

### FR-6: Frontend Job Status Bar

**FR-6.1:** A persistent status bar must be added to the WebUI, visible at all times (not just when jobs are active).

**FR-6.2:** The status bar must be positioned at the **bottom of the screen** (or another fixed position that doesn't overlap critical content).

**FR-6.3:** The status bar must contain:
- **Indicator circle** — A small colored circle:
  - **Gray/dim** when idle (`activity.active === false`)
  - **Hot green (#39ff14) when active** (`activity.active === true`), with an optional pulsing animation
- **Status text** — Displaying `activity.text` from the job status response. Status text shall use the theme's foreground color (`--foreground` or `--foreground-soft`). The green accent applies only to the indicator circle, not the text:
  - "Idle" when no jobs are active
  - "Cleanup in progress..." / "Cleanup memories 42/100..." when a cleanup job is running
  - "Deduplication in progress..." when a dedup job is running
  - "Tag Untagged in progress..." when tag migration is running
  - "N jobs queued" when jobs are waiting
  - "Cleanup failed" / "Deduplicate failed" when recent failure detected
- **Drawer toggle button** — A small button/icon to open the job status drawer

**FR-6.4:** The status text must have priority ordering:
1. Running manual job (cleanup/deduplication) progress text (highest priority)
2. Running tag migration progress text
3. Queued job count text
4. Recent failed job text
5. "Idle" (lowest priority)

This matches the existing priority logic in `getJobStatus()` (memory-maintenance-job-service.ts:128-166).

**FR-6.5:** The status bar must update via the polling mechanism (FR-9).

**FR-6.6:** When a job transitions from running → completed/failed, the status bar must reflect this immediately (within one poll cycle).

### FR-7: Frontend Job Status Drawer

**FR-7.1:** A slide-in drawer must appear from the **right side** of the screen when the user clicks the drawer toggle button on the status bar.

**FR-7.2:** The drawer must overlay the main content with a semi-transparent backdrop.

**FR-7.3:** The drawer must contain three sections:

**Current Job Section:**
- Shows the currently running job (if any)
- Displays: job type label, status badge, started time, progress (processedItems/totalItems if available)
- Shows a spinner or progress indicator

**Queued Jobs Section:**
- Lists all jobs in the queue (waiting to run)
- Each entry shows: job type label, enqueued time
- If empty, shows "No queued jobs" text

**History Section:**
- Lists recently completed/failed jobs (from `history` array)
- Each entry shows: job type label, status badge (completed/failed), completion time, summary text
- Failed jobs show the error message
- Completed jobs show the summary (e.g., "Removed 5 duplicates out of 100 checked")

**FR-7.4:** The drawer must be closeable by:
- Clicking a close button (X icon)
- Clicking the backdrop
- Pressing the Escape key

**FR-7.5:** The drawer content must update in real-time via the polling mechanism (FR-9).

**FR-7.6:** The drawer must use the existing dark theme CSS variables.

**FR-7.7:** Job type labels must be human-readable:
- `cleanup_memories` → "Cleanup"
- `deduplicate_memories` → "Deduplicate"
- `tag_untagged_memories` → "Tag Untagged"

### FR-8: Toast Notifications

**FR-8.1:** The existing `showToast()` function (app.js:707-718) must be enhanced or replaced to support visual differentiation by type.

**FR-8.2:** Toast types and their visual appearance:
| Type | Accent Color | Icon |
|------|-------------|------|
| `success` | `#00FF00` green accent | ✔ (U+2714 heavy check) |
| `error` | Red accent | ❌ (U+274C cross mark) |
| `info` | Cyan accent | ℹ️ (info emoji) |

**FR-8.3:** Toast notifications must include an icon (using Lucide icons already loaded in the app) alongside the message text.

**FR-8.4:** The toast must auto-hide after 3 seconds (matching existing behavior).

**FR-8.5:** Toast messages for job lifecycle events:
- **Job queued:** `{JobTypeLabel} job queued` (info toast) — shown when enqueue succeeds
- **Job completed:** `{summary text from job}` (success toast) — shown when poll detects completion
- **Job failed:** `{error message}` (error toast) — shown when poll detects failure
- **Job already running:** `{error message from backend}` (error toast) — shown on 409/conflict

**FR-8.6:** Only one toast should be visible at a time (matching existing behavior — `toastTimer` clears previous toast).

**FR-8.7:** Toast notifications shall appear in the **bottom-right corner** of the viewport.

**FR-8.8:** Toast message text shall be truncated with ellipsis at **240 characters** maximum.

### FR-9: Frontend Job Polling

**FR-9.1:** The frontend must implement a polling mechanism that periodically calls `GET /api/jobs/memory` to update the status bar and drawer.

**FR-9.2:** **Polling interval:** 2 seconds while a job is active (`activity.active === true`), 5 seconds while idle.

**FR-9.3:** **Polling start:** Polling begins when the page loads (after auth is established) and runs continuously.

**FR-9.4:** **Polling lifecycle events:** On each successful poll, the frontend must:
1. Update the status bar text and indicator
2. Update the drawer content (if drawer is open)
3. Detect job state transitions and trigger toast notifications:
   - `current` changed from `running` → not present (completed): show success toast with summary
   - `current.error` present (failed): show error toast with error message
   - `queued` count changed: update status bar text

**FR-9.5:** **Error handling:** If the poll request fails (network error, 401), the frontend must:
- Not crash or stop polling
- Retry on the next interval
- If 401 (auth error), stop polling and prompt for API key

**FR-9.6:** **Optimization:** Only update the DOM when the job status data has actually changed (compare previous and current response).

**FR-9.7:** The frontend must track the last seen `current.id` and `current.status` to prevent duplicate completion/failure toasts on subsequent polls. A toast for job completion/failure shall fire **exactly once** per job lifecycle transition.

**FR-9.8:** When the polling mechanism detects a job has transitioned from `running` to `completed`, the frontend must call `loadMemories()` and `loadStats()` to refresh the memory list. This shall **not** happen when a job is merely queued.

### FR-10: Duplicate Job Prevention

**FR-10.1 (Backend):** The existing `enqueueJob()` function already implements conflict detection via `isConflict()` — same type + same scope. This must be preserved and is sufficient.

**FR-10.2 (Backend response):** When a duplicate is detected, the response must include `code: "JOB_ALREADY_QUEUED_OR_RUNNING"` so the frontend can distinguish it from other errors.

**FR-10.3 (Frontend):** The Cleanup and Deduplicate buttons must be **disabled** (grayed out, non-clickable) when:
- A job of the same type is currently running (`current?.type === "cleanup_memories"` for Cleanup button)
- A job of the same type is queued (`queued` contains a job with matching type)

**FR-10.4 (Frontend):** Button disabled state must update on each poll cycle based on current job status data.

**FR-10.5 (Frontend):** If a user somehow bypasses the disabled state (e.g., rapid double-click before poll updates), the backend's `JOB_ALREADY_QUEUED_OR_RUNNING` error must be caught and displayed as an error toast.

### FR-11: Tag Migration Integration

**FR-11.1:** The tag migration service's running state must be surfaced through the `/api/jobs/memory` endpoint as a virtual job (the `getTagMigrationVirtualJob()` function already exists in the dead job service).

**FR-11.2:** When tag migration is running, it must appear as the `current` job in the status response (or be merged with the queue's current job — if both are running, tag migration takes display precedence only if no queue job is active).

**FR-11.3:** The tag migration's progress (`processed`, `total`, `errors`) must be mapped to the `MemoryMaintenanceJob` fields (`processedItems`, `totalItems`, `summary`).

**FR-11.4:** The existing tag migration progress endpoint (`GET /api/migration/progress`) must remain functional for backward compatibility.

### FR-12: i18n Support

**FR-12.1:** All new UI text must be added to both `en` and `zh` translation blocks in `src/web/i18n.js`.

**FR-12.2:** Required new translation keys:

| Key | EN Value | ZH Value |
|-----|----------|----------|
| `modal-confirm-cleanup-title` | "Run Cleanup?" | "运行清理？" |
| `modal-confirm-dedup-title` | "Run Deduplication?" | "运行去重？" |
| `modal-confirm-cleanup-desc` | "This will remove all memories that are no longer relevant. Continue?" | "这将删除所有不再相关的记忆。是否继续？" |
| `modal-confirm-dedup-desc` | "This will merge duplicate or highly similar memories. Continue?" | "这将合并重复或高度相似的记忆。是否继续？" |
| `btn-confirm` | "Confirm" | "确认" |
| `btn-cancel` | "Cancel" | "取消" |
| `job-status-idle` | "Idle" | "空闲" |
| `job-status-cleanup-running` | "Cleanup in progress..." | "清理进行中..." |
| `job-status-dedup-running` | "Deduplication in progress..." | "去重进行中..." |
| `job-status-tag-running` | "Tag Untagged in progress..." | "标签迁移进行中..." |
| `job-status-queued` | "{count} job(s) queued" | "{count} 个任务排队中" |
| `job-status-cleanup-failed` | "Cleanup failed" | "清理失败" |
| `job-status-dedup-failed` | "Deduplication failed" | "去重失败" |
| `job-queued` | "Job queued successfully" | "任务已加入队列" |
| `job-already-running` | "Job is already queued or running" | "任务已在队列中或正在运行" |
| `drawer-title` | "Maintenance Jobs" | "维护任务" |
| `drawer-section-current` | "Current" | "当前" |
| `drawer-section-queued` | "Queued" | "排队中" |
| `drawer-section-history` | "History" | "历史" |
| `drawer-no-queued` | "No queued jobs" | "无排队任务" |
| `drawer-no-history` | "No recent jobs" | "无最近任务" |
| `drawer-job-completed` | "Completed" | "已完成" |
| `drawer-job-failed` | "Failed" | "失败" |

**FR-12.3:** The existing `confirm-cleanup` and `confirm-dedup` keys may be reused as the modal description text, or the new `modal-confirm-*-desc` keys may supersede them. The design must ensure no text is hardcoded — all user-facing strings go through `t()`.

## Non-Functional Requirements

### NFR-1: Performance

**NFR-1.1:** The `POST /api/cleanup` and `POST /api/deduplicate` endpoints must return an HTTP response within **500ms** of receiving the request (they now only enqueue a job, not execute it).

**NFR-1.2:** The `GET /api/jobs/memory` endpoint must return within **100ms** (it reads in-memory state, no I/O).

**NFR-1.3:** Frontend polling must not degrade UI responsiveness. DOM updates from poll results must be batched and minimal (only update changed elements).

**NFR-1.4:** The polling interval (2s active / 5s idle) must not cause excessive network traffic. Each poll is a lightweight GET request.

### NFR-2: Concurrency Safety

**NFR-2.1:** The job queue (`enqueueJob`, `processQueue`) must handle concurrent HTTP requests safely. Since Node.js/Bun is single-threaded for JavaScript, the in-memory queue is inherently safe from data races within a single process.

**NFR-2.2:** If the web server spawns multiple workers (unlikely in current architecture), the job queue state must not diverge. Currently the queue is per-process in-memory; this is acceptable for single-process mode.

**NFR-2.3:** The `_running` flag in the job service prevents double-processing. The `isConflict()` check prevents duplicate enqueue.

### NFR-3: Backward Compatibility

**NFR-3.1:** The `POST /api/cleanup` and `POST /api/deduplicate` endpoints must remain at the same paths with the same HTTP methods.

**NFR-3.2:** The response schema changes (from synchronous result to async job acknowledgment). This is a **breaking change** for any API consumer expecting the old response format. This is acceptable as the issue explicitly requests this change and the primary consumer is the WebUI.

**NFR-3.3:** The existing `handleCleanup()` and `handleDeduplicate()` functions in `api-handlers.ts` must remain exportable and callable — the job service's executor functions import and call them.

**NFR-3.4:** The `GET /api/migration/progress` endpoint must remain functional and unchanged.

**NFR-3.5:** All existing `/api/*` routes (tags, memories, stats, etc.) must continue to work unchanged.

### NFR-4: Docker Build Validation

**NFR-4.1:** After all changes, the project must build and run successfully in Docker with `docker compose up --build`.

**NFR-4.2:** No new external npm dependencies should be required. All UI components (modal, drawer, status bar, toasts) must be implemented with vanilla HTML/CSS/JS.

**NFR-4.3:** The Lucide icon library (already loaded via CDN in index.html) should be used for all new icons.

### NFR-5: Build Validation

**NFR-5.1:** `bun run typecheck` must pass with zero errors.

**NFR-5.2:** `bun run typecheck:all` must pass with zero errors.

**NFR-5.3:** `bun run build` must succeed.

## Acceptance Criteria

### AC-1: Job Queue Activation
- [ ] **AC-1.1:** `memory-maintenance-job-service.ts` is imported and used by `web-server.ts`
- [ ] **AC-1.2:** `memory-maintenance-job-service.ts` is imported and used by `web-server-worker.ts`
- [ ] **AC-1.3:** `POST /api/cleanup` returns immediately with job metadata (not blocking on execution)
- [ ] **AC-1.4:** `POST /api/deduplicate` returns immediately with job metadata (not blocking on execution)
- [ ] **AC-1.5:** Cleanup and deduplication operations still execute correctly (verified via job history summaries)

### AC-2: Job Status Endpoint
- [ ] **AC-2.1:** `GET /api/jobs/memory` returns valid `JobStatusResponse` JSON
- [ ] **AC-2.2:** Response includes `activity.active`, `activity.text`, `activity.queuedCount`
- [ ] **AC-2.3:** Response includes `current` (running job or null)
- [ ] **AC-2.4:** Response includes `queued` (array of waiting jobs)
- [ ] **AC-2.5:** Response includes `history` (array of past jobs, max 50)
- [ ] **AC-2.6:** Tag migration progress appears as a virtual job when running

### AC-3: Confirmation Modal
- [ ] **AC-3.1:** Clicking "Cleanup" button opens a styled modal (not browser `confirm()`)
- [ ] **AC-3.2:** Clicking "Deduplicate" button opens a styled modal (not browser `confirm()`)
- [ ] **AC-3.3:** Modal displays warning text matching existing `confirm-cleanup` / `confirm-dedup` messages
- [ ] **AC-3.4:** Modal has Cancel and Confirm buttons
- [ ] **AC-3.5:** Modal is closeable via Cancel, backdrop click, or Escape key
- [ ] **AC-3.6:** Confirming triggers the job enqueue API call
- [ ] **AC-3.7:** Modal uses the dark theme (not browser default styles)

### AC-4: Job Status Bar
- [ ] **AC-4.1:** Status bar is visible at all times at the bottom of the screen
- [ ] **AC-4.2:** Indicator circle is gray when idle, pulsing cyan when active
- [ ] **AC-4.3:** Status text shows current activity description
- [ ] **AC-4.4:** Status text follows priority: active job > queued > failed > idle
- [ ] **AC-4.5:** Drawer toggle button opens the job drawer

### AC-5: Job Status Drawer
- [ ] **AC-5.1:** Drawer slides in from the right when toggled
- [ ] **AC-5.2:** Current job section shows running job details with progress
- [ ] **AC-5.3:** Queued section lists waiting jobs
- [ ] **AC-5.4:** History section shows completed/failed jobs with summaries
- [ ] **AC-5.5:** Drawer is closeable via close button, backdrop, or Escape
- [ ] **AC-5.6:** Drawer content updates during polling
- [ ] **AC-5.7:** Failed jobs show error text in red
- [ ] **AC-5.8:** Completed jobs show summary text

### AC-6: Toast Notifications
- [ ] **AC-6.1:** Success toasts are green with check icon
- [ ] **AC-6.2:** Error toasts are red with X icon
- [ ] **AC-6.3:** Info toasts are cyan with info icon
- [ ] **AC-6.4:** Job queued → info toast
- [ ] **AC-6.5:** Job completed → success toast with summary
- [ ] **AC-6.6:** Job failed → error toast with error message
- [ ] **AC-6.7:** Duplicate job attempt → error toast
- [ ] **AC-6.8:** Toasts auto-hide after 3 seconds

### AC-7: Job Polling
- [ ] **AC-7.1:** Frontend polls `GET /api/jobs/memory` every 2s during active jobs
- [ ] **AC-7.2:** Frontend polls every 5s when idle
- [ ] **AC-7.3:** Poll updates status bar and drawer
- [ ] **AC-7.4:** Job completion triggers success toast
- [ ] **AC-7.5:** Job failure triggers error toast
- [ ] **AC-7.6:** Poll errors do not crash the UI

### AC-8: Duplicate Job Prevention
- [ ] **AC-8.1:** Cleanup button disabled when cleanup job is running/queued
- [ ] **AC-8.2:** Deduplicate button disabled when dedup job is running/queued
- [ ] **AC-8.3:** Backend returns `JOB_ALREADY_QUEUED_OR_RUNNING` on conflict
- [ ] **AC-8.4:** Frontend shows error toast on conflict response

### AC-9: Tag Migration Integration
- [ ] **AC-9.1:** Tag migration progress visible in status bar when running
- [ ] **AC-9.2:** Tag migration visible as current job in drawer
- [ ] **AC-9.3:** Existing `/api/migration/progress` still works

### AC-10: i18n
- [ ] **AC-10.1:** All new UI text has EN translations
- [ ] **AC-10.2:** All new UI text has ZH translations
- [ ] **AC-10.3:** No hardcoded user-facing strings in JS or HTML

### AC-11: Auth
- [ ] **AC-11.1:** `/api/jobs/memory` requires Bearer token when auth is enabled
- [ ] **AC-11.2:** `/api/jobs/memory` accessible without auth when `DISABLE_WEBUI_AUTH=true`

### AC-12: Docker and Build
- [ ] **AC-12.1:** `docker compose up --build` succeeds
- [ ] **AC-12.2:** WebUI loads and all new components render
- [ ] **AC-12.3:** `bun run typecheck` passes with zero errors
- [ ] **AC-12.4:** `bun run typecheck:all` passes with zero errors
- [ ] **AC-12.5:** `bun run build` passes

## Constraints

1. **No new npm dependencies** — All UI must be vanilla HTML/CSS/JS.
2. **Single-file frontend** — No JS bundling; changes go into `app.js`, `styles.css`, `index.html`, and `i18n.js`.
3. **Preserve existing CSS variable system** — New components must use `--background`, `--card`, `--foreground`, `--primary`, `--danger`, `--success`, etc.
4. **Lucide icons only** — No new icon libraries.
5. **No breaking changes to non-WebUI API consumers** — The `/api/cleanup` and `/api/deduplicate` response format change is accepted as scoped to the WebUI consumer.
6. **Both server files must be updated** — `web-server.ts` and `web-server-worker.ts` must have feature parity.
7. **Existing dead job service code must be reused** — Do not rewrite `memory-maintenance-job-service.ts`; wire it in as-is or with minimal changes.

## Out of Scope

1. **Persistent job queue** — Jobs are in-memory only; server restart clears the queue. No database-backed queue.
2. **WebSocket/SSE for real-time updates** — Polling is sufficient for the MVP.
3. **Job cancellation** — Once queued, jobs cannot be cancelled.
4. **Job retry logic** — Failed jobs are not automatically retried.
5. **Multi-process coordination** — The queue is per-process; no distributed locking.
6. **Profile-scoped jobs with frontend-supplied profile** — Profile is derived from auth state per FR-4.5; frontend does not choose the profile.
7. **Scheduled/automatic jobs** — Jobs are triggered manually via the UI only.
8. **Unit test suite** — Not part of this issue (though manual testing is required).
9. **Tag migration redesign** — The tag migration service's internal architecture is not changing; only its status is surfaced in the shared model.
10. **Migration confirm() removal** — The tag migration modal's `confirm()` (app.js:856) is a separate concern and is **not** part of this issue.
