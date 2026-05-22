/**
 * SQLite-backed implementation of MemoryRepository.
 * Wraps the existing shardManager, connectionManager, and vectorSearch singletons.
 */

import { shardManager } from "../sqlite/shard-manager.js";
import { connectionManager } from "../sqlite/connection-manager.js";
import { vectorSearch } from "../sqlite/vector-search.js";
import type { ShardInfo } from "../sqlite/types.js";
import type {
  MemoryRepository,
  MemoryRecord,
  MemoryRow,
  MemorySearchOptions,
  SearchResult,
  TagInfo,
  MemoryScopeKind,
} from "./types.js";

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

function sqliteRowToMemoryRow(row: any): MemoryRow {
  return {
    id: row.id,
    content: row.content,
    containerTag: row.container_tag,
    tags: row.tags ? row.tags.split(",").map((t: string) => t.trim()) : [],
    type: row.type ?? undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    displayName: row.display_name ?? undefined,
    userName: row.user_name ?? undefined,
    userEmail: row.user_email ?? undefined,
    projectPath: row.project_path ?? undefined,
    projectName: row.project_name ?? undefined,
    gitRepoUrl: row.git_repo_url ?? undefined,
    isPinned: row.is_pinned === 1,
  };
}

function sqliteRowToSearchResult(row: any): SearchResult {
  const tagsStr = row.tags || "";
  return {
    id: row.id,
    memory: row.content,
    similarity: row.similarity ?? 1.0,
    tags: tagsStr ? tagsStr.split(",").map((t: string) => t.trim()) : [],
    metadata: row.metadata
      ? typeof row.metadata === "string"
        ? JSON.parse(row.metadata)
        : row.metadata
      : undefined,
    containerTag: row.container_tag ?? row.containerTag,
    displayName: row.display_name ?? row.displayName ?? undefined,
    userName: row.user_name ?? row.userName ?? undefined,
    userEmail: row.user_email ?? row.userEmail ?? undefined,
    projectPath: row.project_path ?? row.projectPath ?? undefined,
    projectName: row.project_name ?? row.projectName ?? undefined,
    gitRepoUrl: row.git_repo_url ?? row.gitRepoUrl ?? undefined,
    isPinned: row.is_pinned === 1 || row.isPinned === true,
    createdAt: row.created_at != null ? Number(row.created_at) : undefined,
  };
}

function sqliteRowToMemoryRecord(row: any): MemoryRecord {
  const vectorBlob = row.vector;
  const tagsVectorBlob = row.tags_vector;

  return {
    id: row.id,
    content: row.content,
    vector:
      vectorBlob instanceof Uint8Array
        ? new Float32Array(vectorBlob.buffer)
        : new Float32Array(new Uint8Array(vectorBlob).buffer),
    tagsVector: tagsVectorBlob
      ? new Float32Array(new Uint8Array(tagsVectorBlob).buffer)
      : undefined,
    containerTag: row.container_tag,
    tags: row.tags ?? undefined,
    type: row.type ?? undefined,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    metadata: row.metadata ?? undefined,
    displayName: row.display_name ?? undefined,
    userName: row.user_name ?? undefined,
    userEmail: row.user_email ?? undefined,
    projectPath: row.project_path ?? undefined,
    projectName: row.project_name ?? undefined,
    gitRepoUrl: row.git_repo_url ?? undefined,
  };
}

export class SqliteMemoryRepository implements MemoryRepository {
  async initialize(): Promise<void> {
    // The underlying shardManager and connectionManager singletons are
    // initialized at module-load time. Nothing extra to do here.
  }

  async close(): Promise<void> {
    connectionManager.closeAll();
  }

  async insert(record: MemoryRecord): Promise<void> {
    const { scope, hash } = extractScopeFromContainerTag(record.containerTag);
    const shard = shardManager.getWriteShard(scope, hash);
    const db = connectionManager.getConnection(shard.dbPath);

    // Convert to the sqlite MemoryRecord shape (same structure — pass through)
    await vectorSearch.insertVector(
      db,
      {
        id: record.id,
        content: record.content,
        vector: record.vector,
        tagsVector: record.tagsVector,
        containerTag: record.containerTag,
        tags: record.tags,
        type: record.type,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        metadata: record.metadata,
        displayName: record.displayName,
        userName: record.userName,
        userEmail: record.userEmail,
        projectPath: record.projectPath,
        projectName: record.projectName,
        gitRepoUrl: record.gitRepoUrl,
      },
      shard
    );

    shardManager.incrementVectorCount(shard.id);
  }

