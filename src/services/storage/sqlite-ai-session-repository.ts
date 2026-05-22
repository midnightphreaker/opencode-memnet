/**
 * SQLite-backed implementation of AISessionRepository.
 * Wraps the existing AISessionManager singleton.
 */

import { aiSessionManager } from "../ai/session/ai-session-manager.js";
import type { AISessionRepository, AISessionRow, AIMessageRow } from "./types.js";

function sessionToRow(s: any): AISessionRow {
  return {
    id: s.id,
    provider: s.provider,
    sessionId: s.sessionId,
    conversationId: s.conversationId,
    metadata: s.metadata,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    expiresAt: s.expiresAt,
  };
}

function messageToRow(m: any): AIMessageRow {
  return {
    id: m.id,
    aiSessionId: m.aiSessionId,
    sequence: m.sequence,
    role: m.role,
    content: m.content,
    toolCalls: m.toolCalls,
    toolCallId: m.toolCallId,
    contentBlocks: m.contentBlocks,
    createdAt: m.createdAt,
  };
}

export class SqliteAISessionRepository implements AISessionRepository {
  async initialize(): Promise<void> {
    // AISessionManager is initialized at module-load time.
  }

  async close(): Promise<void> {
    // No-op: connection lifecycle is managed by connectionManager.
  }

  async getSession(sessionId: string, provider: string): Promise<AISessionRow | null> {
    const s = aiSessionManager.getSession(sessionId, provider as any);
    return s ? sessionToRow(s) : null;
  }

  async createSession(params: {
    provider: string;
    sessionId: string;
    conversationId?: string;
    metadata?: Record<string, any>;
  }): Promise<AISessionRow> {
    const s = aiSessionManager.createSession({
      provider: params.provider as any,
      sessionId: params.sessionId,
      conversationId: params.conversationId,
      metadata: params.metadata,
    });
    return sessionToRow(s);
  }

  async updateSession(
    sessionId: string,
    provider: string,
    updates: { conversationId?: string; metadata?: Record<string, any> }
  ): Promise<void> {
    aiSessionManager.updateSession(sessionId, provider as any, updates);
  }

  async deleteSession(sessionId: string, provider: string): Promise<void> {
    aiSessionManager.deleteSession(sessionId, provider as any);
  }

  async cleanupExpiredSessions(): Promise<number> {
    return aiSessionManager.cleanupExpiredSessions();
  }

  async addMessage(message: Omit<AIMessageRow, "id" | "createdAt">): Promise<void> {
    aiSessionManager.addMessage({
      aiSessionId: message.aiSessionId,
      sequence: message.sequence,
      role: message.role as any,
      content: message.content,
      toolCalls: message.toolCalls,
      toolCallId: message.toolCallId,
      contentBlocks: message.contentBlocks,
    });
  }

  async getMessages(aiSessionId: string): Promise<AIMessageRow[]> {
    return aiSessionManager.getMessages(aiSessionId).map(messageToRow);
  }

  async getLastSequence(aiSessionId: string): Promise<number> {
    return aiSessionManager.getLastSequence(aiSessionId);
  }

  async clearMessages(aiSessionId: string): Promise<void> {
    aiSessionManager.clearMessages(aiSessionId);
  }
}
