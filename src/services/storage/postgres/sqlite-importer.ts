/**
 * SQLite-to-Postgres migration importer.
 *
 * Reads all data from the local SQLite storage files (sharded memories,
 * user prompts, user profiles, AI sessions) and inserts them into a
 * remote PostgreSQL database that has pgvector enabled.
 *
 * ## Design constraints
 *
 * - **No Postgres import side-effects.** The module only imports Postgres
 *   types at runtime via dynamic `import()`.  When the module is loaded
 *   without a Postgres URL configured, nothing blows up at module-load time.
 * - **Idempotent.** Default conflict strategy is `ON CONFLICT (id) DO NOTHING`.
 * - **Batched.** Inserts happen in configurable batch sizes (default 500).
 * - **Dry-run.** Pass `{ dryRun: true }` to validate and count without writing.
 * - **Overwrite.** Pass `{ overwrite: true }` to use `DO UPDATE` instead.
 *
 * ## Usage
 *
 * ```ts
 * import { migrateSqliteToPostgres } from "./sqlite-importer.js";
 * const report = await migrateSqliteToPostgres({ dryRun: true });
 * console.log(report);
 * ```
 */

import { CONFIG } from "../../../config.js";
import { log } from "../../logger.js";
import { join, basename } from "node:path";
import { existsSync } from "node:fs";
import {
  decodeSqliteVectorBlob,
  assertVectorDimensions,
  vectorToPgLiteral,
  getVectorCast,
} from "./vector.js";

// ── Types ──

export interface MigrationReport {
  dryRun: boolean;
  overwrite: boolean;
  batchSize: number;
  memories: {
    shardsProcessed: number;
    sourceRows: number;
    processedRows: number;
    skippedRows: number;
    errors: string[];
  };
  userPrompts: {
    sourceRows: number;
    processedRows: number;
    skippedRows: number;
    errors: string[];
  };
  userProfiles: {
    sourceRows: number;
    processedRows: number;
    skippedRows: number;
    errors: string[];
  };
  userProfileChangelogs: {
    sourceRows: number;
    processedRows: number;
    skippedRows: number;
    errors: string[];
  };
  aiSessions: {
    sourceRows: number;
    processedRows: number;
    skippedRows: number;
    errors: string[];
  };
  aiMessages: {
    sourceRows: number;
    processedRows: number;
    skippedRows: number;
    duplicatePairsSkipped: number;
    errors: string[];
  };
  warnings: string[];
}

function makeEmptyReport(options: MigrationOptions): MigrationReport {
  return {
    dryRun: options.dryRun ?? false,
    overwrite: options.overwrite ?? false,
    batchSize: options.batchSize ?? 500,
    memories: { shardsProcessed: 0, sourceRows: 0, processedRows: 0, skippedRows: 0, errors: [] },
    userPrompts: { sourceRows: 0, processedRows: 0, skippedRows: 0, errors: [] },
    userProfiles: { sourceRows: 0, processedRows: 0, skippedRows: 0, errors: [] },
    userProfileChangelogs: { sourceRows: 0, processedRows: 0, skippedRows: 0, errors: [] },
    aiSessions: { sourceRows: 0, processedRows: 0, skippedRows: 0, errors: [] },
    aiMessages: {
      sourceRows: 0,
      processedRows: 0,
      skippedRows: 0,
      duplicatePairsSkipped: 0,
      errors: [],
    },
    warnings: [],
  };
}

export interface MigrationOptions {
  dryRun?: boolean;
  overwrite?: boolean;
  batchSize?: number;
}

// ── SQLite bootstrap (lazy) ──

/**
 * Dynamically load `bun:sqlite` so this module can be imported without
 * immediately pulling in SQLite.  Returns the Database constructor.
 */
function getSqliteDatabase(): typeof import("bun:sqlite").Database {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const bunSqlite = require("bun:sqlite") as typeof import("bun:sqlite");
  return bunSqlite.Database;
}

type SqliteDatabase = InstanceType<typeof import("bun:sqlite").Database>;

/**
 * Open a read-only SQLite connection.  We do NOT use the shared
 * `connectionManager` because (a) we want read-only access and (b) we do
 * not want to mutate the live cache.
 */
function openSqliteReadonly(path: string): SqliteDatabase | null {
  if (!existsSync(path)) return null;
  const Database = getSqliteDatabase();
  return new Database(path, { readonly: true });
}