  async delete(memoryId: string): Promise<boolean> {
    const userShards = shardManager.getAllShards("user", "");
    const projectShards = shardManager.getAllShards("project", "");
    const allShards = [...userShards, ...projectShards];

    for (const shard of allShards) {
      const db = connectionManager.getConnection(shard.dbPath);
      const memory = vectorSearch.getMemoryById(db, memoryId);
      if (memory) {
        await vectorSearch.deleteVector(db, memoryId, shard);
        shardManager.decrementVectorCount(shard.id);
        return true;
      }
    }

    return false;
  }

  async update(record: MemoryRecord): Promise<void> {
    // Delete then re-insert (simple upsert strategy)
    const deleted = await this.delete(record.id);
    if (deleted) {
      await this.insert(record);
    }
  }

  async getById(memoryId: string): Promise<MemoryRow | null> {
    const userShards = shardManager.getAllShards("user", "");
    const projectShards = shardManager.getAllShards("project", "");
    const allShards = [...userShards, ...projectShards];

    for (const shard of allShards) {
      const db = connectionManager.getConnection(shard.dbPath);
      const row = vectorSearch.getMemoryById(db, memoryId);
      if (row) {
        return sqliteRowToMemoryRow(row);
      }
    }

    return null;
  }

  async search(options: MemorySearchOptions): Promise<SearchResult[]> {
    const shards = shardManager.getAllShards(options.scope, options.scopeHash);
    if (shards.length === 0) return [];

    const rawResults = await vectorSearch.searchAcrossShards(
      shards,
      options.queryVector,
      options.includeAllContainers ? "" : options.containerTag,
      options.limit,
      options.similarityThreshold,
      options.queryText
    );

    return rawResults.map((r) => ({
      id: r.id,
      memory: r.memory,
      similarity: r.similarity,
      tags: r.tags,
      metadata: r.metadata,
      containerTag: (r as any).containerTag,
      displayName: r.displayName,
      userName: r.userName,
      userEmail: r.userEmail,
      projectPath: r.projectPath,
      projectName: r.projectName,
      gitRepoUrl: r.gitRepoUrl,
      isPinned: (r as any).isPinned,
    }));
  }

  async list(args: {
    scope: MemoryScopeKind;
    scopeHash: string;
    containerTag: string;
    includeAllContainers?: boolean;
    limit: number;
  }): Promise<MemoryRow[]> {
    const shards = shardManager.getAllShards(args.scope, args.scopeHash);
    if (shards.length === 0) return [];

    const allMemories: any[] = [];
    const containerTag = args.includeAllContainers ? "" : args.containerTag;

    for (const shard of shards) {
      const db = connectionManager.getConnection(shard.dbPath);
      const rows = vectorSearch.listMemories(db, containerTag, args.limit);
      allMemories.push(...rows);
    }

    allMemories.sort((a, b) => Number(b.created_at) - Number(a.created_at));

    return allMemories.slice(0, args.limit).map(sqliteRowToMemoryRow);
  }

  async getBySessionId(args: {
    sessionId: string;
    scope: MemoryScopeKind;
    scopeHash: string;
    limit: number;
  }): Promise<SearchResult[]> {
    const shards = shardManager.getAllShards(args.scope, args.scopeHash);
    if (shards.length === 0) return [];

    const allMemories: any[] = [];

    for (const shard of shards) {
      const db = connectionManager.getConnection(shard.dbPath);
      const rows = vectorSearch.getMemoriesBySessionID(db, args.sessionId);
      allMemories.push(...rows);
    }

    allMemories.sort((a, b) => Number(b.created_at) - Number(a.created_at));

    return allMemories.slice(0, args.limit).map(sqliteRowToSearchResult);
  }

  async count(args?: {
    containerTag?: string;
    scope?: MemoryScopeKind;
    scopeHash?: string;
  }): Promise<number> {
    const scope = args?.scope ?? "user";
    const scopeHash = args?.scopeHash ?? "";
    const shards = shardManager.getAllShards(scope as "user" | "project", scopeHash);

    let total = 0;
    for (const shard of shards) {
      const db = connectionManager.getConnection(shard.dbPath);
      if (args?.containerTag) {
        total += vectorSearch.countVectors(db, args.containerTag);
      } else {
        total += vectorSearch.countAllVectors(db);
      }
    }

    return total;
  }

