# IMPLEMENTATION_PLAN.md — Issue #15: Implementation Plan

## Overview

This plan wires the existing dead-code job queue service (`memory-maintenance-job-service.ts`) into the HTTP route layer, adds a unified job status API, and builds three new frontend components (confirmation modal, status bar, status drawer) to replace the synchronous cleanup/deduplication flow with an asynchronous, visually integrated job system.

**Scope:** 7 files modified, 0 files created, 0 files deleted (the dead-code job service file already exists).

**Strategy:** Backend-first → Frontend JS → Frontend HTML → Frontend CSS → Integration testing.

## Implementation Order Strategy

1. **Phase 1 (Backend)** must complete first because the frontend depends on the new `/api/jobs/memory` endpoint and the changed behavior of `POST /api/cleanup` and `POST /api/deduplicate`.
2. **Phase 2 (Frontend)** can be done in sub-task order: i18n keys first (they are referenced by all JS), then HTML markup, then JS logic, then CSS styling.
3. **Phase 3 (Styling)** is last because CSS has no compile-time dependency; it can be written alongside HTML but is validated visually only at integration testing.

## Prerequisites

- Working git branch from `main` (commit `3c4292a` or later)
- Docker available for `docker compose up --build` validation
- `bun` runtime available for `bun run typecheck` / `bun run build`

---

## Phase 1: Backend — Job Service Integration

### Task 1.1: Wire job service into web-server.ts

**File:** `src/services/web-server.ts`

**Lines to change:** Lines 6-35 (import block), lines 382-390 (route handlers)

**Changes:**

1. **Add import** — Add the following import statement after line 35 (the closing brace of the api-handlers import):

   ```typescript
   import {
     enqueueJob,
     getJobStatus,
     getTagMigrationVirtualJob,
   } from "./memory-maintenance-job-service.js";
   ```

2. **Replace cleanup route** — Replace lines 382-385:

   **BEFORE:**
   ```typescript
   if (path === "/api/cleanup" && method === "POST") {
     const result = await handleCleanup();
     return this.jsonResponse(result);
   }
   ```

   **AFTER:**
   ```typescript
   if (path === "/api/cleanup" && method === "POST") {
     const scope = this.deriveJobScope();
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
   ```

