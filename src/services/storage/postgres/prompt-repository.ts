/**
 * Postgres-backed implementation of UserPromptRepository.
 *
 * Key behaviors:
 * - Atomic `claimPrompt()` with `UPDATE ... WHERE captured = 0 RETURNING id`.
 * - Tri-state `captured`: 0=uncaptured, 1=captured, 2=claimed.
 */

import { getPostgresClient, closePostgresClient } from "./client.js";
import { runPostgresMigrations } from "./migrations.js";
import type { MemoryBankOwner, UserPromptRepository, UserPromptRow } from "../types.js";

function rowToUserPromptRow(row: any): UserPromptRow {
  return {
    id: row.id,
    sessionId: row.session_id,
    messageId: row.message_id,
    profileId: row.profile_id,
    repoId: row.repo_id,
    apiKeyId: row.api_key_id ?? undefined,
    memoryBankId: row.memory_bank_id ?? undefined,
    localProjectPath: row.local_project_path ?? null,
    content: row.content,
    createdAt: Number(row.created_at),
    captured: Number(row.captured),
    userLearningCaptured: row.user_learning_captured,
    linkedMemoryId: row.linked_memory_id,
  };
}

export class PostgresUserPromptRepository implements UserPromptRepository {
  async initialize(): Promise<void> {
    await runPostgresMigrations();
  }

  async close(): Promise<void> {
    await closePostgresClient();
  }

  async savePrompt(args: {
    sessionId: string;
    messageId: string;
    profileId: string;
    repoId: string;
    apiKeyId?: string;
    memoryBankId?: string;
    localProjectPath?: string;
    content: string;
  }): Promise<string> {
    const sql = getPostgresClient();
    const id = `prompt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const now = Date.now();

    await sql`
      INSERT INTO user_prompts (
        id, session_id, message_id, api_key_id, memory_bank_id, profile_id, repo_id, local_project_path,
        content, created_at, captured, user_learning_captured
      ) VALUES (
        ${id}, ${args.sessionId}, ${args.messageId}, ${args.apiKeyId ?? null}, ${args.memoryBankId ?? null},
        ${args.profileId}, ${args.repoId}, ${args.localProjectPath ?? null}, ${args.content}, ${now}, 0, false
      )
      ON CONFLICT (id) DO NOTHING
    `;

    return id;
  }

  async getLastUncapturedPrompt(
    sessionId: string,
    owner?: MemoryBankOwner
  ): Promise<UserPromptRow | null> {
    const sql = getPostgresClient();
    if (owner) {
      const rows = await sql`
        SELECT * FROM user_prompts
        WHERE session_id = ${sessionId}
          AND captured = 0
          AND api_key_id = ${owner.apiKeyId}
          AND memory_bank_id = ${owner.memoryBankId}
        ORDER BY created_at DESC
        LIMIT 1
      `;
      if (rows.length === 0) return null;
      return rowToUserPromptRow(rows[0]);
    }
    const rows = await sql`
      SELECT * FROM user_prompts
      WHERE session_id = ${sessionId} AND captured = 0
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    return rowToUserPromptRow(rows[0]);
  }

  async deletePrompt(promptId: string, owner?: MemoryBankOwner): Promise<void> {
    const sql = getPostgresClient();
    if (owner) {
      await sql`
        DELETE FROM user_prompts
        WHERE id = ${promptId}
          AND api_key_id = ${owner.apiKeyId}
          AND memory_bank_id = ${owner.memoryBankId}
      `;
      return;
    }
    await sql`DELETE FROM user_prompts WHERE id = ${promptId}`;
  }

  async markAsCaptured(promptId: string, owner?: MemoryBankOwner): Promise<void> {
    const sql = getPostgresClient();
    if (owner) {
      await sql`
        UPDATE user_prompts SET captured = 1
        WHERE id = ${promptId}
          AND api_key_id = ${owner.apiKeyId}
          AND memory_bank_id = ${owner.memoryBankId}
      `;
      return;
    }
    await sql`UPDATE user_prompts SET captured = 1 WHERE id = ${promptId}`;
  }

