# Issue #15: Backend Job Queue with Unified Status Drawer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move cleanup and deduplicate operations from synchronous inline execution to backend-queued jobs with a custom confirmation modal, unified status bar, and job status drawer.

**Architecture:** Wire the existing dead `memory-maintenance-job-service.ts` into both `web-server.ts` and `web-server-worker.ts` route handlers. Replace browser `confirm()` with a custom centered modal. Add a unified job status bar and right-side drawer. Poll a new `/api/jobs/memory` endpoint for real-time updates.

**Tech Stack:** TypeScript (Bun runtime), vanilla JavaScript, vanilla CSS, PostgreSQL with pgvector, Docker

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/services/api-handlers.ts` | Modify | Add `skipGuard = false` param to `handleCleanup()` and `handleDeduplicate()` so the job queue can bypass boolean guards |
| `src/services/memory-maintenance-job-service.ts` | Modify | Pass `true` to `handleCleanup()` and `handleDeduplicate()` in executor functions |
| `src/services/web-server.ts` | Modify | Import job service, replace cleanup/dedup routes with `enqueueJob()`, add `GET /api/jobs/memory` endpoint, add `deriveJobScope()` method |
| `src/services/web-server-worker.ts` | Modify | Same changes as web-server.ts for feature parity |
| `src/web/i18n.js` | Modify | Add 21 new translation keys to both `en` and `zh` blocks |
| `src/web/index.html` | Modify | Replace `#migration-status-bar` with `#job-status-bar`, add confirm modal, add job drawer |
| `src/web/styles.css` | Modify | Replace migration-status-bar CSS, add job status bar/drawer/modal/toast styles, add CSS variables |
| `src/web/app.js` | Modify | Replace `runCleanup`/`runDeduplication`, replace `showToast`, add polling/drawer/modal functions, delete old migration polling |

---

## Phase 1: Backend (Tasks 1–4)

### Task 1: Add skipGuard parameter to api-handlers.ts

**Files:**
- Modify: `src/services/api-handlers.ts:1384-1448` (handleCleanup)
- Modify: `src/services/api-handlers.ts:1450-1595` (handleDeduplicate)

- [ ] **Step 1: Update handleCleanup signature and guard logic**

Replace lines 1384–1396 in `src/services/api-handlers.ts`:

**BEFORE (lines 1384–1396):**
```typescript
export async function handleCleanup(): Promise<
  ApiResponse<{
    deletedMemories: number;
    deletedMemoriesUser: number;
    deletedMemoriesProject: number;
    deletedPrompts: number;
  }>
> {
  if (_cleanupInProgress) {
    return { success: false, error: "Cleanup is already in progress" };
  }

  _cleanupInProgress = true;
```

**AFTER:**
```typescript
export async function handleCleanup(skipGuard = false): Promise<
  ApiResponse<{
    deletedMemories: number;
    deletedMemoriesUser: number;
    deletedMemoriesProject: number;
    deletedPrompts: number;
  }>
> {
  if (!skipGuard && _cleanupInProgress) {
    return { success: false, error: "Cleanup is already in progress" };
  }
  if (!skipGuard) _cleanupInProgress = true;
```

- [ ] **Step 2: Update handleCleanup finally block**

Replace line 1446 in `src/services/api-handlers.ts`:

**BEFORE:**
```typescript
    _cleanupInProgress = false;
```

**AFTER:**
```typescript
    if (!skipGuard) _cleanupInProgress = false;
```

- [ ] **Step 3: Update handleDeduplicate signature and guard logic**

Replace lines 1450–1461 in `src/services/api-handlers.ts`:

**BEFORE (lines 1450–1461):**
```typescript
export async function handleDeduplicate(): Promise<
  ApiResponse<{
    totalChecked: number;
    groupsChecked: number;
    duplicatesFound: number;
    duplicatesRemoved: number;
  }>
> {
  if (_dedupInProgress) {
    return { success: false, error: "Deduplication is already in progress" };
  }
  _dedupInProgress = true;
```

