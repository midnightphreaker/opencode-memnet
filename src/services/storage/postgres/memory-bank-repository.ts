import type { MemoryBankRepository, MemoryBankRow } from "../types.js";
import type { SqlClient } from "./client.js";
import { getPostgresClient } from "./client.js";
import { logDebug } from "../../logger.js";

function toMillis(value: unknown): number {
  const time = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
  return Number.isFinite(time) ? time : Date.now();
}

function rowToMemoryBank(row: any): MemoryBankRow {
  const apiKeyName = row.api_key_name ?? row.apiKeyName ?? "";
  return {
    id: row.id,
    apiKeyId: row.api_key_id,
    apiKeyName,
    name: row.name,
    description: row.description,
    shortcut: `${apiKeyName}>${row.name}`,
    createdAt: toMillis(row.created_at),
    updatedAt: toMillis(row.updated_at),
  };
}

export class PostgresMemoryBankRepository implements MemoryBankRepository {
  private sql(): SqlClient {
    return getPostgresClient();
  }

  async initialize(): Promise<void> {
    logDebug("[memory-bank-repository] initialized");
  }

  async close(): Promise<void> {
    // Connection pool is shared.
  }

  async create(args: {
    id: string;
    apiKeyId: string;
    name: string;
    description: string;
  }): Promise<MemoryBankRow> {
    const rows = await this.sql()`
      INSERT INTO memory_banks (id, api_key_id, name, description)
      VALUES (${args.id}, ${args.apiKeyId}, ${args.name}, ${args.description})
      RETURNING id, api_key_id, name, description, created_at, updated_at
    `;
    const apiKeyRows = await this.sql()`SELECT name FROM user_api_keys WHERE id = ${args.apiKeyId}`;
    return rowToMemoryBank({ ...rows[0], api_key_name: apiKeyRows[0]?.name ?? "" });
  }

  async listForApiKey(apiKeyId: string): Promise<MemoryBankRow[]> {
    const rows = await this.sql()`
      SELECT b.id, b.api_key_id, k.name AS api_key_name, b.name, b.description, b.created_at, b.updated_at
      FROM memory_banks b
      JOIN user_api_keys k ON k.id = b.api_key_id
      WHERE b.api_key_id = ${apiKeyId}
      ORDER BY b.name ASC
    `;
    return rows.map(rowToMemoryBank);
  }

  async getForApiKey(args: {
    apiKeyId: string;
    memoryBankId: string;
  }): Promise<MemoryBankRow | null> {
    const rows = await this.sql()`
      SELECT b.id, b.api_key_id, k.name AS api_key_name, b.name, b.description, b.created_at, b.updated_at
      FROM memory_banks b
      JOIN user_api_keys k ON k.id = b.api_key_id
      WHERE b.api_key_id = ${args.apiKeyId} AND b.id = ${args.memoryBankId}
      LIMIT 1
    `;
    return rows[0] ? rowToMemoryBank(rows[0]) : null;
  }

  async getById(memoryBankId: string): Promise<MemoryBankRow | null> {
    const rows = await this.sql()`
      SELECT b.id, b.api_key_id, k.name AS api_key_name, b.name, b.description, b.created_at, b.updated_at
      FROM memory_banks b
      JOIN user_api_keys k ON k.id = b.api_key_id
      WHERE b.id = ${memoryBankId}
      LIMIT 1
    `;
    return rows[0] ? rowToMemoryBank(rows[0]) : null;
  }

  async update(args: {
    id: string;
    name?: string;
    description?: string;
  }): Promise<MemoryBankRow | null> {
    const existing = await this.getById(args.id);
    if (!existing) return null;
    const rows = await this.sql()`
      UPDATE memory_banks
      SET name = ${args.name ?? existing.name},
          description = ${args.description ?? existing.description},
          updated_at = now()
      WHERE id = ${args.id}
      RETURNING id, api_key_id, name, description, created_at, updated_at
    `;
    return rows[0] ? rowToMemoryBank({ ...rows[0], api_key_name: existing.apiKeyName }) : null;
  }

  async countRowsForBank(id: string): Promise<{
    memories: number;
    prompts: number;
    profileLearning: number;
    aiSessions: number;
    aiMessages: number;
  }> {
    const memoryRows =
      await this.sql()`SELECT COUNT(*)::int AS count FROM memories WHERE memory_bank_id = ${id}`;
    const promptRows =
      await this.sql()`SELECT COUNT(*)::int AS count FROM user_prompts WHERE memory_bank_id = ${id}`;
    const profileRows =
      await this.sql()`SELECT COUNT(*)::int AS count FROM user_profiles WHERE memory_bank_id = ${id}`;
    const changelogRows =
      await this.sql()`SELECT COUNT(*)::int AS count FROM user_profile_changelogs WHERE memory_bank_id = ${id}`;
    const aiSessionRows =
      await this.sql()`SELECT COUNT(*)::int AS count FROM ai_sessions WHERE memory_bank_id = ${id}`;
    const aiMessageRows =
      await this.sql()`SELECT COUNT(*)::int AS count FROM ai_messages WHERE memory_bank_id = ${id}`;
    return {
      memories: Number(memoryRows[0]?.count ?? 0),
      prompts: Number(promptRows[0]?.count ?? 0),
      profileLearning: Number(profileRows[0]?.count ?? 0) + Number(changelogRows[0]?.count ?? 0),
      aiSessions: Number(aiSessionRows[0]?.count ?? 0),
      aiMessages: Number(aiMessageRows[0]?.count ?? 0),
    };
  }

  async explainBankFilteredVectorSearch(args: {
    memoryBankId: string;
    queryVector: string;
    vectorCast: string;
    candidateLimit: number;
  }): Promise<string> {
    const rows = await this.sql().unsafe(
      `
      EXPLAIN SELECT id
      FROM memories
      WHERE memory_bank_id = $1::uuid
      ORDER BY vector <=> $2::${args.vectorCast}
      LIMIT $3
      `,
      [args.memoryBankId, args.queryVector, args.candidateLimit]
    );
    return rows.map((row: any) => String(row["QUERY PLAN"] ?? "")).join("\n");
  }

  async delete(id: string): Promise<boolean> {
    const counts = await this.countRowsForBank(id);
    if (Object.values(counts).some((count) => count > 0)) {
      throw new Error("Memory Bank is not empty and cannot be deleted");
    }
    const rows = await this.sql()`DELETE FROM memory_banks WHERE id = ${id} RETURNING id`;
    return rows.length > 0;
  }
}

/*
 * Bank-filtered pgvector acceptance notes for Task 2:
 * - Query shape includes WHERE memory_bank_id = $bank before results are returned.
 * - Integration fixtures should cover multiple small banks and one larger bank.
 * - EXPLAIN plan text must be captured and checked for the bank filter.
 * - Tune hnsw.ef_search when global HNSW indexes are filtered by Memory Bank.
 * - Accepted candidate limit: 200; latency budget: p95 under 250ms on local compose data.
 */