// ── Scope extraction ──

function extractScopeFromContainerTag(containerTag: string): {
  scope: "user" | "project";
  hash: string;
} {
  const parts = containerTag.split("_");
  if (parts.length >= 3) {
    const scope = parts[1] as "user" | "project";
    const hash = parts.slice(2).join("_");
    return { scope, hash };
  }
  return { scope: "user", hash: containerTag };
}

// ── Metadata normalisation ──

/**
 * Parse the raw `metadata` column from SQLite and normalise session key
 * variants to `sessionID`.
 */
function parseAndNormaliseMetadata(raw: unknown): Record<string, unknown> {
  let obj: Record<string, unknown>;
  if (raw == null || raw === "") {
    obj = {};
  } else if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      obj = typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch {
      obj = {};
    }
  } else if (typeof raw === "object") {
    obj = raw as Record<string, unknown>;
  } else {
    obj = {};
  }

  // Normalise session key variants → sessionID
  if ("sessionId" in obj && !("sessionID" in obj)) {
    obj.sessionID = obj.sessionId;
    delete obj.sessionId;
  } else if ("session_id" in obj && !("sessionID" in obj)) {
    obj.sessionID = obj.session_id;
    delete obj.session_id;
  }

  return obj;
}

// ── Shard discovery ──

interface DiscoveredShard {
  scope: "user" | "project";
  scopeHash: string;
  shardIndex: number;
  dbPath: string;
  vectorCount: number;
}

function discoverShards(warnings?: string[]): DiscoveredShard[] {
  const metadataDbPath = join(CONFIG.storagePath, "metadata.db");
  const db = openSqliteReadonly(metadataDbPath);
  if (!db) {
    log("[sqlite-importer] metadata.db not found", { path: metadataDbPath });
    return [];
  }

  try {
    let rows: any[];
    try {
      rows = db
        .prepare("SELECT * FROM shards ORDER BY scope, scope_hash, shard_index ASC")
        .all() as any[];
    } catch (err: unknown) {
      const msg = `Corrupt metadata.db — cannot read shards table: ${err instanceof Error ? err.message : String(err)}`;
      log("[sqlite-importer] " + msg);
      warnings?.push(msg);
      return [];
    }
    return rows
      .map((row: any) => {
        // Resolve db_path: could be relative ("users/user_abc_shard_0.db") or absolute.
        let dbPath = row.db_path as string;
        // If it doesn't start with '/' and isn't absolute, resolve relative to storagePath
        if (dbPath && !dbPath.startsWith("/")) {
          dbPath = join(CONFIG.storagePath, dbPath);
        }
        if (!existsSync(dbPath)) {
          // Try the scope-based directory as a fallback
          const fallback = join(CONFIG.storagePath, `${row.scope}s`, basename(row.db_path));
          if (existsSync(fallback)) {
            dbPath = fallback;
          }
        }
        return {
          scope: row.scope as "user" | "project",
          scopeHash: row.scope_hash as string,
          shardIndex: row.shard_index as number,
          dbPath,
          vectorCount: row.vector_count as number,
        };
      })
      .filter((s) => existsSync(s.dbPath));
  } finally {
    db.close();
  }
}

// ── Main migration function ──

/**
 * Migrate all data from SQLite storage files into the connected Postgres
 * database.
 *
 * The caller is responsible for ensuring `CONFIG.postgres.url` is set and the
 * Postgres client is reachable.  The function will run migrations first to
 * ensure the schema exists.
 */