**AFTER:**
```typescript
export async function handleDeduplicate(skipGuard = false): Promise<
  ApiResponse<{
    totalChecked: number;
    groupsChecked: number;
    duplicatesFound: number;
    duplicatesRemoved: number;
  }>
> {
  if (!skipGuard && _dedupInProgress) {
    return { success: false, error: "Deduplication is already in progress" };
  }
  if (!skipGuard) _dedupInProgress = true;
```

- [ ] **Step 4: Update handleDeduplicate finally block**

Replace line 1593 in `src/services/api-handlers.ts`:

**BEFORE:**
```typescript
    _dedupInProgress = false;
```

**AFTER:**
```typescript
    if (!skipGuard) _dedupInProgress = false;
```

- [ ] **Step 5: Update job service executors to pass skipGuard=true**

In `src/services/memory-maintenance-job-service.ts`, line 248:

**BEFORE:**
```typescript
  const result = await handleCleanup();
```

**AFTER:**
```typescript
  const result = await handleCleanup(true);
```

Line 274:

**BEFORE:**
```typescript
  const result = await handleDeduplicate();
```

**AFTER:**
```typescript
  const result = await handleDeduplicate(true);
```

- [ ] **Step 6: Run typecheck to verify**

Run: `bun run typecheck`
Expected: PASS with zero errors

- [ ] **Step 7: Commit**

```bash
git add src/services/api-handlers.ts src/services/memory-maintenance-job-service.ts
git commit -m "feat: add skipGuard param to handleCleanup/handleDeduplicate, pass true from job service (refs #15)"
```

---

### Task 2: Wire job service into web-server.ts

**Files:**
- Modify: `src/services/web-server.ts:6-35` (imports)
- Modify: `src/services/web-server.ts:382-390` (route handlers)
- Modify: `src/services/web-server.ts` (add deriveJobScope method and new endpoint)

- [ ] **Step 1: Add job service import**

Insert after line 35 in `src/services/web-server.ts` (after the closing brace of the api-handlers import):

```typescript
import {
  enqueueJob,
  getJobStatus,
  getTagMigrationVirtualJob,
} from "./memory-maintenance-job-service.js";
```

- [ ] **Step 2: Add deriveJobScope private method to WebServer class**

Add this method to the `WebServer` class, after the `disableClientAuth` property declaration (after line 55):

```typescript
  private deriveJobScope(): "all_profiles" | "current_profile" {
    return this.disableWebuiAuth ? "all_profiles" : "current_profile";
  }
```

- [ ] **Step 3: Replace POST /api/cleanup route**

Replace lines 382–385 in `src/services/web-server.ts`:

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

- [ ] **Step 4: Replace POST /api/deduplicate route**

Replace lines 387–390 in `src/services/web-server.ts`:

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

- [ ] **Step 5: Add GET /api/jobs/memory endpoint**

Insert immediately after the `/api/deduplicate` route handler replacement (before the `/api/migration/run` handler):

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

- [ ] **Step 6: Run typecheck to verify**

Run: `bun run typecheck`
Expected: PASS with zero errors

- [ ] **Step 7: Commit**

```bash
git add src/services/web-server.ts
git commit -m "feat: wire job service into web-server.ts, replace cleanup/dedup with enqueueJob, add /api/jobs/memory (refs #15)"
```

---

### Task 3: Wire job service into web-server-worker.ts

**Files:**
- Modify: `src/services/web-server-worker.ts:5-31` (imports)
- Modify: `src/services/web-server-worker.ts:291-299` (route handlers)
- Modify: `src/services/web-server-worker.ts` (add deriveJobScope function and new endpoint)

- [ ] **Step 1: Add job service import**

Insert after line 31 in `src/services/web-server-worker.ts` (after the closing brace of the api-handlers import):

```typescript
import {
  enqueueJob,
  getJobStatus,
  getTagMigrationVirtualJob,
} from "./memory-maintenance-job-service.js";
```

