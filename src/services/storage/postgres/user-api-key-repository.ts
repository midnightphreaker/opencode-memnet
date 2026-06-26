import crypto from "node:crypto";
import type { UserApiKeyRepository, UserApiKeyRow } from "../types.js";
import type { SqlClient } from "./client.js";
import { getPostgresClient } from "./client.js";
import { logDebug } from "../../logger.js";

export function hashUserApiKey(apiKey: string): string {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

function toMillis(value: unknown): number | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
  return Number.isFinite(time) ? time : null;
}

function rowToUserApiKey(row: any): UserApiKeyRow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    apiKeyHash: row.api_key_hash,
    createdAt: toMillis(row.created_at) ?? Date.now(),
    updatedAt: toMillis(row.updated_at) ?? Date.now(),
    lastUsedAt: toMillis(row.last_used_at),
    revokedAt: toMillis(row.revoked_at),
  };
}

export class PostgresUserApiKeyRepository implements UserApiKeyRepository {
  private sql(): SqlClient {
    return getPostgresClient();
  }

  async initialize(): Promise<void> {
    logDebug("[user-api-key-repository] initialized");
  }

  async close(): Promise<void> {
    // Connection pool is shared.
  }

  async create(args: {
    id: string;
    name: string;
    description: string;
    apiKeyValue: string;
  }): Promise<UserApiKeyRow> {
    const rows = await this.sql()`
      INSERT INTO user_api_keys (id, name, description, api_key_hash)
      VALUES (${args.id}, ${args.name}, ${args.description}, ${hashUserApiKey(args.apiKeyValue)})
      RETURNING id, name, description, api_key_hash, created_at, updated_at, last_used_at, revoked_at
    `;
    return rowToUserApiKey(rows[0]);
  }

  async list(): Promise<UserApiKeyRow[]> {
    const rows = await this.sql()`
      SELECT id, name, description, api_key_hash, created_at, updated_at, last_used_at, revoked_at
      FROM user_api_keys
      ORDER BY created_at DESC
    `;
    return rows.map(rowToUserApiKey);
  }

  async getById(id: string): Promise<UserApiKeyRow | null> {
    const rows = await this.sql()`
      SELECT id, name, description, api_key_hash, created_at, updated_at, last_used_at, revoked_at
      FROM user_api_keys
      WHERE id = ${id}
      LIMIT 1
    `;
    return rows[0] ? rowToUserApiKey(rows[0]) : null;
  }

  async findByApiKey(apiKeyValue: string): Promise<UserApiKeyRow | null> {
    const hash = hashUserApiKey(apiKeyValue);
    const rows = await this.sql()`
      SELECT id, name, description, api_key_hash, created_at, updated_at, last_used_at, revoked_at
      FROM user_api_keys
      WHERE api_key_hash = ${hash} AND revoked_at IS NULL
      LIMIT 1
    `;
    return rows[0] ? rowToUserApiKey(rows[0]) : null;
  }

  async touchLastUsed(id: string): Promise<void> {
    try {
      await this.sql()`
        UPDATE user_api_keys
        SET last_used_at = now()
        WHERE id = ${id}
          AND (last_used_at IS NULL OR last_used_at < now() - interval '5 minutes')
      `;
    } catch (error) {
      logDebug("[user-api-key-repository] failed to touch last_used_at", {
        id,
        error: String(error),
      });
    }
  }

  async update(args: {
    id: string;
    name?: string;
    description?: string;
  }): Promise<UserApiKeyRow | null> {
    const existing = await this.getById(args.id);
    if (!existing) return null;
    const rows = await this.sql()`
      UPDATE user_api_keys
      SET name = ${args.name ?? existing.name},
          description = ${args.description ?? existing.description},
          updated_at = now()
      WHERE id = ${args.id}
      RETURNING id, name, description, api_key_hash, created_at, updated_at, last_used_at, revoked_at
    `;
    return rows[0] ? rowToUserApiKey(rows[0]) : null;
  }

  async revoke(id: string): Promise<boolean> {
    const rows = await this.sql()`
      UPDATE user_api_keys
      SET revoked_at = COALESCE(revoked_at, now()), updated_at = now()
      WHERE id = ${id}
      RETURNING id
    `;
    return rows.length > 0;
  }
}