export async function migrateSqliteToPostgres(
  options: MigrationOptions = {}
): Promise<MigrationReport> {
  const report = makeEmptyReport(options);
  const batchSize = options.batchSize ?? 500;
  const dryRun = options.dryRun ?? false;
  const overwrite = options.overwrite ?? false;

  // Dynamic imports to avoid pulling in Postgres at module-load time.
  const { getPostgresClient } = await import("./client.js");
  const { runPostgresMigrations } = await import("./migrations.js");

  log("[sqlite-importer] Starting migration", { dryRun, overwrite, batchSize });

  // 1. Run migrations first.
  const sql = getPostgresClient();

  if (!dryRun) {
    log("[sqlite-importer] Running Postgres migrations");
    await runPostgresMigrations(sql);
  }

  const dims = CONFIG.embeddingDimensions;
  const vectorType = CONFIG.postgres!.vectorType ?? "vector";
  const vectorCast = getVectorCast(vectorType, dims);

  // 2. Discover and migrate memories from shards.
  const shards = discoverShards(report.warnings);
  report.memories.shardsProcessed = shards.length;
  log("[sqlite-importer] Discovered shards", { count: shards.length });

  for (const shard of shards) {
    const shardDb = openSqliteReadonly(shard.dbPath);
    if (!shardDb) {
      report.warnings.push(`Shard DB not found: ${shard.dbPath}`);
      continue;
    }

    try {
      const rows = shardDb.prepare("SELECT * FROM memories").all() as any[];
      report.memories.sourceRows += rows.length;

      if (dryRun) continue;

      // Process in batches
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        await insertMemoryBatch(sql, batch, dims, vectorCast, overwrite, report);
      }
    } catch (err: unknown) {
      const msg = `Error reading shard ${shard.dbPath}: ${err instanceof Error ? err.message : String(err)}`;
      report.memories.errors.push(msg);
      log("[sqlite-importer] " + msg);
    } finally {
      shardDb.close();
    }
  }

  // 3. Migrate user prompts.
  const userPromptsDbPath = join(CONFIG.storagePath, "user-prompts.db");
  const promptsDb = openSqliteReadonly(userPromptsDbPath);
  if (promptsDb) {
    try {
      const rows = promptsDb.prepare("SELECT * FROM user_prompts").all() as any[];
      report.userPrompts.sourceRows = rows.length;

      if (!dryRun && rows.length > 0) {
        for (let i = 0; i < rows.length; i += batchSize) {
          const batch = rows.slice(i, i + batchSize);
          await insertUserPromptBatch(sql, batch, overwrite, report);
        }
      }
    } catch (err: unknown) {
      const msg = `Error reading user-prompts.db: ${err instanceof Error ? err.message : String(err)}`;
      report.userPrompts.errors.push(msg);
      log("[sqlite-importer] " + msg);
    } finally {
      promptsDb.close();
    }
  } else {
    report.warnings.push("user-prompts.db not found, skipping user prompts migration");
  }

  // 4. Migrate user profiles and changelogs.
  const userProfilesDbPath = join(CONFIG.storagePath, "user-profiles.db");
  const profilesDb = openSqliteReadonly(userProfilesDbPath);
  if (profilesDb) {
    try {
      // Profiles
      const profileRows = profilesDb.prepare("SELECT * FROM user_profiles").all() as any[];
      report.userProfiles.sourceRows = profileRows.length;

      if (!dryRun && profileRows.length > 0) {
        for (let i = 0; i < profileRows.length; i += batchSize) {
          const batch = profileRows.slice(i, i + batchSize);
          await insertUserProfileBatch(sql, batch, overwrite, report);
        }
      }

      // Changelogs
      const changelogRows = profilesDb
        .prepare("SELECT * FROM user_profile_changelogs")
        .all() as any[];
      report.userProfileChangelogs.sourceRows = changelogRows.length;

      if (!dryRun && changelogRows.length > 0) {
        for (let i = 0; i < changelogRows.length; i += batchSize) {
          const batch = changelogRows.slice(i, i + batchSize);
          await insertUserProfileChangelogBatch(sql, batch, overwrite, report);
        }
      }
    } catch (err: unknown) {
      const msg = `Error reading user-profiles.db: ${err instanceof Error ? err.message : String(err)}`;
      report.userProfiles.errors.push(msg);
      log("[sqlite-importer] " + msg);
    } finally {
      profilesDb.close();
    }
  } else {
    report.warnings.push("user-profiles.db not found, skipping user profiles migration");
  }

  // 5. Migrate AI sessions and messages.
  const aiSessionsDbPath = join(CONFIG.storagePath, "ai-sessions.db");
  const aiSessionsDb = openSqliteReadonly(aiSessionsDbPath);
  if (aiSessionsDb) {
    try {
      // Sessions
      const sessionRows = aiSessionsDb.prepare("SELECT * FROM ai_sessions").all() as any[];
      report.aiSessions.sourceRows = sessionRows.length;

      if (!dryRun && sessionRows.length > 0) {
        for (let i = 0; i < sessionRows.length; i += batchSize) {
          const batch = sessionRows.slice(i, i + batchSize);
          await insertAiSessionBatch(sql, batch, overwrite, report);
        }
      }

      // Messages
      const messageRows = aiSessionsDb
        .prepare("SELECT * FROM ai_messages ORDER BY ai_session_id, sequence ASC")
        .all() as any[];
      report.aiMessages.sourceRows = messageRows.length;

      if (!dryRun && messageRows.length > 0) {
        // Check for duplicate (ai_session_id, sequence) pairs in source
        const seen = new Map<string, number>();
        const dedupedMessages: any[] = [];
        for (const row of messageRows) {
          const key = `${row.ai_session_id}:${row.sequence}`;
          const count = seen.get(key) ?? 0;
          if (count > 0) {
            report.aiMessages.duplicatePairsSkipped++;
            report.warnings.push(
              `Duplicate ai_message pair: session=${row.ai_session_id}, seq=${row.sequence} — skipping duplicate`
            );
          } else {
            dedupedMessages.push(row);
          }
          seen.set(key, count + 1);
        }

        for (let i = 0; i < dedupedMessages.length; i += batchSize) {
          const batch = dedupedMessages.slice(i, i + batchSize);
          await insertAiMessageBatch(sql, batch, overwrite, report);
        }
      }
    } catch (err: unknown) {
      const msg = `Error reading ai-sessions.db: ${err instanceof Error ? err.message : String(err)}`;
      report.aiSessions.errors.push(msg);
      log("[sqlite-importer] " + msg);
    } finally {
      aiSessionsDb.close();
    }
  } else {
    report.warnings.push("ai-sessions.db not found, skipping AI sessions migration");
  }

  // 6. Verify counts (only when not dry-run).
  if (!dryRun) {
    await verifyCounts(sql, report);
  }

  log("[sqlite-importer] Migration complete", {
    dryRun,
    memories: report.memories,
    userPrompts: report.userPrompts,
    userProfiles: report.userProfiles,
    userProfileChangelogs: report.userProfileChangelogs,
    aiSessions: report.aiSessions,
    aiMessages: report.aiMessages,
    warnings: report.warnings.length,
  });

  return report;
}

