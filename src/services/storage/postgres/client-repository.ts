// src/services/storage/postgres/client-repository.ts
import type { SqlClient } from "./client.js";
import { getPostgresClient } from "./client.js";
import type { ClientRepository, ClientRow } from "../types.js";
import { logDebug } from "../../logger.js";

export class PostgresClientRepository implements ClientRepository {
  private sql(): SqlClient {
    return getPostgresClient();
  }

  async initialize(): Promise<void> {
    logDebug("[client-repository] initialized");
  }

  async close(): Promise<void> {
    // Connection pool is shared — don't close here
  }

  private mapRow(row: any): ClientRow {
    return {
      id: row.id,
      nickname: row.nickname,
      userEmail: row.user_email ?? undefined,
      firstSeen: new Date(row.first_seen).getTime(),
      lastSeen: new Date(row.last_seen).getTime(),
      clientMetadata: row.client_metadata ?? {},
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
    };
  }

  async upsertClient(
    id: string,
    metadata: Record<string, any>,
    userEmail?: string
  ): Promise<{ firstTime: boolean; previousLastSeen: number | null; row: ClientRow }> {
    const sql = this.sql();

    // Check if client exists first to detect first-time vs returning
    const existing = await sql`SELECT * FROM clients WHERE id = ${id}`;
    let firstTime = false;
    let previousLastSeen: number | null = null;

    if (existing.length > 0) {
      previousLastSeen = new Date(existing[0]!.last_seen).getTime();
    } else {
      firstTime = true;
    }

    // Use provided userEmail, or keep existing value, or NULL
    const emailValue = userEmail ?? null;

    const rows = await sql`
      INSERT INTO clients (id, nickname, first_seen, last_seen, client_metadata, user_email, created_at, updated_at)
      VALUES (${id}, NULL, now(), now(), ${sql.json(metadata)}, ${emailValue}, now(), now())
      ON CONFLICT (id) DO UPDATE SET
        last_seen = now(),
        client_metadata = ${sql.json(metadata)},
        user_email = COALESCE(${emailValue}, clients.user_email),
        updated_at = now()
      RETURNING *
    `;

    return {
      firstTime,
      previousLastSeen,
      row: this.mapRow(rows[0]!),
    };
  }

  async setNickname(id: string, nickname: string): Promise<ClientRow | null> {
    const sql = this.sql();
    const rows = await sql`
      UPDATE clients SET nickname = ${nickname}, updated_at = now()
      WHERE id = ${id}
      RETURNING *
    `;
    return rows.length > 0 ? this.mapRow(rows[0]!) : null;
  }

  async getClient(id: string): Promise<ClientRow | null> {
    const sql = this.sql();
    const rows = await sql`SELECT * FROM clients WHERE id = ${id}`;
    return rows.length > 0 ? this.mapRow(rows[0]!) : null;
  }

  async getClientStats(id: string): Promise<{
    client: ClientRow | null;
    totalMemories: number;
    memoriesToday: number;
    totalPrompts: number;
  }> {
    const sql = this.sql();
    const clientRow = await this.getClient(id);

    const memResult = await sql`SELECT COUNT(*) as count FROM memories`;
    const totalMemories = parseInt(memResult[0]?.count ?? "0");

    const todayResult = await sql`
      SELECT COUNT(*) as count FROM memories
      WHERE created_at >= (extract(epoch from current_date)::bigint * 1000)
    `;
    const memoriesToday = parseInt(todayResult[0]?.count ?? "0");

    const promptResult = await sql`SELECT COUNT(*) as count FROM user_prompts`;
    const totalPrompts = parseInt(promptResult[0]?.count ?? "0");

    return {
      client: clientRow,
      totalMemories,
      memoriesToday,
      totalPrompts,
    };
  }

  async getClientsByEmail(email: string): Promise<ClientRow[]> {
    const sql = this.sql();
    const rows = await sql`SELECT * FROM clients WHERE user_email = ${email}`;
    return rows.map((row: any) => this.mapRow(row));
  }

  async getEmailByClientId(clientId: string): Promise<string | null> {
    const sql = this.sql();
    const rows = await sql`SELECT user_email FROM clients WHERE id = ${clientId}`;
    if (rows.length === 0) return null;
    return rows[0]!.user_email ?? null;
  }
}