- [ ] **Step 2: Add deriveJobScope module-level function**

Insert after line 39 (`const disableClientAuth = ...`):

```typescript
function deriveJobScope(): "all_profiles" | "current_profile" {
  return disableWebuiAuth ? "all_profiles" : "current_profile";
}
```

- [ ] **Step 3: Replace POST /api/cleanup route**

Replace lines 291–294 in `src/services/web-server-worker.ts`:

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

- [ ] **Step 4: Replace POST /api/deduplicate route**

Replace lines 296–299 in `src/services/web-server-worker.ts`:

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

- [ ] **Step 5: Add GET /api/jobs/memory endpoint**

Insert immediately after the `/api/deduplicate` route handler replacement (before the `/api/migration/run` handler):

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

- [ ] **Step 6: Run typecheck to verify**

Run: `bun run typecheck`
Expected: PASS with zero errors

- [ ] **Step 7: Commit**

```bash
git add src/services/web-server-worker.ts
git commit -m "feat: wire job service into web-server-worker.ts, replace cleanup/dedup with enqueueJob, add /api/jobs/memory (refs #15)"
```

---

### Task 4: Backend verification checkpoint

- [ ] **Step 1: Run full typecheck**

Run: `bun run typecheck`
Expected: PASS with zero errors

- [ ] **Step 2: Run full typecheck:all**

Run: `bun run typecheck:all`
Expected: PASS with zero errors

- [ ] **Step 3: Run build**

Run: `bun run build`
Expected: PASS

---

## Phase 2: Frontend Markup (Tasks 5–8)

### Task 5: Add i18n translation keys

**Files:**
- Modify: `src/web/i18n.js:118-119` (end of `en` block)
- Modify: `src/web/i18n.js:233-235` (end of `zh` block)

- [ ] **Step 1: Add keys to the `en` block**

In `src/web/i18n.js`, insert before line 119 (`},` closing the `en` block), after the `"profile-load-error"` key on line 118:

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
    "drawer-title": "Maintenance Jobs",
    "drawer-section-current": "CURRENT",
    "drawer-section-queued": "QUEUED",
    "drawer-section-history": "HISTORY",
    "drawer-no-queued": "No queued jobs",
    "drawer-no-history": "No recent jobs",
    "drawer-job-completed": "Completed",
    "drawer-job-failed": "Failed",
```

> **Note:** `btn-cancel` already exists at line 35/153 — do NOT add a duplicate.

- [ ] **Step 2: Add keys to the `zh` block**

Insert before line 235 (`},` closing the `zh` block), after the `"profile-load-error"` key on line 234:

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

- [ ] **Step 3: Commit**

```bash
git add src/web/i18n.js
git commit -m "feat: add 21 i18n keys for job queue UI (en + zh) (refs #15)"
```

---

### Task 6: Add confirmation modal + status bar + drawer HTML

**Files:**
- Modify: `src/web/index.html:341` (replace migration-status-bar)
- Modify: `src/web/index.html` (insert modal and drawer before script tag)

- [ ] **Step 1: Replace migration-status-bar with job-status-bar**

Replace line 341 in `src/web/index.html`:

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

- [ ] **Step 2: Add confirmation modal**

Insert before the `<script src="/app.js"></script>` line (line 343):

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

- [ ] **Step 3: Add job status drawer**

Insert after the confirm modal, still before the `<script>` tag:

```html
    <!-- Job Status Drawer (right-side slide-in) -->
    <div id="job-drawer" class="sheet-overlay">
      <div class="sheet-panel job-drawer-panel">
        <div class="sheet-header">
          <h3 data-i18n="drawer-title">Maintenance Jobs</h3>
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

- [ ] **Step 4: Commit**

```bash
git add src/web/index.html
git commit -m "feat: replace migration-status-bar, add confirm modal and job drawer HTML (refs #15)"
```

---

### Task 7: Add CSS styles (modal, status bar, drawer, toast)