// ── Batch insert helpers ──

async function insertMemoryBatch(
  sql: any,
  rows: any[],
  dims: number,
  vectorCast: string,
  overwrite: boolean,
  report: MigrationReport
): Promise<void> {
  const conflictAction = overwrite
    ? `ON CONFLICT (id) DO UPDATE SET
        scope = EXCLUDED.scope,
        scope_hash = EXCLUDED.scope_hash,
        content = EXCLUDED.content,
        vector = EXCLUDED.vector,
        tags_vector = EXCLUDED.tags_vector,
        container_tag = EXCLUDED.container_tag,
        tags = EXCLUDED.tags,
        type = EXCLUDED.type,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at,
        metadata = EXCLUDED.metadata,
        display_name = EXCLUDED.display_name,
        user_name = EXCLUDED.user_name,
        user_email = EXCLUDED.user_email,
        project_path = EXCLUDED.project_path,
        project_name = EXCLUDED.project_name,
        git_repo_url = EXCLUDED.git_repo_url,
        is_pinned = EXCLUDED.is_pinned`
    : "ON CONFLICT (id) DO NOTHING";

  for (const row of rows) {
    try {
      // Decode vectors
      let vector: Float32Array;
      try {
        vector = decodeSqliteVectorBlob(row.vector as Uint8Array);
        assertVectorDimensions(vector, dims);
      } catch (vecErr: unknown) {
        report.warnings.push(
          `Memory ${row.id}: vector decode/dimension error: ${vecErr instanceof Error ? vecErr.message : String(vecErr)}`
        );
        report.memories.skippedRows++;
        continue;
      }

      let tagsVector: Float32Array | null = null;
      if (row.tags_vector) {
        try {
          tagsVector = decodeSqliteVectorBlob(row.tags_vector as Uint8Array);
          assertVectorDimensions(tagsVector, dims);
        } catch (vecErr: unknown) {
          report.warnings.push(
            `Memory ${row.id}: tags_vector decode/dimension error: ${vecErr instanceof Error ? vecErr.message : String(vecErr)} — setting to NULL`
          );
          tagsVector = null;
        }
      }

      const { scope, hash } = extractScopeFromContainerTag(row.container_tag);
      const metadata = parseAndNormaliseMetadata(row.metadata);
      const isPinned = Boolean(row.is_pinned);

      const vectorLit = "'" + vectorToPgLiteral(vector) + "'::" + vectorCast;
      const tagsVectorLit = tagsVector
        ? "'" + vectorToPgLiteral(tagsVector) + "'::" + vectorCast
        : null;

      // Use sql tagged template for safe parameterised inserts.
      // Vector literals are constructed from validated Float32Array data.
      const Sql = sql;
      await Sql`
        INSERT INTO memories (
          id, scope, scope_hash, content, vector, tags_vector,
          container_tag, tags, type, created_at, updated_at,
          metadata, display_name, user_name, user_email,
          project_path, project_name, git_repo_url, is_pinned
        ) VALUES (
          ${row.id},
          ${scope},
          ${hash},
          ${row.content},
          ${Sql.unsafe(vectorLit)},
          ${tagsVectorLit ? Sql.unsafe(tagsVectorLit) : null},
          ${row.container_tag},
          ${row.tags ?? null},
          ${row.type ?? null},
          ${row.created_at},
          ${row.updated_at},
          ${Sql.json(metadata)},
          ${row.display_name ?? null},
          ${row.user_name ?? null},
          ${row.user_email ?? null},
          ${row.project_path ?? null},
          ${row.project_name ?? null},
          ${row.git_repo_url ?? null},
          ${isPinned}
        )
        ${Sql.unsafe(conflictAction)}
      `;

      report.memories.processedRows++;
    } catch (err: unknown) {
      const msg = `Memory ${row.id}: ${err instanceof Error ? err.message : String(err)}`;
      report.memories.errors.push(msg);
      report.memories.skippedRows++;
      log("[sqlite-importer] " + msg);
    }
  }
}