  async getDistinctTags(args?: {
    scope?: MemoryScopeKind;
    scopeHash?: string;
  }): Promise<TagInfo[]> {
    const scope = args?.scope ?? "user";
    const scopeHash = args?.scopeHash ?? "";
    const shards = shardManager.getAllShards(scope as "user" | "project", scopeHash);

    const seen = new Set<string>();
    const results: TagInfo[] = [];

    for (const shard of shards) {
      const db = connectionManager.getConnection(shard.dbPath);
      const rows = vectorSearch.getDistinctTags(db);
      for (const row of rows) {
        const tag = row.container_tag;
        if (!seen.has(tag)) {
          seen.add(tag);
          results.push({
            tag,
            displayName: row.display_name ?? undefined,
            userName: row.user_name ?? undefined,
            userEmail: row.user_email ?? undefined,
            projectPath: row.project_path ?? undefined,
            projectName: row.project_name ?? undefined,
            gitRepoUrl: row.git_repo_url ?? undefined,
          });
        }
      }
    }

    return results;
  }

  async pin(memoryId: string): Promise<void> {
    const shard = this.findShardForMemory(memoryId);
    if (!shard) return;
    const db = connectionManager.getConnection(shard.dbPath);
    vectorSearch.pinMemory(db, memoryId);
  }

  async unpin(memoryId: string): Promise<void> {
    const shard = this.findShardForMemory(memoryId);
    if (!shard) return;
    const db = connectionManager.getConnection(shard.dbPath);
    vectorSearch.unpinMemory(db, memoryId);
  }

  async listOlderThan(cutoffTime: number): Promise<MemoryRow[]> {
    const userShards = shardManager.getAllShards("user", "");
    const projectShards = shardManager.getAllShards("project", "");
    const allShards = [...userShards, ...projectShards];

    const results: MemoryRow[] = [];

    for (const shard of allShards) {
      const db = connectionManager.getConnection(shard.dbPath);
      const stmt = db.prepare(
        `SELECT * FROM memories WHERE updated_at < ? ORDER BY updated_at ASC`
      );
      const rows = stmt.all(cutoffTime) as any[];
      for (const row of rows) {
        results.push(sqliteRowToMemoryRow(row));
      }
    }

    return results;
  }

  async getAllWithVectors(): Promise<MemoryRecord[]> {
    const userShards = shardManager.getAllShards("user", "");
    const projectShards = shardManager.getAllShards("project", "");
    const allShards = [...userShards, ...projectShards];

    const results: MemoryRecord[] = [];

    for (const shard of allShards) {
      const db = connectionManager.getConnection(shard.dbPath);
      const rows = vectorSearch.getAllMemories(db);
      for (const row of rows) {
        results.push(sqliteRowToMemoryRecord(row));
      }
    }

    return results;
  }

  async countUntagged(): Promise<number> {
    const projectShards = shardManager.getAllShards("project", "");

    let total = 0;
    for (const shard of projectShards) {
      const db = connectionManager.getConnection(shard.dbPath);
      const row = db
        .prepare("SELECT COUNT(*) as count FROM memories WHERE tags IS NULL OR tags = ''")
        .get() as any;
      total += row.count;
    }

    return total;
  }

  async updateTagsAndVectors(
    id: string,
    tags: string,
    vector: Float32Array,
    tagsVector: Float32Array | undefined,
    updatedAt: number
  ): Promise<void> {
    const shard = this.findShardForMemory(id);
    if (!shard) return;
    const db = connectionManager.getConnection(shard.dbPath);

    db.prepare("UPDATE memories SET tags = ?, updated_at = ? WHERE id = ?").run(
      tags,
      updatedAt,
      id
    );

    await vectorSearch.updateVector(db, id, vector, shard, tagsVector);
  }

  // ── helpers ──

  private findShardForMemory(memoryId: string): ShardInfo | null {
    const userShards = shardManager.getAllShards("user", "");
    const projectShards = shardManager.getAllShards("project", "");
    const allShards = [...userShards, ...projectShards];

    for (const shard of allShards) {
      const db = connectionManager.getConnection(shard.dbPath);
      const memory = vectorSearch.getMemoryById(db, memoryId);
      if (memory) return shard;
    }

    return null;
  }
}
