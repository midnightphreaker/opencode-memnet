/**
 * Postgres-backed implementation of UserProfileRepository.
 *
 * Uses JSONB for profile_data and profile_data_snapshot columns.
 * Implements mergeProfileData behavior equivalent to the SQLite UserProfileManager.
 */

import { getPostgresClient, closePostgresClient } from "./client.js";
import { runPostgresMigrations } from "./migrations.js";
import { CONFIG } from "../../../config.js";
import type {
  UserProfileRepository,
  UserProfileRow,
  UserProfileChangelogRow,
  UserProfileData,
} from "../types.js";

// ── Helpers ──

function ensureArray(val: unknown): any[] {
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(val) ? val : [];
}

function rowToProfileRow(row: any): UserProfileRow {
  // profile_data is JSONB, so row.profile_data is already an object
  const profileData =
    typeof row.profile_data === "string"
      ? row.profile_data
      : JSON.stringify(row.profile_data ?? { preferences: [], patterns: [], workflows: [] });

  return {
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    userName: row.user_name,
    userEmail: row.user_email,
    profileData,
    version: row.version,
    createdAt: Number(row.created_at),
    lastAnalyzedAt: Number(row.last_analyzed_at),
    totalPromptsAnalyzed: row.total_prompts_analyzed,
    isActive: row.is_active,
  };
}

function rowToChangelogRow(row: any): UserProfileChangelogRow {
  const snapshot =
    typeof row.profile_data_snapshot === "string"
      ? row.profile_data_snapshot
      : JSON.stringify(
          row.profile_data_snapshot ?? { preferences: [], patterns: [], workflows: [] }
        );

  return {
    id: row.id,
    profileId: row.profile_id,
    version: row.version,
    changeType: row.change_type,
    changeSummary: row.change_summary,
    profileDataSnapshot: snapshot,
    createdAt: Number(row.created_at),
  };
}

// ── Repository ──

export class PostgresUserProfileRepository implements UserProfileRepository {
  async initialize(): Promise<void> {
    await runPostgresMigrations();
  }

  async close(): Promise<void> {
    await closePostgresClient();
  }

  async getActiveProfile(userId: string): Promise<UserProfileRow | null> {
    const sql = getPostgresClient();
    const rows = await sql`
      SELECT * FROM user_profiles
      WHERE user_id = ${userId} AND is_active = true
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    return rowToProfileRow(rows[0]);
  }

  async getProfileById(profileId: string): Promise<UserProfileRow | null> {
    const sql = getPostgresClient();
    const rows = await sql`
      SELECT * FROM user_profiles WHERE id = ${profileId}
    `;
    if (rows.length === 0) return null;
    return rowToProfileRow(rows[0]);
  }

  async getAllActiveProfiles(): Promise<UserProfileRow[]> {
    const sql = getPostgresClient();
    const rows = await sql`
      SELECT * FROM user_profiles WHERE is_active = true
    `;
    return rows.map(rowToProfileRow);
  }

  async createProfile(
    userId: string,
    displayName: string,
    userName: string,
    userEmail: string,
    profileData: UserProfileData,
    promptsAnalyzed: number
  ): Promise<string> {
    const sql = getPostgresClient();
    const id = `profile_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const now = Date.now();

    const cleanedData: UserProfileData = {
      preferences: ensureArray(profileData.preferences),
      patterns: ensureArray(profileData.patterns),
      workflows: ensureArray(profileData.workflows),
    };

    await sql`
      INSERT INTO user_profiles (
        id, user_id, display_name, user_name, user_email,
        profile_data, version, created_at, last_analyzed_at,
        total_prompts_analyzed, is_active
      ) VALUES (
        ${id}, ${userId}, ${displayName}, ${userName}, ${userEmail},
        ${sql.json(cleanedData as any)}, 1, ${now}, ${now},
        ${promptsAnalyzed}, true
      )
      ON CONFLICT (id) DO NOTHING
    `;

    // Add creation changelog
    await this.addChangelog(sql, id, 1, "create", "Initial profile creation", cleanedData);

    return id;
  }

  async updateProfile(
    profileId: string,
    profileData: UserProfileData,
    additionalPromptsAnalyzed: number,
    changeSummary: string
  ): Promise<void> {
    const sql = getPostgresClient();
    const now = Date.now();

    const cleanedData: UserProfileData = {
      preferences: ensureArray(profileData.preferences),
      patterns: ensureArray(profileData.patterns),
      workflows: ensureArray(profileData.workflows),
    };

    // Get current version and increment
    const versionRows = await sql`
      SELECT version FROM user_profiles WHERE id = ${profileId}
    `;
    const currentVersion = Number(versionRows[0]?.version ?? 0);
    const newVersion = currentVersion + 1;

    await sql`
      UPDATE user_profiles SET
        profile_data = ${sql.json(cleanedData as any)},
        version = ${newVersion},
        last_analyzed_at = ${now},
        total_prompts_analyzed = total_prompts_analyzed + ${additionalPromptsAnalyzed}
      WHERE id = ${profileId}
    `;

    await this.addChangelog(sql, profileId, newVersion, "update", changeSummary, cleanedData);
    await this.cleanupOldChangelogs(sql, profileId);
  }

  async deleteProfile(profileId: string): Promise<void> {
    const sql = getPostgresClient();
    await sql`DELETE FROM user_profiles WHERE id = ${profileId}`;
  }