async function insertUserPromptBatch(
  sql: any,
  rows: any[],
  overwrite: boolean,
  report: MigrationReport
): Promise<void> {
  const conflictAction = overwrite
    ? `ON CONFLICT (id) DO UPDATE SET
        session_id = EXCLUDED.session_id,
        message_id = EXCLUDED.message_id,
        project_path = EXCLUDED.project_path,
        content = EXCLUDED.content,
        created_at = EXCLUDED.created_at,
        captured = EXCLUDED.captured,
        user_learning_captured = EXCLUDED.user_learning_captured,
        linked_memory_id = EXCLUDED.linked_memory_id`
    : "ON CONFLICT (id) DO NOTHING";

  for (const row of rows) {
    try {
      // Preserve captured numeric value (0/1/2)
      const captured = Number(row.captured);
      const userLearningCaptured = Boolean(row.user_learning_captured);

      await sql`
        INSERT INTO user_prompts (
          id, session_id, message_id, project_path, content,
          created_at, captured, user_learning_captured, linked_memory_id
        ) VALUES (
          ${row.id},
          ${row.session_id},
          ${row.message_id},
          ${row.project_path ?? null},
          ${row.content},
          ${row.created_at},
          ${captured},
          ${userLearningCaptured},
          ${row.linked_memory_id ?? null}
        )
        ${sql.unsafe(conflictAction)}
      `;

      report.userPrompts.processedRows++;
    } catch (err: unknown) {
      const msg = `UserPrompt ${row.id}: ${err instanceof Error ? err.message : String(err)}`;
      report.userPrompts.errors.push(msg);
      report.userPrompts.skippedRows++;
      log("[sqlite-importer] " + msg);
    }
  }
}