**Files:**
- Modify: `src/web/styles.css:6-28` (add CSS variables to :root)
- Modify: `src/web/styles.css:1077-1099` (update toast styles)
- Modify: `src/web/styles.css:1552-1569` (replace migration-status-bar)
- Modify: `src/web/styles.css` (append new styles)

- [ ] **Step 1: Add CSS variables to :root**

Insert before line 28 in `src/web/styles.css` (after the `--danger` variable at line 26, before the closing `}` of `:root` at line 28):

```css

  /* Job status colors */
  --job-active: #39ff14;
  --job-idle: var(--faint-foreground);
  --job-success: var(--success);
  --job-failed: var(--danger);
```

- [ ] **Step 2: Update toast styles**

Replace lines 1077–1099 in `src/web/styles.css`:

**BEFORE:**
```css
/* ── Toast ── */
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

.toast.error {
  border-color: var(--danger);
}

.toast.success {
  border-color: var(--success);
}
```

**AFTER:**
```css
/* ── Toast ── */
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

.toast.error {
  border-color: var(--danger);
}

.toast.success {
  border-color: #00FF00;
}

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

- [ ] **Step 3: Replace migration-status-bar with job status bar styles**

Replace lines 1552–1569 in `src/web/styles.css`:

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

- [ ] **Step 4: Commit**

```bash
git add src/web/styles.css
git commit -m "feat: add job status bar, drawer, confirm modal, and enhanced toast CSS (refs #15)"
```

---

### Task 8: Frontend markup verification checkpoint

- [ ] **Step 1: Verify in browser**

Run: `docker compose up --build -d && sleep 15`
Check: Open http://10.9.9.20:4747/, verify:
- Status bar visible at bottom with "IDLE" text and gray indicator circle
- Chevron button visible on right side of status bar
- No `#migration-status-bar` element in DOM
- `#confirm-modal` exists with class `hidden`
- `#job-drawer` exists as `sheet-overlay`

---

## Phase 3: Frontend Logic (Tasks 9–14)

### Task 9: Implement confirmation modal JS

**Files:**
- Modify: `src/web/app.js:706` (add state variable)
- Modify: `src/web/app.js:718` (add functions after showToast)
- Modify: `src/web/app.js:1380-1385` (extend Escape key handler)
- Modify: `src/web/app.js` (add event listeners in DOMContentLoaded)

- [ ] **Step 1: Add confirmModalResolver state variable**

After line 706 (`let toastTimer = null;`), add:

```javascript
let confirmModalResolver = null;
```

- [ ] **Step 2: Add openConfirmModal and closeConfirmModal functions**

After line 718 (after the `showToast` function closing brace), add:

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

- [ ] **Step 3: Add confirm modal event listeners**

In the `DOMContentLoaded` handler, after line 1268 (`document.getElementById("deduplicate-btn").addEventListener...`), add:

```javascript

  document.getElementById("confirm-modal-cancel").addEventListener("click", () => closeConfirmModal(false));
  document.getElementById("confirm-modal-confirm").addEventListener("click", () => closeConfirmModal(true));
  document.getElementById("confirm-modal").addEventListener("click", (e) => {
    if (e.target.id === "confirm-modal") closeConfirmModal(false);
  });
```

- [ ] **Step 4: Extend Escape key handler**

Replace lines 1380–1385 in `src/web/app.js`:

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

> **Note:** `closeJobDrawer()` will be defined in Task 12. If typecheck is run before Task 12 is complete, define a stub: `function closeJobDrawer() { document.getElementById("job-drawer").classList.remove("sheet-open"); }`

- [ ] **Step 5: Commit**

```bash
git add src/web/app.js
git commit -m "feat: add confirmation modal JS (openConfirmModal, closeConfirmModal, event listeners) (refs #15)"
```

---

### Task 10: Rewrite runCleanup() and runDeduplication()

**Files:**
- Modify: `src/web/app.js:768-800` (replace both functions)

- [ ] **Step 1: Add utility functions before runCleanup**