  async claimPrompt(promptId: string, owner?: MemoryBankOwner): Promise<boolean> {
    const sql = getPostgresClient();
    if (owner) {
      const rows = await sql`
        UPDATE user_prompts SET captured = 2
        WHERE id = ${promptId}
          AND captured = 0
          AND api_key_id = ${owner.apiKeyId}
          AND memory_bank_id = ${owner.memoryBankId}
        RETURNING id
      `;
      return rows.length > 0;
    }
    const rows = await sql`
      UPDATE user_prompts SET captured = 2
      WHERE id = ${promptId} AND captured = 0
      RETURNING id
    `;
    return rows.length > 0;
  }

  async releasePrompt(promptId: string, owner?: MemoryBankOwner): Promise<void> {
    const sql = getPostgresClient();
    if (owner) {
      await sql`
        UPDATE user_prompts SET captured = 0
        WHERE id = ${promptId}
          AND captured = 2
          AND api_key_id = ${owner.apiKeyId}
          AND memory_bank_id = ${owner.memoryBankId}
      `;
      return;
    }
    await sql`UPDATE user_prompts SET captured = 0 WHERE id = ${promptId} AND captured = 2`;
  }

  async countUncapturedPrompts(owner?: MemoryBankOwner): Promise<number> {
    const sql = getPostgresClient();
    if (owner) {
      const rows = await sql`
        SELECT COUNT(*) as count FROM user_prompts
        WHERE captured = 0
          AND api_key_id = ${owner.apiKeyId}
          AND memory_bank_id = ${owner.memoryBankId}
      `;
      return Number(rows[0]?.count ?? 0);
    }
    const rows = await sql`
      SELECT COUNT(*) as count FROM user_prompts WHERE captured = 0
    `;
    return Number(rows[0]?.count ?? 0);
  }

  async getUncapturedPrompts(limit: number, owner?: MemoryBankOwner): Promise<UserPromptRow[]> {
    const sql = getPostgresClient();
    if (owner) {
      const rows = await sql`
        SELECT * FROM user_prompts
        WHERE captured = 0
          AND api_key_id = ${owner.apiKeyId}
          AND memory_bank_id = ${owner.memoryBankId}
        ORDER BY created_at ASC
        LIMIT ${limit}
      `;
      return rows.map(rowToUserPromptRow);
    }
    const rows = await sql`
      SELECT * FROM user_prompts
      WHERE captured = 0
      ORDER BY created_at ASC
      LIMIT ${limit}
    `;
    return rows.map(rowToUserPromptRow);
  }

  async markMultipleAsCaptured(promptIds: string[], owner?: MemoryBankOwner): Promise<void> {
    if (promptIds.length === 0) return;
    const sql = getPostgresClient();
    if (owner) {
      await sql`
        UPDATE user_prompts SET captured = 1
        WHERE id IN ${sql(promptIds)}
          AND api_key_id = ${owner.apiKeyId}
          AND memory_bank_id = ${owner.memoryBankId}
      `;
      return;
    }
    await sql`
      UPDATE user_prompts SET captured = 1
      WHERE id IN ${sql(promptIds)}
    `;
  }

  async countUnanalyzedForUserLearning(
    profileId: string,
    owner?: MemoryBankOwner
  ): Promise<number> {
    const sql = getPostgresClient();
    if (owner) {
      const rows = await sql`
        SELECT COUNT(*) as count FROM user_prompts
        WHERE user_learning_captured = false
          AND api_key_id = ${owner.apiKeyId}
          AND memory_bank_id = ${owner.memoryBankId}
      `;
      return Number(rows[0]?.count ?? 0);
    }
    const rows = await sql`
      SELECT COUNT(*) as count FROM user_prompts
      WHERE user_learning_captured = false
        AND profile_id = ${profileId}
    `;
    return Number(rows[0]?.count ?? 0);
  }