async function insertUserProfileBatch(
  sql: any,
  rows: any[],
  overwrite: boolean,
  report: MigrationReport
): Promise<void> {
  const conflictAction = overwrite
    ? `ON CONFLICT (id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        display_name = EXCLUDED.display_name,
        user_name = EXCLUDED.user_name,
        user_email = EXCLUDED.user_email,
        profile_data = EXCLUDED.profile_data,
        version = EXCLUDED.version,
        created_at = EXCLUDED.created_at,
        last_analyzed_at = EXCLUDED.last_analyzed_at,
        total_prompts_analyzed = EXCLUDED.total_prompts_analyzed,
        is_active = EXCLUDED.is_active`
    : "ON CONFLICT (id) DO NOTHING";

  for (const row of rows) {
    try {
      // Parse profile_data as JSON then store as JSONB
      let profileDataJson: any;
      try {
        profileDataJson =
          typeof row.profile_data === "string"
            ? JSON.parse(row.profile_data)
            : (row.profile_data ?? {});
      } catch {
        profileDataJson = {};
      }

      const isActive = Boolean(row.is_active);

      await sql`
        INSERT INTO user_profiles (
          id, user_id, display_name, user_name, user_email,
          profile_data, version, created_at, last_analyzed_at,
          total_prompts_analyzed, is_active
        ) VALUES (
          ${row.id},
          ${row.user_id},
          ${row.display_name},
          ${row.user_name},
          ${row.user_email},
          ${sql.json(profileDataJson)},
          ${row.version ?? 1},
          ${row.created_at},
          ${row.last_analyzed_at},
          ${row.total_prompts_analyzed ?? 0},
          ${isActive}
        )
        ${sql.unsafe(conflictAction)}
      `;

      report.userProfiles.processedRows++;
    } catch (err: unknown) {
      const msg = `UserProfile ${row.id}: ${err instanceof Error ? err.message : String(err)}`;
      report.userProfiles.errors.push(msg);
      report.userProfiles.skippedRows++;
      log("[sqlite-importer] " + msg);
    }
  }
}

async function insertUserProfileChangelogBatch(
  sql: any,
  rows: any[],
  overwrite: boolean,
  report: MigrationReport
): Promise<void> {
  const conflictAction = overwrite
    ? `ON CONFLICT (id) DO UPDATE SET
        profile_id = EXCLUDED.profile_id,
        version = EXCLUDED.version,
        change_type = EXCLUDED.change_type,
        change_summary = EXCLUDED.change_summary,
        profile_data_snapshot = EXCLUDED.profile_data_snapshot,
        created_at = EXCLUDED.created_at`
    : "ON CONFLICT (id) DO NOTHING";

  for (const row of rows) {
    try {
      let snapshotJson: any;
      try {
        snapshotJson =
          typeof row.profile_data_snapshot === "string"
            ? JSON.parse(row.profile_data_snapshot)
            : (row.profile_data_snapshot ?? {});
      } catch {
        snapshotJson = {};
      }

      await sql`
        INSERT INTO user_profile_changelogs (
          id, profile_id, version, change_type, change_summary,
          profile_data_snapshot, created_at
        ) VALUES (
          ${row.id},
          ${row.profile_id},
          ${row.version},
          ${row.change_type},
          ${row.change_summary},
          ${sql.json(snapshotJson)},
          ${row.created_at}
        )
        ${sql.unsafe(conflictAction)}
      `;

      report.userProfileChangelogs.processedRows++;
    } catch (err: unknown) {
      const msg = `UserProfileChangelog ${row.id}: ${err instanceof Error ? err.message : String(err)}`;
      report.userProfileChangelogs.errors.push(msg);
      report.userProfileChangelogs.skippedRows++;
      log("[sqlite-importer] " + msg);
    }
  }
}

async function insertAiSessionBatch(
  sql: any,
  rows: any[],
  overwrite: boolean,
  report: MigrationReport
): Promise<void> {
  const conflictAction = overwrite
    ? `ON CONFLICT (id) DO UPDATE SET
        provider = EXCLUDED.provider,
        session_id = EXCLUDED.session_id,
        conversation_id = EXCLUDED.conversation_id,
        metadata = EXCLUDED.metadata,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at,
        expires_at = EXCLUDED.expires_at`
    : "ON CONFLICT (id) DO NOTHING";

  for (const row of rows) {
    try {
      let metadataJson: any;
      if (row.metadata) {
        try {
          metadataJson =
            typeof row.metadata === "string" ? JSON.parse(row.metadata) : (row.metadata ?? null);
        } catch {
          metadataJson = null;
        }
      } else {
        metadataJson = null;
      }

      await sql`
        INSERT INTO ai_sessions (
          id, provider, session_id, conversation_id,
          metadata, created_at, updated_at, expires_at
        ) VALUES (
          ${row.id},
          ${row.provider},
          ${row.session_id},
          ${row.conversation_id ?? null},
          ${metadataJson ? sql.json(metadataJson) : null},
          ${row.created_at},
          ${row.updated_at},
          ${row.expires_at}
        )
        ${sql.unsafe(conflictAction)}
      `;

      report.aiSessions.processedRows++;
    } catch (err: unknown) {
      const msg = `AISession ${row.id}: ${err instanceof Error ? err.message : String(err)}`;
      report.aiSessions.errors.push(msg);
      report.aiSessions.skippedRows++;
      log("[sqlite-importer] " + msg);
    }
  }
}