Insert before the `runCleanup` function (before line 768):

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

- [ ] **Step 2: Replace runCleanup()**

Replace lines 768–781 in `src/web/app.js`:

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

- [ ] **Step 3: Replace runDeduplication()**

Replace lines 783–800 in `src/web/app.js`:

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

- [ ] **Step 4: Add job state to state object**

In the `state` object declaration near the top of the file (around lines 3–21), add these properties:

```javascript
  lastJobStatus: { activity: { active: false, text: "Idle", queuedCount: 0 }, current: null, queued: [], history: [] },
  jobPollTimer: null,
  jobPollInterval: 5000,
```

The full `state` object becomes:

```javascript
const state = {
  tags: { project: [] },
  memories: [],
  currentPage: 1,
  pageSize: 20,
  totalPages: 1,
  totalItems: 0,
  selectedTag: "",
  currentView: "project",
  searchQuery: "",
  isSearching: false,
  selectedMemories: new Set(),
  autoRefreshInterval: null,
  userProfile: null,
  authKey: localStorage.getItem("opencode-memnet-apikey") || "",
  activeProfileId: localStorage.getItem("opencode-memnet-active-profile") || "",
  panelViewUserId: "",
  authDisabled: false,
  lastJobStatus: { activity: { active: false, text: "Idle", queuedCount: 0 }, current: null, queued: [], history: [] },
  jobPollTimer: null,
  jobPollInterval: 5000,
};
```

- [ ] **Step 5: Commit**

```bash
git add src/web/app.js
git commit -m "feat: rewrite runCleanup/runDeduplication with confirm modal and job enqueue (refs #15)"
```

---

### Task 11: Implement job polling system

**Files:**
- Modify: `src/web/app.js` (add polling functions after runDeduplication)
- Modify: `src/web/app.js:1420-1442` (replace migration polling with job polling)

- [ ] **Step 1: Add polling and status functions**

After the `runDeduplication` function (after its closing brace), add:

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

function updateButtonStates(data) {
  const cleanupBtn = document.getElementById("cleanup-btn");
  const dedupBtn = document.getElementById("deduplicate-btn");

  cleanupBtn.disabled = isJobTypeActive("cleanup_memories");
  dedupBtn.disabled = isJobTypeActive("deduplicate_memories");
}

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

> **Note:** `renderDrawerContent()` is defined in Task 12. If applying tasks out of order, temporarily comment out the `renderDrawerContent(data)` line or define a stub function.

- [ ] **Step 2: Replace old migration-status-bar polling with startJobPolling**

Replace lines 1420–1440 in `src/web/app.js`:

**BEFORE:**
```javascript
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

  startAutoRefresh();
```

**AFTER:**
```javascript
  startJobPolling();

  startAutoRefresh();
```

- [ ] **Step 3: Commit**

```bash
git add src/web/app.js
git commit -m "feat: add job polling system with status bar updates and transition detection (refs #15)"
```

---

### Task 12: Implement job status drawer

**Files:**
- Modify: `src/web/app.js` (add drawer functions after polling system)
- Modify: `src/web/app.js` (add drawer event listeners in DOMContentLoaded)

- [ ] **Step 1: Add drawer open/close and render functions**

After the `stopJobPolling` function, add:

```javascript

function openJobDrawer() {
  document.getElementById("job-drawer").classList.add("sheet-open");
  renderDrawerContent(state.lastJobStatus);
}

function closeJobDrawer() {
  document.getElementById("job-drawer").classList.remove("sheet-open");
}

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
          <i data-lucide="loader" class="icon icon-spin"></i> Running
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

- [ ] **Step 2: Add drawer event listeners**

In the `DOMContentLoaded` handler, after the confirm-modal event listeners (added in Task 9), add:

```javascript

  document.getElementById("job-drawer-toggle").addEventListener("click", openJobDrawer);
  document.getElementById("job-drawer-close").addEventListener("click", closeJobDrawer);
  document.getElementById("job-drawer").addEventListener("click", (e) => {
    if (e.target.id === "job-drawer") closeJobDrawer();
  });
