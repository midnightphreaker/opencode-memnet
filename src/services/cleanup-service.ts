import { createMemoryRepository, createUserPromptRepository } from "./storage/factory.js";
import type { MemoryRepository, UserPromptRepository } from "./storage/types.js";
import { CONFIG } from "../config.js";
import { log } from "./logger.js";

const memoryRepo: MemoryRepository = createMemoryRepository();
const promptRepo: UserPromptRepository = createUserPromptRepository();

interface CleanupResult {
  deletedCount: number;
  userCount: number;
  projectCount: number;
  promptsDeleted: number;
  linkedMemoriesDeleted: number;
  pinnedMemoriesSkipped: number;
}

export class CleanupService {
  private lastCleanupTime: number = 0;
  private isRunning: boolean = false;

  async shouldRunCleanup(): Promise<boolean> {
    if (!CONFIG.autoCleanupEnabled) return false;
    if (this.isRunning) return false;

    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    if (now - this.lastCleanupTime < oneDayMs) {
      return false;
    }

    return true;
  }

  async runCleanup(): Promise<CleanupResult> {
    if (this.isRunning) {
      throw new Error("Cleanup already running");
    }

    this.isRunning = true;
    this.lastCleanupTime = Date.now();

    try {
      const cutoffTime = Date.now() - CONFIG.autoCleanupRetentionDays * 24 * 60 * 60 * 1000;

      const promptCleanupResult = await promptRepo.deleteOldPrompts(cutoffTime);
      const linkedMemoryIds = new Set(promptCleanupResult.linkedMemoryIds);

      const oldMemories = await memoryRepo.listOlderThan(cutoffTime);

      let totalDeleted = 0;
      let userDeleted = 0;
      let projectDeleted = 0;
      let linkedMemoriesDeleted = 0;
      let pinnedSkipped = 0;

      for (const memory of oldMemories) {
        try {
          if (memory.isPinned) {
            pinnedSkipped++;
            continue;
          }

          if (linkedMemoryIds.has(memory.id)) {
            continue;
          }

          const deleted = await memoryRepo.delete(memory.id);
          if (deleted) {
            totalDeleted++;

            if (memory.containerTag.includes("_user_")) {
              userDeleted++;
            } else if (memory.containerTag.includes("_project_")) {
              projectDeleted++;
            }
          }
        } catch (error) {
          log("Cleanup: delete error", { memoryId: memory.id, error: String(error) });
        }
      }

      const promptsDeleted = promptCleanupResult.deleted - linkedMemoryIds.size;

      return {
        deletedCount: totalDeleted,
        userCount: userDeleted,
        projectCount: projectDeleted,
        promptsDeleted,
        linkedMemoriesDeleted,
        pinnedMemoriesSkipped: pinnedSkipped,
      };
    } finally {
      this.isRunning = false;
    }
  }

  getStatus() {
    return {
      enabled: CONFIG.autoCleanupEnabled,
      retentionDays: CONFIG.autoCleanupRetentionDays,
      lastCleanupTime: this.lastCleanupTime,
      isRunning: this.isRunning,
    };
  }
}

export const cleanupService = new CleanupService();