  async getPromptsForUserLearning(args: {
    profileId: string;
    limit: number;
    apiKeyId?: string;
    memoryBankId?: string;
  }): Promise<UserPromptRow[]> {
    const sql = getPostgresClient();
    if (args.apiKeyId && args.memoryBankId) {
      const rows = await sql`
        SELECT * FROM user_prompts
        WHERE user_learning_captured = false
          AND api_key_id = ${args.apiKeyId}
          AND memory_bank_id = ${args.memoryBankId}
        ORDER BY created_at ASC
        LIMIT ${args.limit}
      `;
      return rows.map(rowToUserPromptRow);
    }
    const rows = await sql`
      SELECT * FROM user_prompts
      WHERE user_learning_captured = false
        AND profile_id = ${args.profileId}
      ORDER BY created_at ASC
      LIMIT ${args.limit}
    `;
    return rows.map(rowToUserPromptRow);
  }

  async markAsUserLearningCaptured(promptId: string, owner?: MemoryBankOwner): Promise<void> {
    const sql = getPostgresClient();
    if (owner) {
      await sql`
        UPDATE user_prompts SET user_learning_captured = true
        WHERE id = ${promptId}
          AND api_key_id = ${owner.apiKeyId}
          AND memory_bank_id = ${owner.memoryBankId}
      `;
      return;
    }
    await sql`
      UPDATE user_prompts SET user_learning_captured = true WHERE id = ${promptId}
    `;
  }

  async markMultipleAsUserLearningCaptured(
    promptIds: string[],
    owner?: MemoryBankOwner
  ): Promise<void> {
    if (promptIds.length === 0) return;
    const sql = getPostgresClient();
    if (owner) {
      await sql`
        UPDATE user_prompts SET user_learning_captured = true
        WHERE id IN ${sql(promptIds)}
          AND api_key_id = ${owner.apiKeyId}
          AND memory_bank_id = ${owner.memoryBankId}
      `;
      return;
    }
    await sql`
      UPDATE user_prompts SET user_learning_captured = true
      WHERE id IN ${sql(promptIds)}
    `;
  }

  async deleteOldPrompts(args: {
    cutoffTime: number;
    profileId?: string;
    apiKeyId?: string;
    memoryBankId?: string;
  }): Promise<{ deleted: number; linkedMemoryIds: string[] }> {
    const sql = getPostgresClient();
    const profileIdFilter = args.profileId ?? "";
    const owner =
      args.apiKeyId && args.memoryBankId
        ? { apiKeyId: args.apiKeyId, memoryBankId: args.memoryBankId }
        : undefined;

    // Wrap SELECT + DELETE in a transaction to prevent TOCTOU race with concurrent inserts
    return sql.begin(async (tx) => {
      if (owner) {
        const linked = await tx`
          SELECT linked_memory_id FROM user_prompts
          WHERE created_at < ${args.cutoffTime}
            AND linked_memory_id IS NOT NULL
            AND api_key_id = ${owner.apiKeyId}
            AND memory_bank_id = ${owner.memoryBankId}
        `;
        const linkedMemoryIds = linked
          .map((r: any) => r.linked_memory_id)
          .filter((id: string | null): id is string => id != null);

        const result = await tx`
          DELETE FROM user_prompts
          WHERE created_at < ${args.cutoffTime}
            AND api_key_id = ${owner.apiKeyId}
            AND memory_bank_id = ${owner.memoryBankId}
        `;

        return {
          deleted: result.count ?? 0,
          linkedMemoryIds,
        };
      }

      // Collect linked memory IDs before deleting
      const linked = await tx`
        SELECT linked_memory_id FROM user_prompts
        WHERE created_at < ${args.cutoffTime}
          AND linked_memory_id IS NOT NULL
          AND (${profileIdFilter}::text = '' OR profile_id = ${profileIdFilter})
      `;
      const linkedMemoryIds = linked
        .map((r: any) => r.linked_memory_id)
        .filter((id: string | null): id is string => id != null);

      const result = await tx`
        DELETE FROM user_prompts
        WHERE created_at < ${args.cutoffTime}
          AND (${profileIdFilter}::text = '' OR profile_id = ${profileIdFilter})
      `;

      return {
        deleted: result.count ?? 0,
        linkedMemoryIds,
      };
    });
  }

