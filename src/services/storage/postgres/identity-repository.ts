/**
 * Postgres-backed implementation of UserIdentityRepository.
 *
 * The `user_identities` table is the canonical identity store.
 * All nickname reads and writes flow through this table.
 */

import crypto from "node:crypto";
import { getPostgresClient } from "./client.js";
import { runPostgresMigrations } from "./migrations.js";
import type { UserIdentityRepository, UserIdentityRow } from "../types.js";
import { logDebug, logError } from "../../logger.js";

export class PostgresUserIdentityRepository implements UserIdentityRepository {
  async initialize(): Promise<void> {
    await runPostgresMigrations();
    logDebug("[identity-repository] initialized");
  }

  async close(): Promise<void> {
    // Connection pool is shared — don't close here
  }

  private mapRow(row: any): UserIdentityRow {
    return {
      id: row.id,
      email: row.email,
      nickname: row.nickname ?? null,
      displayName: row.display_name ?? null,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
    };
  }

  async getByEmail(email: string): Promise<UserIdentityRow | null> {
    const sql = getPostgresClient();
    const rows = await sql`SELECT * FROM user_identities WHERE email = ${email}`;
    return rows.length > 0 ? this.mapRow(rows[0]) : null;
  }

  async getById(id: string): Promise<UserIdentityRow | null> {
    const sql = getPostgresClient();
    const rows = await sql`SELECT * FROM user_identities WHERE id = ${id}`;
    return rows.length > 0 ? this.mapRow(rows[0]) : null;
  }

  async upsertIdentity(
    email: string,
    data: { nickname?: string; displayName?: string }
  ): Promise<UserIdentityRow> {
    const sql = getPostgresClient();

    const id = `uid_${crypto.randomUUID()}`;

    const nickname = data.nickname ?? null;
    const displayName = data.displayName ?? null;

    const rows = await sql`
      INSERT INTO user_identities (id, email, nickname, display_name, created_at, updated_at)
      VALUES (${id}, ${email}, ${nickname}, ${displayName}, now(), now())
      ON CONFLICT (email) DO UPDATE SET
        nickname = COALESCE(${nickname}, user_identities.nickname),
        display_name = COALESCE(${displayName}, user_identities.display_name),
        updated_at = now()
      RETURNING *
    `;

    return this.mapRow(rows[0]);
  }

  async setNickname(email: string, nickname: string): Promise<boolean> {
    try {
      await this.upsertIdentity(email, { nickname });
      return true;
    } catch {
      return false;
    }
  }

  async getNickname(email: string): Promise<string | null> {
    const sql = getPostgresClient();
    const rows = await sql`SELECT nickname FROM user_identities WHERE email = ${email}`;
    if (rows.length === 0) return null;
    return rows[0]!.nickname ?? null;
  }
}