3. **Replace deduplicate route** — Replace lines 387-390:

   **BEFORE:**
   ```typescript
   if (path === "/api/deduplicate" && method === "POST") {
     const result = await handleDeduplicate();
     return this.jsonResponse(result);
   }
   ```

   **AFTER:**
   ```typescript
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

4. **Add GET /api/jobs/memory route** — Insert after the deduplicate route handler block (after the replacement in step 3, before the `/api/migration/run` handler at original line 392):

   ```typescript
   if (path === "/api/jobs/memory" && method === "GET") {
     const status = getJobStatus();
     const tagJob = await getTagMigrationVirtualJob();
     if (tagJob && !status.current) {
       status.current = tagJob;
       status.activity.active = true;
       status.activity.text = "Tag Untagged in progress...";
     }
     return this.jsonResponse({ success: true, data: status });
   }
   ```

5. **Add `deriveJobScope()` private method** — Add to the `WebServer` class body (e.g., after `disableWebuiAuth` is set in the constructor, or as a new private method near the end of the class):

   ```typescript
   private deriveJobScope(): "all_profiles" | "current_profile" {
     return this.disableWebuiAuth ? "all_profiles" : "current_profile";
   }
   ```

   The `disableWebuiAuth` property already exists at line 54.

**Verification:** `bun run typecheck` passes. The imports resolve. `POST /api/cleanup` no longer calls `handleCleanup()` directly.

---

### Task 1.2: Wire job service into web-server-worker.ts

**File:** `src/services/web-server-worker.ts`

**Lines to change:** Lines 5-31 (import block), lines 291-299 (route handlers), and add `deriveJobScope()` function.

**Changes:**

1. **Add import** — After line 31 (`} from "./api-handlers.js";`), add:

   ```typescript
   import {
     enqueueJob,
     getJobStatus,
     getTagMigrationVirtualJob,
   } from "./memory-maintenance-job-service.js";
   ```

2. **Replace cleanup route** — Replace lines 291-294:

   **BEFORE:**
   ```typescript
   if (path === "/api/cleanup" && method === "POST") {
     const result = await handleCleanup();
     return jsonResponse(result);
   }
   ```

   **AFTER:**
   ```typescript
   if (path === "/api/cleanup" && method === "POST") {
     const scope = deriveJobScope();
     const result = enqueueJob("cleanup_memories", scope);
     if (!result.success) {
       return jsonResponse(
         { success: false, error: result.error, code: result.code },
         409
       );
     }
     return jsonResponse({
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

3. **Replace deduplicate route** — Replace lines 296-299:

   **BEFORE:**
   ```typescript
   if (path === "/api/deduplicate" && method === "POST") {
     const result = await handleDeduplicate();
     return jsonResponse(result);
   }
   ```

   **AFTER:**
   ```typescript
   if (path === "/api/deduplicate" && method === "POST") {
     const scope = deriveJobScope();
     const result = enqueueJob("deduplicate_memories", scope);
     if (!result.success) {
       return jsonResponse(
         { success: false, error: result.error, code: result.code },
         409
       );
     }
     return jsonResponse({
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

4. **Add GET /api/jobs/memory route** — Insert after the deduplicate route handler replacement (before the `/api/migration/run` handler at original line 301):

   ```typescript
   if (path === "/api/jobs/memory" && method === "GET") {
     const status = getJobStatus();
     const tagJob = await getTagMigrationVirtualJob();
     if (tagJob && !status.current) {
       status.current = tagJob;
       status.activity.active = true;
       status.activity.text = "Tag Untagged in progress...";
     }
     return jsonResponse({ success: true, data: status });
   }
   ```

5. **Add `deriveJobScope()` module-level function** — Add near the top of the file (after the `disableWebuiAuth` declaration at line 38):

   ```typescript
   function deriveJobScope(): "all_profiles" | "current_profile" {
     return disableWebuiAuth ? "all_profiles" : "current_profile";
   }
   ```

**Verification:** `bun run typecheck` passes. Both server files have identical route behavior.

---

### Task 1.3: Resolve boolean guards in api-handlers.ts

**File:** `src/services/api-handlers.ts`

**Lines to change:** Lines 1384-1448 (`handleCleanup`) and lines 1450-1595 (`handleDeduplicate`)

**Changes:**

1. **Update `handleCleanup` signature and guard** — Line 1384:

   **BEFORE:**
   ```typescript
   export async function handleCleanup(): Promise<
   ```

   **AFTER:**
   ```typescript
   export async function handleCleanup(skipGuard = false): Promise<
   ```

2. **Update the guard check in `handleCleanup`** — Lines 1392-1396:

   **BEFORE:**
   ```typescript
     if (_cleanupInProgress) {
       return { success: false, error: "Cleanup is already in progress" };
     }

     _cleanupInProgress = true;
   ```

   **AFTER:**
   ```typescript
     if (!skipGuard && _cleanupInProgress) {
       return { success: false, error: "Cleanup is already in progress" };
     }
     if (!skipGuard) _cleanupInProgress = true;
   ```

3. **Update the finally block in `handleCleanup`** — Line 1446:

   **BEFORE:**
   ```typescript
       _cleanupInProgress = false;
   ```

   **AFTER:**
   ```typescript
       if (!skipGuard) _cleanupInProgress = false;
   ```

4. **Update `handleDeduplicate` signature and guard** — Line 1450:

   **BEFORE:**
   ```typescript
   export async function handleDeduplicate(): Promise<
   ```

   **AFTER:**
   ```typescript
   export async function handleDeduplicate(skipGuard = false): Promise<
   ```

5. **Update the guard check in `handleDeduplicate`** — Lines 1458-1461:

   **BEFORE:**
   ```typescript
     if (_dedupInProgress) {
       return { success: false, error: "Deduplication is already in progress" };
     }
     _dedupInProgress = true;
   ```

   **AFTER:**
   ```typescript
     if (!skipGuard && _dedupInProgress) {
       return { success: false, error: "Deduplication is already in progress" };
     }
     if (!skipGuard) _dedupInProgress = true;
   ```

6. **Update the finally block in `handleDeduplicate`** — Line 1593:

   **BEFORE:**
   ```typescript
       _dedupInProgress = false;
   ```

   **AFTER:**
   ```typescript
       if (!skipGuard) _dedupInProgress = false;
   ```

**Verification:** `bun run typecheck` passes. The default value `false` preserves backward compatibility for any direct callers.

---

### Task 1.4: Update job service executors to pass skipGuard=true

**File:** `src/services/memory-maintenance-job-service.ts`

**Lines to change:** Lines 247-248 (`executeCleanupJob`) and lines 273-274 (`executeDeduplicateJob`)

**Changes:**

1. **Update `executeCleanupJob`** — Line 248:

   **BEFORE:**
   ```typescript
   const result = await handleCleanup();
   ```

   **AFTER:**
   ```typescript
   const result = await handleCleanup(true);
   ```

2. **Update `executeDeduplicateJob`** — Line 274:

   **BEFORE:**
   ```typescript
   const result = await handleDeduplicate();
   ```

   **AFTER:**
   ```typescript
   const result = await handleDeduplicate(true);
   ```

**Verification:** `bun run typecheck` passes. The job queue processor bypasses the boolean guards, relying on the job service's own `_running` flag and `isConflict()` for concurrency safety.

---

### Task 1.5: Backend verification checkpoint

**Commands:**
```bash
bun run typecheck
bun run typecheck:all
bun run build
```

**Expected:** All pass with zero errors. No type errors from the new `skipGuard` parameter (it has a default value). The new `/api/jobs/memory` route is reachable through the existing auth middleware.

---

## Phase 2: Frontend — Core Job System

### Task 2.1: Add i18n translation keys

**File:** `src/web/i18n.js`

**Lines to change:** Lines 118 (end of `en` block) and line 234 (end of `zh` block)

**Changes:**

1. **Add to `en` object** — Before line 119 (`},` closing the `en` block), insert the following new keys after the last key `"profile-load-error"` (line 118):

   ```javascript
   "modal-confirm-cleanup-title": "Run Cleanup?",
   "modal-confirm-dedup-title": "Run Deduplication?",
   "modal-confirm-cleanup-desc": "This will remove all memories that are no longer relevant. Continue?",
   "modal-confirm-dedup-desc": "This will merge duplicate or highly similar memories. Continue?",
   "btn-confirm": "Confirm",
   "job-status-idle": "Idle",
   "job-status-cleanup-running": "Cleanup in progress...",
   "job-status-dedup-running": "Deduplication in progress...",
   "job-status-tag-running": "Tag Untagged in progress...",
   "job-status-queued": "{count} job(s) queued",
   "job-status-cleanup-failed": "Cleanup failed",
   "job-status-dedup-failed": "Deduplication failed",
   "job-queued": "Job queued successfully",
   "job-already-running": "Job is already queued or running",
   "drawer-title": "MAINTENANCE JOBS",
   "drawer-section-current": "CURRENT",
   "drawer-section-queued": "QUEUED",
   "drawer-section-history": "HISTORY",
   "drawer-no-queued": "No queued jobs",
   "drawer-no-history": "No recent jobs",
   "drawer-job-completed": "Completed",
   "drawer-job-failed": "Failed",
   ```

   > **Note:** `btn-cancel` already exists at line 35/153 — do NOT add a duplicate.

2. **Add to `zh` object** — Before line 235 (`},` closing the `zh` block), insert after the last key `"profile-load-error"` (line 234):

   ```javascript
   "modal-confirm-cleanup-title": "运行清理？",
   "modal-confirm-dedup-title": "运行去重？",
   "modal-confirm-cleanup-desc": "这将删除所有不再相关的记忆。是否继续？",
   "modal-confirm-dedup-desc": "这将合并重复或高度相似的记忆。是否继续？",
   "btn-confirm": "确认",
   "job-status-idle": "空闲",
   "job-status-cleanup-running": "清理进行中...",
   "job-status-dedup-running": "去重进行中...",
   "job-status-tag-running": "标签迁移进行中...",
   "job-status-queued": "{count} 个任务排队中",
   "job-status-cleanup-failed": "清理失败",
   "job-status-dedup-failed": "去重失败",
   "job-queued": "任务已加入队列",
   "job-already-running": "任务已在队列中或正在运行",
   "drawer-title": "维护任务",
   "drawer-section-current": "当前",
   "drawer-section-queued": "排队中",
   "drawer-section-history": "历史",
   "drawer-no-queued": "无排队任务",
   "drawer-no-history": "无最近任务",
   "drawer-job-completed": "已完成",
   "drawer-job-failed": "失败",
   ```

**Verification:** Open `index.html` in browser console and run `t("job-status-idle")` → should return `"Idle"`. Run `setLanguage("zh"); t("job-status-idle")` → should return `"空闲"`.

---

### Task 2.2: Replace migration-status-bar with job-status-bar in HTML

**File:** `src/web/index.html`

**Lines to change:** Line 341

**Changes:**

1. **Replace the migration status bar** — Line 341:

   **BEFORE:**
   ```html
   <div id="migration-status-bar" class="migration-status-bar">Status: Idle</div>
   ```

   **AFTER:**
   ```html
   <div id="job-status-bar" class="job-status-bar">
     <span id="job-status-indicator" class="job-status-indicator"></span>
     <span id="job-status-text" class="job-status-text" data-i18n="job-status-idle">Idle</span>
     <button id="job-drawer-toggle" class="job-drawer-toggle" title="Job Details">
       <i data-lucide="chevron-up" class="icon"></i>
     </button>
   </div>
   ```

**Verification:** The `#migration-status-bar` element no longer exists. `#job-status-bar` is present with three children.

---

### Task 2.3: Add confirmation modal markup

**File:** `src/web/index.html`

**Lines to change:** Insert before `</body>` (before line 343, `<script src="/app.js"></script>`)

**Changes:**

1. **Add modal HTML** — Insert before the `<script>` tag at line 343:

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

**Verification:** `#confirm-modal` exists in DOM. Has class `hidden` by default. Contains title, desc, cancel, and confirm elements.

---

### Task 2.4: Add job status drawer markup

**File:** `src/web/index.html`

**Lines to change:** Insert before `</body>` (after the confirm modal, before the `<script>` tag)

**Changes:**

1. **Add drawer HTML** — Insert after the confirm modal, before `<script>`:

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

**Verification:** `#job-drawer` exists in DOM as a `sheet-overlay`. Has three sections: `#drawer-current`, `#drawer-queued`, `#drawer-history`.

---

### Task 2.5: Implement confirmation modal JS

**File:** `src/web/app.js`

**Lines to change:** Add new functions near the `showToast` function area (around line 718). Add event listeners in the `DOMContentLoaded` handler (around lines 1340-1385).

**Changes:**

1. **Add `confirmModalResolver` state variable** — After line 706 (`let toastTimer = null;`), add:

   ```javascript
   let confirmModalResolver = null;
   ```

2. **Add `openConfirmModal` and `closeConfirmModal` functions** — After the `showToast` function (after line 718), add:

   ```javascript
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

3. **Add event listeners** — In the `DOMContentLoaded` handler, after the existing button listeners (around line 1340), add:

   ```javascript
   document.getElementById("confirm-modal-cancel").addEventListener("click", () => closeConfirmModal(false));
   document.getElementById("confirm-modal-confirm").addEventListener("click", () => closeConfirmModal(true));
   document.getElementById("confirm-modal").addEventListener("click", (e) => {
     if (e.target.id === "confirm-modal") closeConfirmModal(false);
   });
   ```

4. **Extend Escape key handler** — At line 1380-1384, update:

   **BEFORE:**
   ```javascript
   document.addEventListener("keydown", (e) => {
     if (e.key === "Escape") {
       document.getElementById("settings-panel").classList.add("hidden");
       closeProfileSheet();
     }
   });
   ```

   **AFTER:**
   ```javascript
   document.addEventListener("keydown", (e) => {
     if (e.key === "Escape") {
       document.getElementById("settings-panel").classList.add("hidden");
       closeProfileSheet();
       closeJobDrawer();
       closeConfirmModal(false);
     }
   });
   ```

**Verification:** Call `openConfirmModal("modal-confirm-cleanup-title", "modal-confirm-cleanup-desc")` from console — modal should appear. Click Cancel or backdrop — modal should close.

---

### Task 2.6: Rewrite runCleanup() and runDeduplication()

**File:** `src/web/app.js`

**Lines to change:** Lines 768-800

**Changes:**

1. **Replace `runCleanup()`** — Lines 768-781:

   **BEFORE:**
   ```javascript
   async function runCleanup() {
     if (!confirm(t("confirm-cleanup"))) return;

     showToast(t("status-cleanup"), "info");
     const result = await fetchAPI("/api/cleanup", { method: "POST" });

     if (result.success) {
       showToast(t("toast-cleanup-success"), "success");
       await loadMemories();
       await loadStats();
     } else {
       showToast(result.error || t("toast-cleanup-failed"), "error");
     }
   }
   ```

   **AFTER:**
   ```javascript
   async function runCleanup() {
     if (isJobTypeActive("cleanup_memories")) return;

     const confirmed = await openConfirmModal(
       "modal-confirm-cleanup-title",
       "modal-confirm-cleanup-desc"
     );
     if (!confirmed) return;

     const result = await fetchAPI("/api/cleanup", { method: "POST" });

     if (result.success) {
       showToast(t("job-queued"), "info");
       pollJobStatus();
     } else if (result.code === "JOB_ALREADY_QUEUED_OR_RUNNING") {
       showToast(t("job-already-running"), "error");
     } else {
       showToast(result.error || t("toast-cleanup-failed"), "error");
     }
   }
   ```

2. **Replace `runDeduplication()`** — Lines 783-800:

   **BEFORE:**
   ```javascript
   async function runDeduplication() {
     if (!confirm(t("confirm-dedup"))) return;

     showToast(t("status-dedup"), "info");
     const result = await fetchAPI("/api/deduplicate", { method: "POST" });

     if (result.success) {
       const { totalChecked, duplicatesFound, duplicatesRemoved } = result.data || {};
       const msg = duplicatesRemoved > 0
         ? `${t("toast-dedup-success")} (${duplicatesRemoved} ${duplicatesRemoved === 1 ? "duplicate removed" : "duplicates removed"} out of ${totalChecked || 0} checked)`
         : `${t("toast-dedup-success")} (no duplicates found among ${totalChecked || 0} memories)`;
       showToast(msg, "success");
       await loadMemories();
       await loadStats();
     } else {
       showToast(result.error || t("toast-dedup-failed"), "error");
     }
   }
   ```

   **AFTER:**
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

**Verification:** Clicking Cleanup button opens styled modal (not browser `confirm()`). Confirming sends `POST /api/cleanup` and shows info toast "Job queued successfully". No `confirm()` dialog appears.

---

### Task 2.7: Implement job polling system

**File:** `src/web/app.js`

**Lines to change:** Add new functions after the `runDeduplication()` function (after ~line 800). Add state variables to the `state` object. Replace the migration-status-bar polling at lines 1420-1440.

**Changes:**

1. **Add job state variables** — In the `state` object declaration (near the top of the DOMContentLoaded handler, around line 1280), add these properties:

   ```javascript
   lastJobStatus: { activity: { active: false, text: "Idle", queuedCount: 0 }, current: null, queued: [], history: [] },
   // Toast deduplication is handled via the history-based approach in handleJobTransitions()
   jobPollTimer: null,
   jobPollInterval: 5000,
   ```

2. **Add utility functions** — After `runDeduplication()`, add:

   ```javascript
   function truncateText(text, maxLength) {
     if (!text || text.length <= maxLength) return text;
     return text.substring(0, maxLength - 3) + "...";
   }

   function isJobTypeActive(type) {
     return (
       (state.lastJobStatus.current?.type === type &&
        state.lastJobStatus.current?.status === "running") ||
       state.lastJobStatus.queued.some(j => j.type === type)
     );
   }

   function jobTypeLabel(type) {
     const labels = {
       cleanup_memories: "Cleanup",
       deduplicate_memories: "Deduplicate",
       tag_untagged_memories: "Tag Untagged",
     };
     return labels[type] || type;
   }
   ```

3. **Add `updateStatusBar()` function:**

   ```javascript
   function updateStatusBar(data) {
     const indicator = document.getElementById("job-status-indicator");
     const textEl = document.getElementById("job-status-text");

     const active = data.activity.active;
     indicator.classList.toggle("active", active);

     if (!data.activity.active) {
       const recentFailed = data.history?.find(j => j.status === "failed");
       if (recentFailed) {
         textEl.textContent = recentFailed.type === "cleanup_memories"
           ? t("job-status-cleanup-failed")
           : t("job-status-dedup-failed");
       } else {
         textEl.textContent = t("job-status-idle");
       }
     } else if (data.current?.type === "cleanup_memories") {
       textEl.textContent = t("job-status-cleanup-running");
     } else if (data.current?.type === "deduplicate_memories") {
       textEl.textContent = t("job-status-dedup-running");
     } else if (data.current?.type === "tag_untagged_memories") {
       textEl.textContent = t("job-status-tag-running");
     } else if (data.activity.queuedCount > 0) {
       textEl.textContent = t("job-status-queued").replace("{count}", data.activity.queuedCount);
     } else {
       textEl.textContent = t("job-status-idle");
     }
   }
   ```

4. **Add `updateButtonStates()` function:**

   ```javascript
   function updateButtonStates(data) {
     const cleanupBtn = document.getElementById("cleanup-btn");
     const dedupBtn = document.getElementById("deduplicate-btn");

     cleanupBtn.disabled = isJobTypeActive("cleanup_memories");
     dedupBtn.disabled = isJobTypeActive("deduplicate_memories");
   }
   ```

5. **Add `handleJobTransitions()` function:**

   ```javascript
   function handleJobTransitions(prev, curr) {
     if (prev.current && prev.current.status === "running") {
       const prevJobId = prev.current.id;
       const completedJob = curr.history.find(j => j.id === prevJobId);

       if (completedJob) {
         if (completedJob.status === "completed") {
           const summary = completedJob.summary || t("toast-cleanup-success");
           showToast(truncateText(summary, 240), "success");
           loadMemories();
           loadStats();
         } else if (completedJob.status === "failed") {
           const error = completedJob.error || t("toast-cleanup-failed");
           showToast(truncateText(error, 240), "error");
         }
       }
     }
   }
   ```

6. **Add `pollJobStatus()`, `startJobPolling()`, `stopJobPolling()`, `adjustPollInterval()` functions:**

   ```javascript
   async function pollJobStatus() {
     try {
       const result = await fetchAPI("/api/jobs/memory");
       if (!result.success) {
         if (result.error?.includes("401") || result.error?.includes("Unauthorized")) {
           stopJobPolling();
         }
         return;
       }

       const data = result.data;
       const prev = state.lastJobStatus;

       handleJobTransitions(prev, data);

       state.lastJobStatus = data;

       updateStatusBar(data);

       if (document.getElementById("job-drawer").classList.contains("sheet-open")) {
         renderDrawerContent(data);
       }

       updateButtonStates(data);

       adjustPollInterval(data.activity.active);

     } catch (e) {
       console.warn("Job poll error:", e);
     }
   }

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
     pollJobStatus();
   }

   function stopJobPolling() {
     if (state.jobPollTimer) {
       clearInterval(state.jobPollTimer);
       state.jobPollTimer = null;
     }
   }
   ```

7. **Remove old migration-status-bar polling** — **DELETE lines 1420-1440** entirely:

   ```javascript
   // DELETE THIS ENTIRE BLOCK:
   // Migration status bar polling
   setInterval(async () => {
     try {
       const headers = {};
       if (state.authKey) headers["Authorization"] = `Bearer ${state.authKey}`;
       const res = await fetch("/api/migration/tags/progress", { headers });
       const data = await res.json();
       if (data.success) {
         const bar = document.getElementById("migration-status-bar");
         if (bar) {
           if (data.data.status === "running") {
             bar.textContent = `Status: Migrating Memories (${data.data.processed} of ${data.data.total})...`;
           } else {
             bar.textContent = "Status: Idle";
           }
         }
       }
     } catch {
       /* ignore poll errors */
     }
   }, 2000);
   ```

8. **Start job polling** — Replace the deleted block with:

   ```javascript
   startJobPolling();
   ```

   This goes at the same location (after the fallback `setTimeout` at line 1418, before `startAutoRefresh()` at line 1442).

**Verification:** Page loads → status bar appears with "IDLE" text and gray indicator. `GET /api/jobs/memory` requests appear in browser DevTools Network tab every 5 seconds.

---

### Task 2.8: Implement job status drawer

**File:** `src/web/app.js`

**Lines to change:** Add new functions after the polling system functions.

**Changes:**

1. **Add drawer open/close functions:**

   ```javascript
   function openJobDrawer() {
     document.getElementById("job-drawer").classList.add("sheet-open");
     renderDrawerContent(state.lastJobStatus);
   }

   function closeJobDrawer() {
     document.getElementById("job-drawer").classList.remove("sheet-open");
   }
   ```

2. **Add `renderDrawerContent()` and helpers:**

   ```javascript
   function renderDrawerContent(data) {
     renderCurrentJob(data.current);
     renderQueuedJobs(data.queued);
     renderHistoryJobs(data.history);
   }

   function renderCurrentJob(job) {
     const container = document.getElementById("drawer-current");
     if (!job) {
       container.innerHTML = `<div class="drawer-empty">${escapeHtml(t("job-status-idle"))}</div>`;
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
             <i data-lucide="loader" class="icon icon-spin"></i> ${escapeHtml(t("drawer-section-current")).toLowerCase()}
           </span>
         </div>
         ${progress ? `<div class="drawer-job-progress">${escapeHtml(progress)}</div>` : ""}
         <div class="drawer-job-time">${formatDate(job.startedAt || job.createdAt)}</div>
       </div>`;
     lucide.createIcons();
   }

   function renderQueuedJobs(jobs) {
     const container = document.getElementById("drawer-queued");
     if (!jobs || jobs.length === 0) {
       container.innerHTML = `<div class="drawer-empty">${escapeHtml(t("drawer-no-queued"))}</div>`;
       return;
     }
     container.innerHTML = jobs.map(j => `
       <div class="drawer-job-card">
         <div class="drawer-job-header">
           <span class="badge badge-job-type">${escapeHtml(jobTypeLabel(j.type))}</span>
         </div>
         <div class="drawer-job-time">${formatDate(j.createdAt)}</div>
       </div>`).join("");
   }

   function renderHistoryJobs(jobs) {
     const container = document.getElementById("drawer-history");
     if (!jobs || jobs.length === 0) {
       container.innerHTML = `<div class="drawer-empty">${escapeHtml(t("drawer-no-history"))}</div>`;
       return;
     }
     container.innerHTML = jobs.map(j => {
       const isFailed = j.status === "failed";
       const statusText = isFailed ? t("drawer-job-failed") : t("drawer-job-completed");
       const statusClass = isFailed ? "failed" : "completed";
       return `
         <div class="drawer-job-card ${statusClass}">
           <div class="drawer-job-header">
             <span class="badge badge-job-type">${escapeHtml(jobTypeLabel(j.type))}</span>
             <span class="drawer-job-status ${statusClass}">${escapeHtml(statusText)}</span>
           </div>
           ${j.summary ? `<div class="drawer-job-summary">${escapeHtml(truncateText(j.summary, 120))}</div>` : ""}
           ${isFailed && j.error ? `<div class="drawer-job-error">${escapeHtml(truncateText(j.error, 120))}</div>` : ""}
           <div class="drawer-job-time">${formatDate(j.completedAt || j.createdAt)}</div>
         </div>`;
     }).join("");
   }
   ```

   > **Note:** The `formatDate()` function already exists in `app.js` (used for memory display). If it does not exist, add a simple ISO date formatter:
   > ```javascript
   > function formatDate(isoString) {
   >   if (!isoString) return "";
   >   const d = new Date(isoString);
   >   return d.toLocaleString();
   > }
   > ```

3. **Add drawer event listeners** — In the `DOMContentLoaded` handler, after the confirm-modal listeners:

   ```javascript
   document.getElementById("job-drawer-toggle").addEventListener("click", openJobDrawer);
   document.getElementById("job-drawer-close").addEventListener("click", closeJobDrawer);
   document.getElementById("job-drawer").addEventListener("click", (e) => {
     if (e.target.id === "job-drawer") closeJobDrawer();
   });
   ```

**Verification:** Click the chevron button on the status bar → drawer slides in from right. Shows three sections (Current, Queued, History). Click X or backdrop → drawer closes. Press Escape → drawer closes.

---

### Task 2.9: Enhance toast system

**File:** `src/web/app.js`

**Lines to change:** Lines 707-718 (`showToast` function)

**Changes:**

1. **Replace `showToast()`** — Lines 707-718:

   **BEFORE:**
   ```javascript
   function showToast(message, type = "success") {
     if (toastTimer) clearTimeout(toastTimer);
     const toast = document.getElementById("toast");
     toast.textContent = message;
     toast.className = `toast ${type}`;
     toast.classList.remove("hidden");

     toastTimer = setTimeout(() => {
       toast.classList.add("hidden");
       toastTimer = null;
     }, 3000);
   }
   ```

   **AFTER:**
   ```javascript
   function showToast(message, type = "success") {
     if (toastTimer) clearTimeout(toastTimer);
     const toast = document.getElementById("toast");
     const truncatedMsg = truncateText(message, 240);

     const icons = {
       success: "check-circle",
       error: "x-circle",
       info: "info",
     };
     const iconName = icons[type] || icons.info;

     toast.innerHTML = `<i data-lucide="${iconName}" class="toast-icon toast-icon-${type}"></i> <span class="toast-message">${escapeHtml(truncatedMsg)}</span>`;
     toast.className = `toast ${type}`;
     toast.classList.remove("hidden");
     lucide.createIcons({ nodes: [toast] });

     toastTimer = setTimeout(() => {
       toast.classList.add("hidden");
       toastTimer = null;
     }, 3000);
   }
   ```

**Verification:** Call `showToast("Test message", "success")` from console → green-bordered toast with check-circle icon appears for 3 seconds. Call with `"error"` → red border with X icon. Call with `"info"` → cyan border with info icon. Messages >240 chars are truncated.

---

## Phase 3: Styling

### Task 3.1: Add CSS variables

**File:** `src/web/styles.css`

**Lines to change:** Inside `:root` block (near the top of the file)

**Changes:**

Add these variables to the `:root` block (after the existing CSS variables):

```css
/* Job status colors */
--job-active: #39ff14;
--job-idle: var(--faint-foreground);
--job-success: var(--success);
--job-failed: var(--danger);
```

**Verification:** Inspect `:root` in browser DevTools — new variables appear.

---

### Task 3.2: Replace migration-status-bar with job-status-bar styles

**File:** `src/web/styles.css`

**Lines to change:** Lines 1552-1569 (`.migration-status-bar` selector)

**Changes:**

1. **Replace `.migration-status-bar`** — Lines 1552-1569:

   **BEFORE:**
   ```css
   /* ── Migration Status Bar ── */
   .migration-status-bar {
     position: fixed;
     bottom: 0;
     left: 0;
     right: 0;
     height: 26px;
     line-height: 26px;
     background: var(--card);
     border-top: 1px solid var(--border);
     color: var(--primary-bright);
     font-family: var(--font-main);
     font-size: 10px;
     padding: 0 16px;
     z-index: 200;
     letter-spacing: 0.04em;
     text-transform: uppercase;
   }
   ```

   **AFTER:**
   ```css
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
   ```

**Verification:** Status bar appears at bottom of viewport with gray indicator circle, text, and chevron button. Height is 28px.

---

### Task 3.3: Add confirm modal styles

**File:** `src/web/styles.css`

**Lines to change:** Insert after the job status bar styles (after Task 3.2 replacement)

**Changes:**

Add these selectors:

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
```

**Verification:** Confirm modal appears centered with dark theme, max-width 420px. Confirm button is red.

---

### Task 3.4: Add job status drawer styles

**File:** `src/web/styles.css`

**Lines to change:** Insert after the confirm modal styles

**Changes:**

Add these selectors:

```css
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
```

**Verification:** Drawer slides in from right at 360px width. Job cards have colored left borders (green=completed, red=failed, animated green=running).

---

### Task 3.5: Update toast styles

**File:** `src/web/styles.css`

**Lines to change:** Lines 1077-1099 (`.toast` selectors)

**Changes:**

1. **Update `.toast` selector** — Lines 1078-1091:

   **BEFORE:**
   ```css
   .toast {
     position: fixed;
     bottom: 40px;
     right: 20px;
     background: var(--card);
     border: 1px solid var(--primary);
     color: var(--foreground-soft);
     padding: 12px 16px;
     font-size: 11px;
     z-index: 2000;
     max-width: 400px;
     letter-spacing: 0.02em;
     animation: slideInBounce 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55);
   }
   ```

   **AFTER:**
   ```css
   .toast {
     position: fixed;
     bottom: 40px;
     right: 20px;
     background: var(--card);
     border: 1px solid var(--primary);
     color: var(--foreground-soft);
     padding: 12px 16px;
     font-size: 11px;
     z-index: 2000;
     max-width: 400px;
     letter-spacing: 0.02em;
     animation: slideInBounce 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55);
     display: flex;
     align-items: center;
     gap: 8px;
   }
   ```

2. **Update `.toast.success`** — Lines 1097-1099:

   **BEFORE:**
   ```css
   .toast.success {
     border-color: var(--success);
   }
   ```

   **AFTER:**
   ```css
   .toast.success {
     border-color: #00FF00;
   }
   ```

3. **Add `.toast.info` and icon selectors** — After the `.toast.success` block:

   ```css
   .toast.info {
     border-color: var(--primary-bright);
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

**Verification:** Success toast has `#00FF00` green border and green check icon. Error toast has red border and red X icon. Info toast has cyan border and cyan info icon. Toast content is icon + text in a flex row.

---

### Task 3.6: Frontend verification checkpoint

**Commands:**
```bash
bun run typecheck
bun run build
```

**Manual UI verification checklist:**
- [ ] Status bar visible at bottom of screen with "IDLE" text and gray indicator
- [ ] Cleanup button opens styled modal (not browser `confirm()`)
- [ ] Deduplicate button opens styled modal
- [ ] Modal has Cancel and Confirm buttons, closeable via backdrop/Escape
- [ ] Confirming cleanup shows info toast with check icon
- [ ] Status bar indicator turns green and text updates to "CLEANUP IN PROGRESS..."
- [ ] Poll interval changes to 2s while job is active
- [ ] On completion: success toast with summary appears
- [ ] On completion: `loadMemories()` + `loadStats()` refresh the data
- [ ] Drawer opens from right with three sections
- [ ] Drawer shows current job, queued jobs, history
- [ ] Buttons are disabled when same job type is running/queued
- [ ] `GET /api/migration/tags/progress` still works (backward compat)

---

## Phase 4: Integration Testing

### Task 4.1: Docker build and deploy

**Steps:**
1. `docker compose up --build`
2. Wait for health check to pass
3. Verify WebUI loads at `http://localhost:<port>`

### Task 4.2: Functional test — Cleanup flow (AC-3)

**Steps:**
1. Open WebUI
2. Click "Cleanup" button
3. **Verify:** Styled modal appears (not browser `confirm()`)
4. **Verify:** Modal shows "Run Cleanup?" title and description text
5. Click "Confirm"
6. **Verify:** Info toast appears: "Job queued successfully"
7. **Verify:** Status bar indicator turns green, text shows "CLEANUP IN PROGRESS..."
8. **Verify:** Cleanup button is disabled (grayed out)
9. **Wait for completion**
10. **Verify:** Success toast appears with cleanup summary
11. **Verify:** Status bar returns to gray indicator, "IDLE" text
12. **Verify:** Memory list refreshes with updated data

### Task 4.3: Functional test — Deduplicate flow (AC-4)

**Steps:** Same as Task 4.2 but with the "Deduplicate" button.

### Task 4.4: Functional test — Duplicate job handling (AC-10)

**Steps:**
1. Click "Cleanup" → Confirm → Info toast appears
2. Immediately click "Cleanup" again (before poll disables it)
3. **Verify:** Error toast appears: "Job is already queued or running"
4. Wait for cleanup to complete
5. Click "Cleanup" → Confirm
6. **Verify:** Job queues successfully (new info toast)

### Task 4.5: Functional test — Status bar and drawer (AC-5, AC-6)

**Steps:**
1. **Verify:** Status bar visible at all times
2. **Verify:** Gray indicator when idle
3. Trigger a cleanup job
4. **Verify:** Green pulsing indicator while active
5. Click chevron button on status bar
6. **Verify:** Drawer slides in from right
7. **Verify:** Current job section shows running job with type badge
8. **Verify:** Queued section shows any waiting jobs
9. Wait for completion
10. **Verify:** History section shows completed job with summary
11. Click X or backdrop → drawer closes
12. Press Escape → drawer closes (if open)

### Task 4.6: Functional test — Toast behavior (AC-9)

**Steps:**
1. Trigger cleanup → verify info toast (cyan border, info icon)
2. Wait for completion → verify success toast (green border, check icon)
3. Test duplicate job → verify error toast (red border, X icon)
4. **Verify:** All toasts auto-hide after 3 seconds
5. **Verify:** Only one toast visible at a time

### Task 4.7: Auth mode testing (AC-11)

**Steps:**
1. With `DISABLE_WEBUI_AUTH=true`: Verify `GET /api/jobs/memory` works without API key
2. With `DISABLE_WEBUI_AUTH=false`: Verify `GET /api/jobs/memory` requires Bearer token
3. Verify job scope is `all_profiles` when auth disabled
4. Verify job scope is `current_profile` when auth enabled

---

## Phase 5: Cleanup and PR

### Task 5.1: Remove dead/old code

**Specific removals:**
1. `src/web/app.js` — Lines 1420-1440 (old migration-status-bar `setInterval` polling) — **already removed in Task 2.7**
2. `src/web/styles.css` — `.migration-status-bar` selector (lines 1552-1569) — **already replaced in Task 3.2**
3. `src/web/index.html` — `#migration-status-bar` element (line 341) — **already replaced in Task 2.2**

**Imports that can optionally be removed from `web-server.ts` and `web-server-worker.ts`:**
- `handleCleanup` and `handleDeduplicate` imports are no longer called directly from route handlers. However, they are still used transitively by the job service. **Keep them in the import block** — they don't cause harm and removing them would require the job service to import them (which it already does dynamically).

### Task 5.2: Final typecheck and build

**Commands:**
```bash
bun run typecheck
bun run typecheck:all
bun run build
```

### Task 5.3: Git commit and PR

**Steps:**
1. `git add -A && git status` — review changes
2. `git commit -m "feat: wire job queue service, add unified status bar/drawer, replace confirm() with styled modal (refs #15)"`
3. Push and create PR against `main`

---

## Dependency Graph

```
Task 1.1 (web-server.ts)        Task 1.2 (web-server-worker.ts)
        │                                │
        └────────┬───────────────────────┘
                 │
         Task 1.3 (api-handlers.ts guards)
                 │
         Task 1.4 (job-service skipGuard)
                 │
         Task 1.5 (backend checkpoint)
                 │
    ┌────────────┼────────────────┐
    │            │                │
Task 2.1     Task 2.2-2.4     Task 2.5-2.9
(i18n keys)  (HTML markup)   (JS logic)
    │            │                │
    └────────────┼────────────────┘
                 │
         Task 3.1-3.5 (CSS styling)
                 │
         Task 3.6 (frontend checkpoint)
                 │
         Task 4.1-4.7 (integration tests)
                 │
         Task 5.1-5.3 (cleanup + PR)
```

**Parallelizable:**
- Tasks 1.1 and 1.2 can be done in parallel (both server files need the same changes)
- Tasks 2.2, 2.3, 2.4 can be done in parallel (they are independent HTML additions)
- Tasks 3.2, 3.3, 3.4, 3.5 can be done in parallel (independent CSS blocks)

**Sequential dependencies:**
- Task 1.3 depends on Task 1.1/1.2 (guards must be resolved before job service can call handlers)
- Task 1.4 depends on Task 1.3 (job service must pass skipGuard after handlers accept it)
- Task 2.5 depends on Task 2.1 (i18n keys must exist for JS to reference)
- Task 2.6 depends on Task 2.5 (button handlers use the confirm modal)
- Task 2.7 depends on Task 2.6 (polling triggers toast from runCleanup/runDedup)
- Task 2.8 depends on Task 2.7 (drawer renders data from polling)

---

## Risk Mitigation

| Risk | Phase | Mitigation |
|------|-------|------------|
| `handleCleanup(true)` type signature breaks existing callers | 1 | Default value `skipGuard = false` preserves backward compatibility |
| Job service module state not shared between worker and main server | 1 | Each process has its own queue. Acceptable for single-process mode. In worker mode, the worker has its own queue. |
| `fetchAPI` returns non-standard error format for 409 | 2 | Check `result.code === "JOB_ALREADY_QUEUED_OR_RUNNING"` AND `result.success === false` |
| `formatDate()` not defined in app.js | 2 | Check if it exists; if not, add a simple `new Date(isoString).toLocaleString()` wrapper |
| `lucide.createIcons()` not called after drawer innerHTML update | 2 | Explicitly call `lucide.createIcons()` after setting innerHTML in `renderCurrentJob()` |
| CSS z-index conflicts with existing modals | 3 | Status bar z-index=200 (same as old migration bar), drawer z-index=900 (same as profile sheet), confirm modal z-index=1000 (same as edit modal). No conflicts. |
| Toast icon `lucide.createIcons({ nodes: [toast] })` not supported | 3 | Fall back to `lucide.createIcons()` (full DOM scan) if scoped API is unavailable |

---

## Estimated File Changes

| File | Change Type | Lines Affected |
|------|------------|----------------|
| `src/services/web-server.ts` | **MODIFY** | Add import (3 functions), replace 2 route handlers (lines 382-390), add 1 new route handler, add `deriveJobScope()` method |
| `src/services/web-server-worker.ts` | **MODIFY** | Add import (3 functions), replace 2 route handlers (lines 291-299), add 1 new route handler, add `deriveJobScope()` function |
| `src/services/api-handlers.ts` | **MODIFY** | Add `skipGuard = false` param to `handleCleanup()` (line 1384) and `handleDeduplicate()` (line 1450), wrap guard checks and flag sets |
| `src/services/memory-maintenance-job-service.ts` | **MODIFY** | Pass `true` to `handleCleanup()` (line 248) and `handleDeduplicate()` (line 274) |
| `src/web/i18n.js` | **MODIFY** | Add 22 new keys to `en` object, 22 new keys to `zh` object |
| `src/web/index.html` | **MODIFY** | Replace `#migration-status-bar` (line 341), add `#confirm-modal` div, add `#job-drawer` div |
| `src/web/app.js` | **MODIFY** | Replace `runCleanup()` (768-781), replace `runDeduplication()` (783-800), replace `showToast()` (707-718), delete migration polling (1420-1440), add ~20 new functions, add state variables, add event listeners |
| `src/web/styles.css` | **MODIFY** | Add CSS variables, replace `.migration-status-bar` with `.job-status-bar` + children (1552-1569), add confirm modal styles, add drawer styles, update toast styles (1077-1099), add toast icon styles |