  async applyConfidenceDecay(profileId: string): Promise<void> {
    const sql = getPostgresClient();
    const rows = await sql`
      SELECT profile_data FROM user_profiles WHERE id = ${profileId}
    `;
    if (rows.length === 0) return;

    const profileData: UserProfileData =
      typeof rows[0]!.profile_data === "string"
        ? JSON.parse(rows[0]!.profile_data)
        : (rows[0]!.profile_data as UserProfileData);

    const now = Date.now();
    const decayThreshold = CONFIG.userProfileConfidenceDecayDays * 24 * 60 * 60 * 1000;

    let hasChanges = false;

    profileData.preferences = profileData.preferences
      .map((pref) => {
        const age = now - pref.lastUpdated;
        if (age > decayThreshold) {
          hasChanges = true;
          const decayFactor = Math.max(0.5, 1 - (age - decayThreshold) / decayThreshold);
          return { ...pref, confidence: pref.confidence * decayFactor };
        }
        return pref;
      })
      .filter((pref) => pref.confidence >= 0.3);

    if (hasChanges) {
      await this.updateProfile(
        profileId,
        profileData,
        0,
        "Applied confidence decay to preferences"
      );
    }
  }

  async getProfileChangelogs(
    profileId: string,
    limit: number = 10
  ): Promise<UserProfileChangelogRow[]> {
    const sql = getPostgresClient();
    const rows = await sql`
      SELECT * FROM user_profile_changelogs
      WHERE profile_id = ${profileId}
      ORDER BY version DESC
      LIMIT ${limit}
    `;
    return rows.map(rowToChangelogRow);
  }

  mergeProfileData(existing: UserProfileData, updates: Partial<UserProfileData>): UserProfileData {
    const merged: UserProfileData = {
      preferences: ensureArray(existing?.preferences),
      patterns: ensureArray(existing?.patterns),
      workflows: ensureArray(existing?.workflows),
    };

    if (updates.preferences) {
      const incomingPrefs = ensureArray(updates.preferences);
      for (const newPref of incomingPrefs) {
        const existingIndex = merged.preferences.findIndex(
          (p) => p.category === newPref.category && p.description === newPref.description
        );
        if (existingIndex >= 0) {
          const existingItem = merged.preferences[existingIndex];
          if (existingItem) {
            merged.preferences[existingIndex] = {
              ...newPref,
              confidence: Math.min(1, (existingItem.confidence || 0) + 0.1),
              evidence: [
                ...new Set([
                  ...ensureArray(existingItem.evidence),
                  ...ensureArray(newPref.evidence),
                ]),
              ].slice(0, 5),
              lastUpdated: Date.now(),
            };
          }
        } else {
          merged.preferences.push({ ...newPref, lastUpdated: Date.now() });
        }
      }
      merged.preferences.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
      merged.preferences = merged.preferences.slice(0, CONFIG.userProfileMaxPreferences);
    }

    if (updates.patterns) {
      const incomingPatterns = ensureArray(updates.patterns);
      for (const newPattern of incomingPatterns) {
        const existingIndex = merged.patterns.findIndex(
          (p) => p.category === newPattern.category && p.description === newPattern.description
        );
        if (existingIndex >= 0) {
          const existingItem = merged.patterns[existingIndex];
          if (existingItem) {
            merged.patterns[existingIndex] = {
              ...newPattern,
              frequency: (existingItem.frequency || 1) + 1,
              lastSeen: Date.now(),
            };
          }
        } else {
          merged.patterns.push({ ...newPattern, frequency: 1, lastSeen: Date.now() });
        }
      }
      merged.patterns.sort((a, b) => (b.frequency || 0) - (a.frequency || 0));
      merged.patterns = merged.patterns.slice(0, CONFIG.userProfileMaxPatterns);
    }

    if (updates.workflows) {
      const incomingWorkflows = ensureArray(updates.workflows);
      for (const newWorkflow of incomingWorkflows) {
        const existingIndex = merged.workflows.findIndex(
          (w) => w.description === newWorkflow.description
        );
        if (existingIndex >= 0) {
          const existingItem = merged.workflows[existingIndex];
          if (existingItem) {
            merged.workflows[existingIndex] = {
              ...newWorkflow,
              frequency: (existingItem.frequency || 1) + 1,
            };
          }
        } else {
          merged.workflows.push({ ...newWorkflow, frequency: 1 });
        }
      }
      merged.workflows.sort((a, b) => (b.frequency || 0) - (a.frequency || 0));
      merged.workflows = merged.workflows.slice(0, CONFIG.userProfileMaxWorkflows);
    }

    return merged;
  }

  // ── Private helpers ──

  private async addChangelog(
    sql: any,
    profileId: string,
    version: number,
    changeType: string,
    changeSummary: string,
    profileData: UserProfileData
  ): Promise<void> {
    const id = `changelog_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const now = Date.now();

    await sql`
      INSERT INTO user_profile_changelogs (
        id, profile_id, version, change_type, change_summary,
        profile_data_snapshot, created_at
      ) VALUES (
        ${id}, ${profileId}, ${version}, ${changeType}, ${changeSummary},
        ${sql.json(profileData as any)}, ${now}
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }

  private async cleanupOldChangelogs(sql: any, profileId: string): Promise<void> {
    const retentionCount = CONFIG.userProfileChangelogRetentionCount;

    await sql`
      DELETE FROM user_profile_changelogs
      WHERE profile_id = ${profileId}
        AND id NOT IN (
          SELECT id FROM user_profile_changelogs
          WHERE profile_id = ${profileId}
          ORDER BY version DESC
          LIMIT ${retentionCount}
        )
    `;
  }
}
