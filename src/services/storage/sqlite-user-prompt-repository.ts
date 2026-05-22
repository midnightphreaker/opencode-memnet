/**
 * SQLite-backed implementation of UserPromptRepository.
 * Wraps the existing UserPromptManager singleton.
 */

import { userPromptManager } from "../user-prompt/user-prompt-manager.js";
import type { UserPromptRepository, UserPromptRow } from "./types.js";

function promptToRow(p: any): UserPromptRow {
  return {
    id: p.id,
    sessionId: p.sessionId,
    messageId: p.messageId,
    projectPath: p.projectPath,
    content: p.content,
    createdAt: p.createdAt,
    captured: Number(p.captured),
    userLearningCaptured: p.userLearningCaptured,
    linkedMemoryId: p.linkedMemoryId,
  };
}

export class SqliteUserPromptRepository implements UserPromptRepository {
  async initialize(): Promise<void> {
    // UserPromptManager is initialized at module-load time.
  }

  async close(): Promise<void> {
    // No-op: connection lifecycle is managed by connectionManager.
  }

  async savePrompt(
    sessionId: string,
    messageId: string,
    projectPath: string,
    content: string
  ): Promise<string> {
    return userPromptManager.savePrompt(sessionId, messageId, projectPath, content);
  }

  async getLastUncapturedPrompt(sessionId: string): Promise<UserPromptRow | null> {
    const p = userPromptManager.getLastUncapturedPrompt(sessionId);
    return p ? promptToRow(p) : null;
  }

  async deletePrompt(promptId: string): Promise<void> {
    userPromptManager.deletePrompt(promptId);
  }

  async markAsCaptured(promptId: string): Promise<void> {
    userPromptManager.markAsCaptured(promptId);
  }

  async claimPrompt(promptId: string): Promise<boolean> {
    return userPromptManager.claimPrompt(promptId);
  }

  async countUncapturedPrompts(): Promise<number> {
    return userPromptManager.countUncapturedPrompts();
  }

  async getUncapturedPrompts(limit: number): Promise<UserPromptRow[]> {
    return userPromptManager.getUncapturedPrompts(limit).map(promptToRow);
  }

  async markMultipleAsCaptured(promptIds: string[]): Promise<void> {
    userPromptManager.markMultipleAsCaptured(promptIds);
  }

  async countUnanalyzedForUserLearning(): Promise<number> {
    return userPromptManager.countUnanalyzedForUserLearning();
  }

  async getPromptsForUserLearning(limit: number): Promise<UserPromptRow[]> {
    return userPromptManager.getPromptsForUserLearning(limit).map(promptToRow);
  }

  async markAsUserLearningCaptured(promptId: string): Promise<void> {
    userPromptManager.markAsUserLearningCaptured(promptId);
  }

  async markMultipleAsUserLearningCaptured(promptIds: string[]): Promise<void> {
    userPromptManager.markMultipleAsUserLearningCaptured(promptIds);
  }

  async deleteOldPrompts(
    cutoffTime: number
  ): Promise<{ deleted: number; linkedMemoryIds: string[] }> {
    return userPromptManager.deleteOldPrompts(cutoffTime);
  }

  async linkMemoryToPrompt(promptId: string, memoryId: string): Promise<void> {
    userPromptManager.linkMemoryToPrompt(promptId, memoryId);
  }

  async getPromptById(promptId: string): Promise<UserPromptRow | null> {
    const p = userPromptManager.getPromptById(promptId);
    return p ? promptToRow(p) : null;
  }

  async getCapturedPrompts(projectPath?: string): Promise<UserPromptRow[]> {
    return userPromptManager.getCapturedPrompts(projectPath).map(promptToRow);
  }

  async searchPrompts(
    query: string,
    projectPath?: string,
    limit: number = 20
  ): Promise<UserPromptRow[]> {
    return userPromptManager.searchPrompts(query, projectPath, limit).map(promptToRow);
  }

  async getPromptsByIds(ids: string[]): Promise<UserPromptRow[]> {
    return userPromptManager.getPromptsByIds(ids).map(promptToRow);
  }
}