  async linkMemoryToPrompt(
    promptId: string,
    memoryId: string,
    owner?: MemoryBankOwner
  ): Promise<void> {
    const sql = getPostgresClient();
    if (owner) {
      await sql`
        UPDATE user_prompts SET linked_memory_id = ${memoryId}
        WHERE id = ${promptId}
          AND api_key_id = ${owner.apiKeyId}
          AND memory_bank_id = ${owner.memoryBankId}
      `;
      return;
    }
    await sql`
      UPDATE user_prompts SET linked_memory_id = ${memoryId} WHERE id = ${promptId}
    `;
  }

  async getPromptById(promptId: string, owner?: MemoryBankOwner): Promise<UserPromptRow | null> {
    const sql = getPostgresClient();
    if (owner) {
      const rows = await sql`
        SELECT * FROM user_prompts
        WHERE id = ${promptId}
          AND api_key_id = ${owner.apiKeyId}
          AND memory_bank_id = ${owner.memoryBankId}
      `;
      if (rows.length === 0) return null;
      return rowToUserPromptRow(rows[0]);
    }
    const rows = await sql`
      SELECT * FROM user_prompts WHERE id = ${promptId}
    `;
    if (rows.length === 0) return null;
    return rowToUserPromptRow(rows[0]);
  }

  async getCapturedPrompts(args: {
    profileId: string;
    repoId?: string;
    apiKeyId?: string;
    memoryBankId?: string;
  }): Promise<UserPromptRow[]> {
    const sql = getPostgresClient();
    const repoFilter = args.repoId ?? "";
    if (args.apiKeyId && args.memoryBankId) {
      const rows = await sql`
        SELECT * FROM user_prompts
        WHERE captured = 1
          AND api_key_id = ${args.apiKeyId}
          AND memory_bank_id = ${args.memoryBankId}
          AND (${repoFilter}::text = '' OR repo_id = ${repoFilter})
        ORDER BY created_at DESC
      `;

      return rows.map(rowToUserPromptRow);
    }
    const rows = await sql`
      SELECT * FROM user_prompts
      WHERE captured = 1
        AND profile_id = ${args.profileId}
        AND (${repoFilter}::text = '' OR repo_id = ${repoFilter})
      ORDER BY created_at DESC
    `;

    return rows.map(rowToUserPromptRow);
  }

  async searchPrompts(args: {
    query: string;
    profileId: string;
    repoId?: string;
    apiKeyId?: string;
    memoryBankId?: string;
    limit?: number;
  }): Promise<UserPromptRow[]> {
    const sql = getPostgresClient();
    const escaped = args.query.replace(/[%_]/g, "\\$&");
    const likePattern = `%${escaped}%`;
    const repoFilter = args.repoId ?? "";
    if (args.apiKeyId && args.memoryBankId) {
      const rows = await sql`
        SELECT * FROM user_prompts
        WHERE content LIKE ${likePattern} ESCAPE '\\'
          AND captured = 1
          AND api_key_id = ${args.apiKeyId}
          AND memory_bank_id = ${args.memoryBankId}
          AND (${repoFilter}::text = '' OR repo_id = ${repoFilter})
        ORDER BY created_at DESC
        LIMIT ${args.limit ?? 20}
      `;

      return rows.map(rowToUserPromptRow);
    }
    const rows = await sql`
      SELECT * FROM user_prompts
      WHERE content LIKE ${likePattern} ESCAPE '\\'
        AND captured = 1
        AND profile_id = ${args.profileId}
        AND (${repoFilter}::text = '' OR repo_id = ${repoFilter})
      ORDER BY created_at DESC
      LIMIT ${args.limit ?? 20}
    `;

    return rows.map(rowToUserPromptRow);
  }

  async getPromptsByIds(ids: string[], owner?: MemoryBankOwner): Promise<UserPromptRow[]> {
    if (ids.length === 0) return [];
    const sql = getPostgresClient();
    if (owner) {
      const rows = await sql`
        SELECT * FROM user_prompts
        WHERE id IN ${sql(ids)}
          AND api_key_id = ${owner.apiKeyId}
          AND memory_bank_id = ${owner.memoryBankId}
      `;
      return rows.map(rowToUserPromptRow);
    }
    const rows = await sql`
      SELECT * FROM user_prompts WHERE id IN ${sql(ids)}
    `;
    return rows.map(rowToUserPromptRow);
  }
}
