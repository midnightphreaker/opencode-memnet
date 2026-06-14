import crypto from "node:crypto";
import type { ProfileApiKeyRepository } from "../types.js";
import type { SqlClient } from "./client.js";
import { getPostgresClient } from "./client.js";
import { logDebug } from "../../logger.js";
import { timingSafeEqualString } from "../../profile-auth.js";

function hashApiKey(apiKey: string): string {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

export class PostgresProfileApiKeyRepository implements ProfileApiKeyRepository {
  private sql(): SqlClient {
    return getPostgresClient();
  }

  async initialize(): Promise<void> {
    logDebug("[profile-api-key-repository] initialized");
  }

  async close(): Promise<void> {
    // Connection pool is shared.
  }

  async hasKeyForProfile(profileId: string): Promise<boolean> {
    const rows = await this.sql()`
      SELECT 1 FROM profile_api_keys WHERE profile_id = ${profileId} LIMIT 1
    `;
    return rows.length > 0;
  }

  async createKeyForProfile(
    profileId: string,
    apiKey: string,
    createdByClientId?: string
  ): Promise<boolean> {
    const rows = await this.sql()`
      INSERT INTO profile_api_keys (profile_id, api_key_hash, created_by_client_id)
      VALUES (${profileId}, ${hashApiKey(apiKey)}, ${createdByClientId ?? null})
      ON CONFLICT (profile_id) DO NOTHING
      RETURNING profile_id
    `;
    return rows.length > 0;
  }

  async findProfileByApiKey(apiKey: string): Promise<{ profileId: string } | null> {
    const hash = hashApiKey(apiKey);
    const rows = await this.sql()`
      SELECT profile_id, api_key_hash FROM profile_api_keys WHERE api_key_hash = ${hash} LIMIT 1
    `;
    const row = rows[0];
    if (!row || !timingSafeEqualString(hash, row.api_key_hash)) return null;
    return { profileId: row.profile_id };
  }

  async touchLastUsed(profileId: string): Promise<void> {
    await this.sql()`
      UPDATE profile_api_keys SET last_used_at = now() WHERE profile_id = ${profileId}
    `;
  }
}