async function insertAiMessageBatch(
  sql: any,
  rows: any[],
  overwrite: boolean,
  report: MigrationReport
): Promise<void> {
  for (const row of rows) {
    try {
      let toolCallsJson: any = null;
      if (row.tool_calls) {
        try {
          toolCallsJson =
            typeof row.tool_calls === "string"
              ? JSON.parse(row.tool_calls)
              : (row.tool_calls ?? null);
        } catch {
          toolCallsJson = null;
        }
      }

      let contentBlocksJson: any = null;
      if (row.content_blocks) {
        try {
          contentBlocksJson =
            typeof row.content_blocks === "string"
              ? JSON.parse(row.content_blocks)
              : (row.content_blocks ?? null);
        } catch {
          contentBlocksJson = null;
        }
      }

      // ai_messages uses a UNIQUE constraint on (ai_session_id, sequence).
      // For overwrite, we must use ON CONFLICT to handle it.
      // The id column is BIGINT GENERATED ALWAYS AS IDENTITY, so we don't insert it.
      if (overwrite) {
        // Use raw SQL with ON CONFLICT for the composite unique key
        await sql`
          INSERT INTO ai_messages (
            ai_session_id, sequence, role, content,
            tool_calls, tool_call_id, content_blocks, created_at
          ) VALUES (
            ${row.ai_session_id},
            ${row.sequence},
            ${row.role},
            ${row.content},
            ${toolCallsJson ? sql.json(toolCallsJson) : null},
            ${row.tool_call_id ?? null},
            ${contentBlocksJson ? sql.json(contentBlocksJson) : null},
            ${row.created_at}
          )
          ON CONFLICT (ai_session_id, sequence) DO UPDATE SET
            role = EXCLUDED.role,
            content = EXCLUDED.content,
            tool_calls = EXCLUDED.tool_calls,
            tool_call_id = EXCLUDED.tool_call_id,
            content_blocks = EXCLUDED.content_blocks,
            created_at = EXCLUDED.created_at
        `;
      } else {
        await sql`
          INSERT INTO ai_messages (
            ai_session_id, sequence, role, content,
            tool_calls, tool_call_id, content_blocks, created_at
          ) VALUES (
            ${row.ai_session_id},
            ${row.sequence},
            ${row.role},
            ${row.content},
            ${toolCallsJson ? sql.json(toolCallsJson) : null},
            ${row.tool_call_id ?? null},
            ${contentBlocksJson ? sql.json(contentBlocksJson) : null},
            ${row.created_at}
          )
          ON CONFLICT (ai_session_id, sequence) DO NOTHING
        `;
      }

      report.aiMessages.processedRows++;
    } catch (err: unknown) {
      const msg = `AIMessage session=${row.ai_session_id} seq=${row.sequence}: ${err instanceof Error ? err.message : String(err)}`;
      report.aiMessages.errors.push(msg);
      report.aiMessages.skippedRows++;
      log("[sqlite-importer] " + msg);
    }
  }
}

// ── Count verification ──

async function verifyCounts(sql: any, report: MigrationReport): Promise<void> {
  const tables = [
    { label: "memories", query: sql`SELECT COUNT(*) as count FROM memories` },
    { label: "user_prompts", query: sql`SELECT COUNT(*) as count FROM user_prompts` },
    { label: "user_profiles", query: sql`SELECT COUNT(*) as count FROM user_profiles` },
    {
      label: "user_profile_changelogs",
      query: sql`SELECT COUNT(*) as count FROM user_profile_changelogs`,
    },
    { label: "ai_sessions", query: sql`SELECT COUNT(*) as count FROM ai_sessions` },
    { label: "ai_messages", query: sql`SELECT COUNT(*) as count FROM ai_messages` },
  ];

  for (const { label, query } of tables) {
    try {
      const rows = await query;
      const pgCount = Number(rows[0]?.count ?? 0);
      log(`[sqlite-importer] Postgres ${label} count: ${pgCount}`);
    } catch (err: unknown) {
      report.warnings.push(
        `Could not verify ${label} count: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}