```

- [ ] **Step 3: Commit**

```bash
git add src/web/app.js
git commit -m "feat: add job status drawer with current/queued/history rendering (refs #15)"
```

---

### Task 13: Enhance toast system

**Files:**
- Modify: `src/web/app.js:707-718` (replace showToast)

- [ ] **Step 1: Replace showToast function**

Replace lines 707–718 in `src/web/app.js`:

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

> **Important:** `truncateText()` is defined as a module-level function in Task 10. It must be accessible at the scope where `showToast` runs. Since both are at module scope (top-level in app.js), this works. If Task 10 hasn't been applied yet, define `truncateText` above `showToast` as: `function truncateText(text, maxLength) { if (!text || text.length <= maxLength) return text; return text.substring(0, maxLength - 3) + "..."; }`

- [ ] **Step 2: Commit**

```bash
git add src/web/app.js
git commit -m "feat: enhance toast with Lucide icons and truncation (refs #15)"
```

---

### Task 14: Frontend logic verification checkpoint

- [ ] **Step 1: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 2: Run build**

Run: `bun run build`
Expected: PASS

- [ ] **Step 3: Verify in browser**

Run: `docker compose up --build -d && sleep 15`
Check: Open http://10.9.9.20:4747/ and verify:
- [ ] Status bar visible at bottom with gray indicator circle and "IDLE" text
- [ ] Click Cleanup → styled modal appears (NOT browser `confirm()`)
- [ ] Modal shows "Run Cleanup?" title with Cancel and Confirm buttons
- [ ] Click Cancel → modal closes, no action
- [ ] Click Confirm → info toast appears with icon: "Job queued successfully"
- [ ] Status bar indicator turns green with pulsing animation
- [ ] Status bar text changes to "CLEANUP IN PROGRESS..."
- [ ] Cleanup button is disabled (grayed out)
- [ ] Wait for completion → success toast appears with cleanup summary
- [ ] Status bar returns to gray indicator and "IDLE" text
- [ ] Memory list refreshes with updated data
- [ ] Click chevron on status bar → drawer slides in from right
- [ ] Drawer shows Current, Queued, History sections
- [ ] Click X on drawer → drawer closes
- [ ] Press Escape → all overlays close
- [ ] Deduplicate button works the same way with its own modal

---

## Phase 4: Integration Testing (Tasks 15–17)

### Task 15: Docker build and deploy

- [ ] **Step 1: Rebuild and deploy**

Run: `docker compose up --build -d`
Expected: Build succeeds, containers start, health check passes

- [ ] **Step 2: Verify WebUI loads**

Run: `sleep 10 && curl -s -o /dev/null -w "%{http_code}" http://10.9.9.20:4747/`
Expected: `200`

- [ ] **Step 3: Verify new API endpoint**

Run: `curl -s http://10.9.9.20:4747/api/jobs/memory | python3 -m json.tool`
Expected:
```json
{
    "success": true,
    "data": {
        "activity": {
            "active": false,
            "text": "Idle",
            "queuedCount": 0
        },
        "current": null,
        "queued": [],
        "history": []
    }
}
```

---

### Task 16: Functional test runs

- [ ] **Test 1: Cleanup flow**
1. Open WebUI at http://10.9.9.20:4747/
2. Click "Cleanup" button
3. Verify: Styled modal appears (not browser `confirm()`)
4. Verify: Modal shows "Run Cleanup?" title and description text
5. Click "Confirm"
6. Verify: Info toast appears: "Job queued successfully" (cyan border, info icon)
7. Verify: Status bar indicator turns green, text shows "CLEANUP IN PROGRESS..."
8. Verify: Cleanup button is disabled (grayed out)
9. Wait for completion
10. Verify: Success toast appears with cleanup summary (green border, check icon)
11. Verify: Status bar returns to gray indicator, "IDLE" text
12. Verify: Memory list refreshes with updated data

- [ ] **Test 2: Deduplicate flow**
1. Click "Deduplicate" button
2. Verify: Styled modal appears with "Run Deduplication?" title
3. Click "Confirm"
4. Verify: Info toast appears
5. Wait for completion
6. Verify: Success toast with dedup summary

- [ ] **Test 3: Duplicate job handling**
1. Click "Cleanup" → Confirm → Info toast appears
2. Immediately click "Cleanup" again (before poll disables it)
3. Verify: Error toast appears: "Job is already queued or running" (red border, X icon)
4. Wait for cleanup to complete
5. Click "Cleanup" → Confirm
6. Verify: Job queues successfully (new info toast)

- [ ] **Test 4: Status bar and drawer**
1. Verify: Status bar visible at all times
2. Verify: Gray indicator when idle
3. Trigger a cleanup job
4. Verify: Green pulsing indicator while active
5. Click chevron button on status bar
6. Verify: Drawer slides in from right
7. Verify: Current job section shows running job with type badge
8. Verify: Queued section shows any waiting jobs
9. Wait for completion
10. Verify: History section shows completed job with summary
11. Click X or backdrop → drawer closes
12. Press Escape → drawer closes (if open)

- [ ] **Test 5: Modal dismiss behavior**
1. Click Cleanup → modal opens
2. Click backdrop → modal closes
3. Click Cleanup → modal opens
4. Press Escape → modal closes
5. Click Cleanup → modal opens
6. Click Cancel → modal closes
7. Verify: No job was enqueued (no toast appeared)

- [ ] **Test 6: Auth endpoint**
1. Verify `GET /api/jobs/memory` works without API key when `DISABLE_WEBUI_AUTH=true`
2. Verify existing `GET /api/migration/tags/progress` still works (backward compat)

---

### Task 17: Final cleanup and commit

- [ ] **Step 1: Run final typecheck**

Run: `bun run typecheck && bun run typecheck:all`
Expected: All pass with zero errors

- [ ] **Step 2: Run final build**

Run: `bun run build`
Expected: PASS

- [ ] **Step 3: Stage and review all changes**

Run: `git add -A && git status`
Expected: Review that all 8 files are modified:
- `src/services/api-handlers.ts`
- `src/services/memory-maintenance-job-service.ts`
- `src/services/web-server.ts`
- `src/services/web-server-worker.ts`
- `src/web/i18n.js`
- `src/web/index.html`
- `src/web/styles.css`
- `src/web/app.js`

- [ ] **Step 4: Final commit**

```bash
git commit -m "feat: wire job queue service, add unified status bar/drawer, replace confirm() with styled modal (refs #15)"
```

---

## Dependency Graph

```
Task 1 (api-handlers skipGuard)
  └── Task 2 (web-server.ts) ──┐
  └── Task 3 (web-server-worker)┤
                                ├── Task 4 (backend checkpoint)
Task 5 (i18n keys)             │
  └── Task 6 (HTML markup)     │
  └── Task 7 (CSS styles)   ───┤── Task 8 (markup checkpoint)
                                │
Task 9 (confirm modal JS)       │
  └── Task 10 (runCleanup/runDedup rewrite + state)
  └── Task 11 (polling system)
  └── Task 12 (drawer)
  └── Task 13 (toast enhancement)
                                ├── Task 14 (logic checkpoint)
                                │
                                ├── Task 15 (Docker build)
                                ├── Task 16 (functional tests)
                                └── Task 17 (final commit)
```

**Parallelizable within phases:**
- Tasks 2 and 3 can be done in parallel (both server files need identical changes)
- Tasks 6 and 7 can be done in parallel (HTML and CSS are independent)
- Tasks 9–13 are sequential (each builds on the previous)

**Critical path:**
Task 1 → Task 2/3 → Task 4 → Task 5 → Task 6/7 → Task 8 → Task 9 → Task 10 → Task 11 → Task 12 → Task 13 → Task 14 → Task 15 → Task 17
