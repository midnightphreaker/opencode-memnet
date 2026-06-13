import { embeddingService } from "./embedding.js";
import { log, logInfo, logDebug, logError } from "./logger.js";
import { getServerConfig } from "../server-config.js";
import { CONFIG } from "../config.js";
import type { MemoryType } from "../types/index.js";
import type { Principal } from "./profile-auth.js";
import {
  createMemoryRepository,
  createUserPromptRepository,
  createUserProfileRepository,
  createClientRepository,
  createTagRegistry,
} from "./storage/factory.js";
import { stripPrivateContent } from "./privacy.js";
import type {
  MemoryRepository,
  UserPromptRepository,
  UserProfileRepository,
  UserProfileData,
  MemoryRow,
  MemoryRecord,
  MemoryScopeKind,
  ClientRepository,
} from "./storage/types.js";
import {
  getApiMigrationProgress,
  setApiMigrationProgress,
  isMigrationRunning as isTagMigrationRunning,
  setMigrationRunning,
  getCachedMigrationRecords,
  setCachedMigrationRecords,
  resetMigrationState,
} from "./tag-migration-service.js";
import type { MigrationProgress } from "./tag-migration-service.js";
import type { JobScope } from "./memory-maintenance-job-service.js";

const memoryRepo: MemoryRepository = createMemoryRepository();
const promptRepo: UserPromptRepository = createUserPromptRepository();
const profileRepo: UserProfileRepository = createUserProfileRepository();
const tagRegistry = createTagRegistry();
let clientRepo: ClientRepository | null = null;

// Repositories are singletons from the factory, but initialize() (which runs
// DB migrations) must be called before first use.  The LocalMemoryClient does
// this for the memory repo, but the API handlers are invoked independently
// (e.g. by the web-server) so we guard every handler entry-point.
let _initPromise: Promise<void> | null = null;
async function ensureInit(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      await memoryRepo.initialize();
      await promptRepo.initialize();
      await profileRepo.initialize();
      clientRepo = createClientRepository();
      await clientRepo.initialize();
    })().catch((err) => {
      clientRepo = null as any;
      _initPromise = null;
      throw err;
    });
  }
  return _initPromise;
}

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

interface Memory {
  id: string;
  content: string;
  type?: string;
  tags?: string[];
  createdAt: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
  profileId?: string;
  repoId?: string;
  localProjectPath?: string;
  gitRepoUrl?: string;
  repoNickname?: string;
  isPinned?: boolean;
}

interface TagInfo {
  tag: string;
  tags?: string[];
  profileId?: string;
  repoId?: string;
  localProjectPath?: string;
  gitRepoUrl?: string;
  repoNickname?: string;
}

interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

function safeToISOString(timestamp: any): string {
  try {
    if (timestamp === null || timestamp === undefined) {
      return new Date().toISOString();
    }
    const numValue = typeof timestamp === "bigint" ? Number(timestamp) : Number(timestamp);
    if (isNaN(numValue) || numValue < 0) {
      return new Date().toISOString();
    }
    return new Date(numValue).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function extractScopeFromTag(tag: string): { scope: "project"; hash: string } {
  const parts = tag.split("_");
  if (parts.length >= 3) {
    const hash = parts.slice(2).join("_");
    return { scope: "project", hash };
  }
  return { scope: "project", hash: tag };
}

async function getProjectScopeFromTag(
  tag: string
): Promise<{ profileId: string; repoId?: string } | undefined> {
  const tags = await memoryRepo.getDistinctTags({ scope: "project" });
  const match = tags.find((t) => t.tag === tag);
  return match?.profileId ? { profileId: match.profileId, repoId: match.repoId } : undefined;
}

function metadataScore(t: TagInfo): number {
  return (
    (t.profileId ? 1 : 0) +
    (t.repoId ? 1 : 0) +
    (t.localProjectPath ? 1 : 0) +
    (t.gitRepoUrl ? 1 : 0) +
    (t.repoNickname ? 1 : 0)
  );
}

export async function handleListTags(
  _profileId?: string
): Promise<ApiResponse<{ project: TagInfo[] }>> {
  try {
    await ensureInit();
    // Tags are stored as SQLite metadata; embedding model is not needed.
    // Calling warmup() here would block on local transformer init in the worker
    // thread and hang every read API. Only handlers that compute similarity
    // (e.g. handleSearch) should warm up the embedding service.
    const allTags = await memoryRepo.getDistinctTags({ scope: "project" });
    const projectTags: TagInfo[] = allTags
      .filter((t) => t.tag.includes("_project_"))
      .map((t) => ({
        tag: t.tag,
        profileId: t.profileId,
        repoId: t.repoId,
        localProjectPath: t.localProjectPath,
        gitRepoUrl: t.gitRepoUrl,
        repoNickname: t.repoNickname,
      }));
    // Deduplicate by tag: DISTINCT in Postgres treats NULL as a unique value,
    // so rows with different user metadata can produce duplicate tag entries.
    // Pick the entry with the most non-null metadata fields.
    const deduped = new Map<string, TagInfo>();
    for (const t of projectTags) {
      const existing = deduped.get(t.tag);
      if (!existing || metadataScore(t) > metadataScore(existing)) {
        deduped.set(t.tag, t);
      }
    }
    return { success: true, data: { project: Array.from(deduped.values()) } };
  } catch (error) {
    log("handleListTags: error", { error: String(error) });
    return { success: false, error: "Internal server error" };
  }
}

export async function handleListMemories(
  tag?: string,
  page: number = 1,
  pageSize: number = 20,
  includePrompts: boolean = true,
  profileId: string = "default",
  repoId?: string
): Promise<ApiResponse<PaginatedResponse<Memory | any>>> {
  try {
    await ensureInit();
    // Listing only reads SQLite rows; no vector ops happen here.
    // See handleListTags comment - keep embedding init out of read paths.
    let memoryRows: MemoryRow[];
    if (tag) {
      const { scope: tagScope, hash } = extractScopeFromTag(tag);
      memoryRows = await memoryRepo.list({
        scope: tagScope as MemoryScopeKind,
        scopeHash: hash,
        containerTag: tag,
        limit: 10000,
        profileId,
        repoId,
      });
    } else {
      // #10: Cap at 1000 rows when no tag filter to prevent unbounded load / OOM.
      // SQL-side filter via containerTagFilter avoids fetching non-project rows.
      memoryRows = await memoryRepo.list({
        scope: "project",
        scopeHash: "",
        containerTag: "",
        includeAllContainers: true,
        containerTagFilter: "_project_",
        limit: 1000,
        profileId,
        repoId,
      });
      // No client-side filter needed — SQL does it
    }

    const memoriesWithType = memoryRows.map((r) => ({
      type: "memory" as const,
      id: r.id,
      content: stripPrivateContent(r.content),
      containerTag: r.containerTag,
      memoryType: r.type,
      tags: r.tags,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      metadata: r.metadata,
      linkedPromptId: r.metadata?.promptId,
      profileId: r.profileId,
      repoId: r.repoId,
      localProjectPath: r.localProjectPath,
      gitRepoUrl: r.gitRepoUrl,
      repoNickname: r.repoNickname,
      isPinned: r.isPinned,
    }));

    let timeline: any[] = memoriesWithType;
    if (includePrompts) {
      const scope = tag ? await getProjectScopeFromTag(tag) : { profileId, repoId };
      const prompts = await promptRepo.getCapturedPrompts({
        profileId: scope?.profileId ?? profileId,
        repoId: scope?.repoId ?? repoId,
      });
      const promptsWithType = prompts.map((p) => ({
        type: "prompt" as const,
        id: p.id,
        sessionId: p.sessionId,
        content: p.content,
        createdAt: p.createdAt,
        profileId: p.profileId,
        repoId: p.repoId,
        localProjectPath: p.localProjectPath,
        linkedMemoryId: p.linkedMemoryId,
      }));
      timeline = [...memoriesWithType, ...promptsWithType];
    }

    const linkedPairs = new Map<string, { memory: any; prompt: any }>();
    const standalone: any[] = [];
    for (const item of timeline) {
      if (item.type === "memory" && item.linkedPromptId) {
        if (!linkedPairs.has(item.linkedPromptId)) {
          linkedPairs.set(item.linkedPromptId, { memory: item, prompt: null });
        } else {
          linkedPairs.get(item.linkedPromptId)!.memory = item;
        }
      } else if (item.type === "prompt" && item.linkedMemoryId) {
        if (!linkedPairs.has(item.id)) {
          linkedPairs.set(item.id, { memory: null, prompt: item });
        } else {
          linkedPairs.get(item.id)!.prompt = item;
        }
      } else {
        standalone.push(item);
      }
    }

    const sortedTimeline: any[] = [];
    const allPairs = Array.from(linkedPairs.values());
    const completePairs = allPairs
      .filter((p) => p.memory && p.prompt)
      .sort((a, b) => Number(b.memory.createdAt || 0) - Number(a.memory.createdAt || 0));
    for (const pair of completePairs) {
      sortedTimeline.push(pair.memory);
      sortedTimeline.push(pair.prompt);
    }
    // Add orphaned items (linked but partner deleted) back to standalone
    const incompletePairs = allPairs.filter((p) => !(p.memory && p.prompt));
    for (const pair of incompletePairs) {
      if (pair.memory) standalone.push(pair.memory);
      if (pair.prompt) standalone.push(pair.prompt);
    }
    standalone.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    sortedTimeline.push(...standalone);
    timeline = sortedTimeline;

    const total = timeline.length;
    const totalPages = Math.ceil(total / pageSize);
    const offset = (page - 1) * pageSize;
    const paginatedResults = timeline.slice(offset, offset + pageSize);

    const items = paginatedResults.map((item: any) => {
      if (item.type === "memory") {
        return {
          type: "memory",
          id: item.id,
          content: stripPrivateContent(item.content),
          containerTag: item.containerTag,
          memoryType: item.memoryType,
          tags: item.tags,
          createdAt: safeToISOString(item.createdAt),
          updatedAt: item.updatedAt ? safeToISOString(item.updatedAt) : undefined,
          metadata: item.metadata,
          linkedPromptId: item.linkedPromptId,
          displayName: item.displayName,
          userName: item.userName,
          projectPath: item.projectPath,
          projectName: item.projectName,
          gitRepoUrl: item.gitRepoUrl,
          isPinned: item.isPinned,
        };
      } else {
        return {
          type: "prompt",
          id: item.id,
          sessionId: item.sessionId,
          content: stripPrivateContent(item.content),
          createdAt: safeToISOString(item.createdAt),
          projectPath: item.projectPath,
          linkedMemoryId: item.linkedMemoryId,
        };
      }
    });

    return { success: true, data: { items, total, page, pageSize, totalPages } };
  } catch (error) {
    log("handleListMemories: error", { error: String(error) });
    return { success: false, error: "Internal server error" };
  }
}

export async function handleAddMemory(data: {
  content: string;
  containerTag: string;
  type?: MemoryType;
  tags?: string[];
  profileId: string;
  repoId?: string;
  localProjectPath?: string;
  gitRepoUrl?: string;
  repoNickname?: string;
}): Promise<ApiResponse<{ id: string }>> {
  try {
    if (!data.content || !data.containerTag) {
      return { success: false, error: "content and containerTag are required" };
    }
    if (data.content.length > MAX_CONTENT_LENGTH) {
      return { success: false, error: `Content too long (max ${MAX_CONTENT_LENGTH} characters)` };
    }
    if (data.containerTag.length > MAX_TAG_LENGTH) {
      return { success: false, error: `Container tag too long (max ${MAX_TAG_LENGTH} characters)` };
    }
    await ensureInit();
    await embeddingService.warmup();

    if (!data.profileId) {
      return { success: false, error: "profileId is required" };
    }

    const filteredContent = stripPrivateContent(data.content);
    const tags = (data.tags || []).map((t) => t.trim().toLowerCase());
    const embeddingInput =
      tags.length > 0 ? `${filteredContent}\nTags: ${tags.join(", ")}` : filteredContent;

    const vector = await embeddingService.embedWithTimeout(embeddingInput, { kind: "content" });
    let tagsVector: Float32Array | undefined = undefined;
    if (tags.length > 0) {
      tagsVector = await embeddingService.embedWithTimeout(tags.join(", "), { kind: "tags" });
    }

    const id = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    const now = Date.now();

    const record: MemoryRecord = {
      id,
      content: filteredContent,
      vector,
      tagsVector,
      containerTag: data.containerTag,
      tags: tags.length > 0 ? tags.join(",") : undefined,
      type: data.type,
      createdAt: now,
      updatedAt: now,
      metadata: JSON.stringify({ source: "api" }),
      profileId: data.profileId,
      repoId: data.repoId,
      localProjectPath: data.localProjectPath,
      gitRepoUrl: data.gitRepoUrl,
      repoNickname: data.repoNickname,
    };

    await memoryRepo.insert(record);

    // Dual-write: also store in canonical tag registry
    if (record.tags) {
      try {
        await tagRegistry.linkMemoryTags(
          record.id,
          record.tags
            .split(",")
            .map((t: string) => t.trim())
            .filter(Boolean)
        );
      } catch (err) {
        logError("api-handlers: failed to link memory tags in registry", {
          memoryId: record.id,
          tags: record.tags
            ? record.tags
                .split(",")
                .map((t: string) => t.trim())
                .filter(Boolean)
            : [],
          error: String(err),
          hint: "Memory tags saved to memories table but not to canonical tag registry. Data inconsistency may exist.",
        });
      }
    }

    return { success: true, data: { id } };
  } catch (error) {
    log("handleAddMemory: error", { error: String(error) });
    return { success: false, error: "Internal server error" };
  }
}

export async function handleDeleteMemory(
  id: string,
  cascade: boolean = false,
  principal?: Principal
): Promise<ApiResponse<{ deletedPrompt: boolean }>> {
  try {
    await ensureInit();
    if (!id) return { success: false, error: "id is required" };
    const memory = await memoryRepo.getById(id);
    if (!memory) return { success: false, error: "Memory not found" };
    let linkedPromptId: string | undefined;
    if (cascade) {
      const metadata =
        typeof memory.metadata === "string"
          ? (() => {
              try {
                return JSON.parse(memory.metadata as string);
              } catch {
                return undefined;
              }
            })()
          : memory.metadata;
      linkedPromptId = metadata?.promptId as string | undefined;
      if (linkedPromptId) await promptRepo.deletePrompt(linkedPromptId);
    }
    await memoryRepo.delete(id);
    return {
      success: true,
      data: { deletedPrompt: cascade && !!linkedPromptId },
    };
  } catch (error) {
    log("handleDeleteMemory: error", { error: String(error) });
    return { success: false, error: "Internal server error" };
  }
}

export async function handleBulkDelete(
  ids: string[],
  cascade: boolean = false,
  principal?: Principal
): Promise<ApiResponse<{ deleted: number; total: number; failedIds?: string[] }>> {
  try {
    if (!ids || ids.length === 0) return { success: false, error: "ids array is required" };
    await ensureInit();
    if (cascade) {
      // When cascade is requested, fall back to sequential deletes to handle
      // linked prompt cleanup for each memory individually.
      let deleted = 0;
      const failedIds: string[] = [];
      for (const id of ids) {
        const result = await handleDeleteMemory(id, cascade, principal);
        if (result.success) deleted++;
        else failedIds.push(id);
      }
      return { success: true, data: { deleted, total: ids.length, failedIds } };
    }
    const deleted = await memoryRepo.deleteMany(ids);
    return { success: true, data: { deleted, total: ids.length } };
  } catch (error) {
    log("handleBulkDelete: error", { error: String(error) });
    return { success: false, error: "Internal server error" };
  }
}

export async function handleUpdateMemory(
  id: string,
  data: { content?: string; type?: MemoryType; tags?: string[]; containerTag?: string },
  _principal?: Principal
): Promise<ApiResponse<void>> {
  try {
    await ensureInit();
    if (!id) return { success: false, error: "id is required" };
    await embeddingService.warmup();
    const existingMemory = await memoryRepo.getById(id);
    if (!existingMemory) return { success: false, error: "Memory not found" };

    const newContent = stripPrivateContent(data.content || existingMemory.content);
    // Storage may return tags as comma-separated string despite typed as string[]
    const rawTags = existingMemory.tags as unknown;
    const existingTags: string[] =
      typeof rawTags === "string"
        ? rawTags
            .split(",")
            .map((t: string) => t.trim())
            .filter(Boolean)
        : Array.isArray(rawTags)
          ? rawTags
          : [];
    const tags = data.tags !== undefined ? data.tags : existingTags;

    const vector = await embeddingService.embedWithTimeout(newContent, { kind: "content" });
    let tagsVector: Float32Array | undefined = undefined;
    if (tags.length > 0) {
      tagsVector = await embeddingService.embedWithTimeout(tags.join(", "), { kind: "tags" });
    }

    const updatedRecord: MemoryRecord = {
      id,
      content: newContent,
      vector,
      tagsVector,
      containerTag: data.containerTag || existingMemory.containerTag,
      tags: tags.length > 0 ? tags.join(",") : undefined,
      type: data.type || existingMemory.type,
      createdAt: existingMemory.createdAt,
      updatedAt: Date.now(),
      metadata: existingMemory.metadata
        ? typeof existingMemory.metadata === "string"
          ? existingMemory.metadata
          : JSON.stringify(existingMemory.metadata)
        : undefined,
      profileId: existingMemory.profileId,
      repoId: existingMemory.repoId,
      localProjectPath: existingMemory.localProjectPath,
      gitRepoUrl: existingMemory.gitRepoUrl,
      repoNickname: existingMemory.repoNickname,
    };

    await memoryRepo.update(updatedRecord);

    // Dual-write: also update canonical tag registry
    if (data.tags !== undefined) {
      try {
        const tagList = data.tags
          ? data.tags.map((t: string) => t.trim().toLowerCase()).filter(Boolean)
          : [];
        await tagRegistry.unlinkMemoryTags(id);
        if (tagList.length > 0) {
          await tagRegistry.linkMemoryTags(id, tagList);
        }
      } catch (err) {
        logError("api-handlers: failed to update memory tags in registry", {
          memoryId: id,
          tags: data.tags ?? [],
          error: String(err),
          hint: "Memory tags saved to memories table but not to canonical tag registry. Data inconsistency may exist.",
        });
      }
    }

    return { success: true };
  } catch (error) {
    log("handleUpdateMemory: error", { error: String(error) });
    return { success: false, error: "Internal server error" };
  }
}

interface FormattedPrompt {
  type: "prompt";
  id: string;
  sessionId: string;
  content: string;
  createdAt: string;
  profileId: string;
  repoId: string;
  localProjectPath: string | null;
  linkedMemoryId: string | null;
  similarity?: number;
  isContext?: boolean;
}

interface FormattedMemory {
  type: "memory";
  id: string;
  content: string;
  memoryType?: string;
  tags?: string[];
  createdAt: string;
  updatedAt?: string;
  similarity?: number;
  metadata?: Record<string, unknown>;
  profileId?: string;
  repoId?: string;
  localProjectPath?: string;
  gitRepoUrl?: string;
  repoNickname?: string;
  isPinned?: boolean;
  linkedPromptId?: string;
  isContext?: boolean;
}

type SearchResultItem = FormattedPrompt | FormattedMemory;

export async function handleSearch(
  query: string,
  tag?: string,
  page: number = 1,
  pageSize: number = 20,
  profileId: string = "default",
  repoId?: string
): Promise<ApiResponse<PaginatedResponse<SearchResultItem>>> {
  try {
    await ensureInit();
    if (!query) return { success: false, error: "query is required" };
    await embeddingService.warmup();
    const queryVector = await embeddingService.embedWithTimeout(query, { kind: "query" });
    let memoryResults: any[] = [];
    let promptResults: any[] = [];

    if (tag) {
      const { scope, hash } = extractScopeFromTag(tag);
      const results = await memoryRepo.search({
        queryVector,
        scope: scope as MemoryScopeKind,
        scopeHash: hash,
        containerTag: tag,
        limit: pageSize * 4,
        similarityThreshold: 0,
        queryText: query,
        profileId,
        repoId,
      });
      memoryResults.push(...results);

      const projectScope = await getProjectScopeFromTag(tag);
      promptResults = await promptRepo.searchPrompts({
        query,
        profileId: projectScope?.profileId ?? profileId,
        repoId: projectScope?.repoId ?? repoId,
        limit: pageSize * 2,
      });
    } else {
      // Search across all project shards without container-tag filter
      const results = await memoryRepo.search({
        queryVector,
        scope: "project",
        scopeHash: "",
        containerTag: "",
        includeAllContainers: true,
        limit: pageSize * 10,
        similarityThreshold: 0,
        queryText: query,
        profileId,
        repoId,
      });
      memoryResults.push(...results);
      promptResults = await promptRepo.searchPrompts({
        query,
        profileId,
        repoId,
        limit: pageSize * 2,
      });
    }

    const formattedPrompts: FormattedPrompt[] = promptResults.map((p) => ({
      type: "prompt",
      id: p.id,
      sessionId: p.sessionId,
      content: stripPrivateContent(p.content),
      createdAt: safeToISOString(p.createdAt),
      profileId: p.profileId,
      repoId: p.repoId,
      localProjectPath: p.localProjectPath,
      linkedMemoryId: p.linkedMemoryId,
      similarity: undefined,
    }));

    const formattedMemories: FormattedMemory[] = memoryResults.map((r: any) => ({
      type: "memory",
      id: r.id,
      // Note: SearchResult uses field "memory" (not "content") — see types.ts SearchResult interface
      content: stripPrivateContent(r.memory),
      memoryType: r.metadata?.type,
      tags: r.tags,
      createdAt: safeToISOString(r.createdAt),
      updatedAt: r.metadata?.updatedAt ? safeToISOString(r.metadata.updatedAt) : undefined,
      similarity: r.similarity,
      metadata: r.metadata,
      profileId: r.profileId,
      repoId: r.repoId,
      localProjectPath: r.localProjectPath,
      gitRepoUrl: r.gitRepoUrl,
      repoNickname: r.repoNickname,
      isPinned: r.isPinned === 1 || r.isPinned === true,
      linkedPromptId: r.metadata?.promptId,
    }));

    const combinedResults = [...formattedMemories, ...formattedPrompts].sort(
      (a: any, b: any) =>
        (b.similarity || 0) - (a.similarity || 0) || b.createdAt.localeCompare(a.createdAt)
    );

    const offset = (page - 1) * pageSize;
    const paginatedResults: SearchResultItem[] = combinedResults.slice(offset, offset + pageSize);

    // Capture total BEFORE appending linked extras so pageSize contract is consistent
    const total = combinedResults.length;

    const missingPromptIds = new Set<string>();
    const missingMemoryIds = new Set<string>();
    for (const item of paginatedResults) {
      if (item.type === "memory" && item.linkedPromptId) {
        if (!paginatedResults.some((p) => p.id === item.linkedPromptId))
          missingPromptIds.add(item.linkedPromptId);
      } else if (item.type === "prompt" && item.linkedMemoryId) {
        if (!paginatedResults.some((m) => m.id === item.linkedMemoryId))
          missingMemoryIds.add(item.linkedMemoryId);
      }
    }

    if (missingPromptIds.size > 0) {
      const extraPrompts = await promptRepo.getPromptsByIds(Array.from(missingPromptIds));
      for (const p of extraPrompts) {
        paginatedResults.push({
          type: "prompt",
          id: p.id,
          sessionId: p.sessionId,
          content: stripPrivateContent(p.content),
          createdAt: safeToISOString(p.createdAt),
          profileId: p.profileId,
          repoId: p.repoId,
          localProjectPath: p.localProjectPath,
          linkedMemoryId: p.linkedMemoryId,
          similarity: 0,
          isContext: true,
        });
      }
    }

    if (missingMemoryIds.size > 0) {
      for (const mid of missingMemoryIds) {
        const m = await memoryRepo.getById(mid);
        if (m && !paginatedResults.some((existing) => existing.id === m.id)) {
          paginatedResults.push({
            type: "memory",
            id: m.id,
            content: stripPrivateContent(m.content),
            memoryType: m.type,
            tags: m.tags,
            createdAt: safeToISOString(m.createdAt),
            updatedAt: m.updatedAt ? safeToISOString(m.updatedAt) : undefined,
            similarity: 0,
            metadata: m.metadata,
            profileId: m.profileId,
            repoId: m.repoId,
            localProjectPath: m.localProjectPath,
            gitRepoUrl: m.gitRepoUrl,
            repoNickname: m.repoNickname,
            isPinned: m.isPinned,
            linkedPromptId: m.metadata?.promptId as string | undefined,
            isContext: true,
          });
        }
      }
    }

    // total was captured before appending linked extras
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return { success: true, data: { items: paginatedResults, total, page, pageSize, totalPages } };
  } catch (error) {
    log("handleSearch: error", { error: String(error) });
    return { success: false, error: "Internal server error" };
  }
}

export async function handleStats(): Promise<
  ApiResponse<{
    total: number;
    byScope: { user: number; project: number };
    byType: Record<string, number>;
  }>
> {
  try {
    await ensureInit();
    // Use COUNT(*) queries instead of loading all rows into memory.
    const [userCount, projectCount, typeCount] = await Promise.all([
      memoryRepo.count({ scope: "user" }),
      memoryRepo.count({ scope: "project" }),
      memoryRepo.countByType(),
    ]);
    return {
      success: true,
      data: {
        total: userCount + projectCount,
        byScope: { user: userCount, project: projectCount },
        byType: typeCount,
      },
    };
  } catch (error) {
    log("handleStats: error", { error: String(error) });
    return { success: false, error: "Internal server error" };
  }
}

export async function handlePinMemory(
  id: string,
  _principal?: Principal
): Promise<ApiResponse<void>> {
  try {
    await ensureInit();
    if (!id) return { success: false, error: "id is required" };
    const memory = await memoryRepo.getById(id);
    if (!memory) return { success: false, error: "Memory not found" };
    await memoryRepo.pin(id);
    return { success: true };
  } catch (error) {
    log("handlePinMemory: error", { error: String(error) });
    return { success: false, error: "Internal server error" };
  }
}

export async function handleUnpinMemory(
  id: string,
  _principal?: Principal
): Promise<ApiResponse<void>> {
  try {
    await ensureInit();
    if (!id) return { success: false, error: "id is required" };
    const memory = await memoryRepo.getById(id);
    if (!memory) return { success: false, error: "Memory not found" };
    await memoryRepo.unpin(id);
    return { success: true };
  } catch (error) {
    log("handleUnpinMemory: error", { error: String(error) });
    return { success: false, error: "Internal server error" };
  }
}

export async function handleDeletePrompt(
  id: string,
  cascade: boolean = false,
  principal?: Principal
): Promise<ApiResponse<{ deletedMemory: boolean }>> {
  try {
    await ensureInit();
    if (!id) return { success: false, error: "id is required" };
    const prompt = await promptRepo.getPromptById(id);
    if (!prompt) return { success: false, error: "Prompt not found" };
    let deletedMemory = false;
    if (cascade && prompt.linkedMemoryId) {
      const result = await handleDeleteMemory(prompt.linkedMemoryId, false, principal);
      if (result.success) deletedMemory = true;
    }
    await promptRepo.deletePrompt(id);
    return { success: true, data: { deletedMemory } };
  } catch (error) {
    log("handleDeletePrompt: error", { error: String(error) });
    return { success: false, error: "Internal server error" };
  }
}

export async function handleBulkDeletePrompts(
  ids: string[],
  cascade: boolean = false,
  principal?: Principal
): Promise<ApiResponse<{ deleted: number }>> {
  try {
    if (!ids || ids.length === 0) return { success: false, error: "ids array is required" };
    let deleted = 0;
    for (const id of ids) {
      const result = await handleDeletePrompt(id, cascade, principal);
      if (result.success) deleted++;
    }
    return { success: true, data: { deleted } };
  } catch (error) {
    log("handleBulkDeletePrompts: error", { error: String(error) });
    return { success: false, error: "Internal server error" };
  }
}

export async function handleGetUserProfile(profileId?: string): Promise<ApiResponse<any>> {
  try {
    await ensureInit();
    if (!profileId) {
      return {
        success: true,
        data: {
          exists: false,
          profileId: null,
          message: "No profileId provided.",
        },
      };
    }

    const profile = await profileRepo.getActiveProfile(profileId);
    if (!profile)
      return {
        success: true,
        data: {
          exists: false,
          profileId,
          message: "No profile found. Keep chatting to build your profile.",
        },
      };
    const profileData = JSON.parse(profile.profileData);
    return {
      success: true,
      data: {
        exists: true,
        id: profile.id,
        profileId: profile.profileId,
        version: profile.version,
        createdAt: safeToISOString(profile.createdAt),
        lastAnalyzedAt: safeToISOString(profile.lastAnalyzedAt),
        totalPromptsAnalyzed: profile.totalPromptsAnalyzed,
        profileData,
      },
    };
  } catch (error) {
    log("handleGetUserProfile: error", { error: String(error) });
    return { success: false, error: "Internal server error" };
  }
}

export async function handleGetProfileChangelog(
  profileId: string,
  limit: number = 5
): Promise<ApiResponse<any[]>> {
  try {
    await ensureInit();
    if (!profileId) return { success: false, error: "profileId is required" };
    const changelogs = await profileRepo.getProfileChangelogs(profileId, limit);
    const formattedChangelogs = changelogs.map((c) => ({
      id: c.id,
      profileId: c.profileId,
      version: c.version,
      changeType: c.changeType,
      changeSummary: c.changeSummary,
      createdAt: safeToISOString(c.createdAt),
    }));
    return { success: true, data: formattedChangelogs };
  } catch (error) {
    log("handleGetProfileChangelog: error", { error: String(error) });
    return { success: false, error: "Internal server error" };
  }
}

export async function handleGetProfileSnapshot(
  changelogId: string,
  _principal?: Principal
): Promise<ApiResponse<any>> {
  try {
    await ensureInit();
    if (!changelogId) return { success: false, error: "changelogId is required" };
    const changelog = await profileRepo.getChangelogById(changelogId);
    if (!changelog) return { success: false, error: "Changelog not found" };
    const profileData = JSON.parse(changelog.profileDataSnapshot);
    return {
      success: true,
      data: {
        version: changelog.version,
        createdAt: safeToISOString(changelog.createdAt),
        profileData,
      },
    };
  } catch (error) {
    log("handleGetProfileSnapshot: error", { error: String(error) });
    return { success: false, error: "Internal server error" };
  }
}

export async function handleRefreshProfile(profileId?: string): Promise<ApiResponse<any>> {
  try {
    await ensureInit();
    if (!profileId) {
      return {
        success: false,
        error: "profileId is required",
      };
    }
    const unanalyzedCount = await promptRepo.countUnanalyzedForUserLearning(profileId);
    return {
      success: true,
      data: {
        message: "Profile refresh is not yet implemented",
        unanalyzedPrompts: unanalyzedCount,
        note: "This endpoint is a placeholder. Profile learning happens automatically.",
      },
    };
  } catch (error) {
    log("handleRefreshProfile: error", { error: String(error) });
    return { success: false, error: "Internal server error" };
  }
}

export async function handleDetectTagMigration(): Promise<
  ApiResponse<{ needsMigration: boolean; count: number }>
> {
  try {
    await ensureInit();

    // Restore migration completion state from persisted marker
    const migrationProgress = getApiMigrationProgress();
    if (migrationProgress.total === 0) {
      try {
        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        const dataDir = CONFIG.storagePath || "/tmp/opencode-memnet-data";
        const marker = JSON.parse(
          await fs.readFile(path.join(dataDir, ".migration", "tag-migration.json"), "utf-8")
        );
        if (marker.completed) {
          setApiMigrationProgress({
            processed: marker.processed ?? 0,
            total: marker.processed ?? 0,
            currentBatch: 0,
            totalBatches: 0,
            isComplete: true,
            errors: [],
          });
        }
      } catch {
        /* file doesn't exist yet — first run or fresh state */
      }
    }

    const untaggedCount = await memoryRepo.countUntagged();
    const currentProgress = getApiMigrationProgress();
    if (untaggedCount === 0) {
      // Auto-reset stale migration state when no untagged memories remain
      setApiMigrationProgress({
        processed: 0,
        total: 0,
        currentBatch: 0,
        totalBatches: 0,
        isComplete: true,
        errors: [],
      });
      setMigrationRunning(false);
      setCachedMigrationRecords(null);
    }
    // Suppress nag when migration already ran and completed — AI failures
    // on remaining untagged memories won't be fixed by re-running.
    if (currentProgress.isComplete && currentProgress.total > 0) {
      return { success: true, data: { needsMigration: false, count: untaggedCount } };
    }

    return { success: true, data: { needsMigration: untaggedCount > 0, count: untaggedCount } };
  } catch (error) {
    logError("handleDetectTagMigration: error", { error: String(error) });
    return { success: false, error: "Internal server error" };
  }
}

// ── Cleanup guard (best-effort lock; same single-user/single-process model as migrationProgress) ──
let _cleanupInProgress = false;

// ── Deduplicate guard (prevents concurrent dedup operations) ──
let _dedupInProgress = false;

// ── Field-level input length limits ──
const MAX_CONTENT_LENGTH = 100 * 1024; // 100KB
const MAX_TAG_LENGTH = 200;
const MAX_EMAIL_LENGTH = 320;

// ── Auto-capture retry tracking (ISSUE-005) ──
const autoCaptureAttempts = new Map<string, number>();
const MAX_AUTO_CAPTURE_RETRIES = 3;

// ── Profile learning retry tracking (ISSUE-019) ──
const profileLearningAttempts = new Map<string, number>();
const MAX_PROFILE_RETRIES = 3;

export async function handleGetTagMigrationProgress(): Promise<
  ApiResponse<{ status: string; processed: number; total: number; errors: string[] }>
> {
  const { getMigrationProgress } = await import("./tag-migration-service.js");
  return { success: true, data: getMigrationProgress() };
}

export async function handleRunTagMigrationBatch(
  _batchSize: number = 5
): Promise<ApiResponse<{ processed: number; total: number; hasMore: boolean }>> {
  // Delegate to the background service
  const { getMigrationProgress, runTagMigration } = await import("./tag-migration-service.js");
  const progress = getMigrationProgress();
  if (progress.status === "running") {
    return {
      success: true,
      data: { processed: progress.processed, total: progress.total, hasMore: true },
    };
  }
  // Fire and forget — the service loop handles retries
  runTagMigration().catch((e) => {
    logError("handleRunTagMigrationBatch: tag migration failed to start", { error: String(e) });
  });
  return { success: true, data: { processed: 0, total: 0, hasMore: true } };
}

// ── New endpoints for server-client architecture ────────────

export async function handleContextInject(data: {
  sessionID?: string;
  projectTag: string;
  profileId: string;
  repoId: string;
  maxMemories?: number;
  excludeCurrentSession?: boolean;
  maxAgeDays?: number | null;
}): Promise<
  ApiResponse<{
    context: string;
    memories: Array<{ id: string; summary: string; createdAt: string; similarity: number }>;
    profileInjected: boolean;
    profileStatus?: string;
  }>
> {
  try {
    await ensureInit();

    const maxMemories = data.maxMemories ?? CONFIG.chatMessage?.maxMemories ?? 3;
    const excludeCurrentSession = data.excludeCurrentSession ?? true;
    const maxAgeDays = data.maxAgeDays ?? null;

    const { scope, hash } = extractScopeFromTag(data.projectTag);
    const rows = await memoryRepo.list({
      scope: scope as MemoryScopeKind,
      scopeHash: hash,
      containerTag: data.projectTag,
      limit: maxMemories * 3,
      profileId: data.profileId,
      repoId: data.repoId,
    });

    // Memories are listed in recency order (newest first) for context injection.
    // Set a neutral similarity for consistent response shape.
    let memories = rows.map((r) => ({
      id: r.id,
      summary: r.content,
      createdAt: safeToISOString(r.createdAt),
      similarity: 0.5,
      _metadata: r.metadata,
    }));

    if (excludeCurrentSession && data.sessionID) {
      memories = memories.filter((m: any) => {
        try {
          const meta = typeof m._metadata === "string" ? JSON.parse(m._metadata) : m._metadata;
          return meta?.sessionID !== data.sessionID;
        } catch {
          return true;
        }
      });
    }

    if (maxAgeDays != null && maxAgeDays > 0) {
      const cutoffDate = Date.now() - maxAgeDays * 86400000;
      memories = memories.filter((m: any) => new Date(m.createdAt).getTime() > cutoffDate);
    }

    memories = memories.slice(0, maxMemories);

    const parts: string[] = ["[MEMORY]"];
    let profileInjected = false;
    let profileStatus: string | undefined;

    if (CONFIG.injectProfile && data.profileId) {
      const profile = await profileRepo.getActiveProfile(data.profileId);
      if (profile) {
        try {
          const profileData = JSON.parse(profile.profileData);
          const preferences = (profileData?.preferences ?? []).sort(
            (a: any, b: any) => b.confidence - a.confidence
          );
          const patterns = (profileData?.patterns ?? []).sort(
            (a: any, b: any) => b.frequency - a.frequency
          );
          const workflows = profileData?.workflows ?? [];

          if (preferences.length > 0) {
            parts.push("\nUser Preferences:");
            preferences.slice(0, 5).forEach((pref: any) => {
              parts.push(`- [${pref.category}] ${pref.description}`);
            });
          }
          if (patterns.length > 0) {
            parts.push("\nUser Patterns:");
            patterns.slice(0, 5).forEach((pat: any) => {
              parts.push(`- [${pat.category}] ${pat.description}`);
            });
          }
          if (workflows.length > 0) {
            parts.push("\nUser Workflows:");
            workflows.slice(0, 3).forEach((wf: any) => {
              parts.push(`- ${wf.description}`);
            });
          }
          profileInjected = true;
        } catch {
          // Corrupt profile data — report diagnostic instead of silently skipping
          profileInjected = false;
          profileStatus = "corrupt";
          log("handleContextInject: corrupt profile data detected", {
            profileId: data.profileId,
          });
        }
      }
    }

    if (memories.length > 0) {
      parts.push("\nProject Knowledge:");
      memories.forEach((m) => {
        parts.push(`- ${m.summary}`);
      });
    }

    const context = parts.length > 1 ? parts.join("\n") : "";

    return {
      success: true,
      data: {
        context,
        memories: memories.map(({ _metadata, ...rest }) => rest),
        profileInjected,
        ...(profileStatus ? { profileStatus } : {}),
      },
    };
  } catch (error) {
    log("handleContextInject: error", { error: String(error) });
    return { success: false, error: "Internal server error" };
  }
}

// Phase 3: Full implementation — was stub in Phase 2
export async function handleAutoCapture(data: {
  sessionID: string;
  projectTag: string;
  profileId: string;
  repoId: string;
  projectMetadata: {
    localProjectPath?: string;
    gitRepoUrl?: string;
    repoNickname?: string;
  };
  conversationMessages: Array<{
    role: string;
    parts: Array<{ type: string; text?: string; tool?: string; state?: any }>;
  }>;
  userPrompt: string;
  promptMessageId: string;
}): Promise<ApiResponse<{ captured: boolean; memoryId?: string }>> {
  try {
    await ensureInit();
    await embeddingService.warmup();

    // Extract AI content from conversation messages
    const textResponses: string[] = [];
    const toolCalls: Array<{ name: string; input: string }> = [];

    for (const msg of data.conversationMessages) {
      if (msg.role !== "assistant") continue;
      if (!Array.isArray(msg.parts)) continue;
      for (const part of msg.parts) {
        if (part.type === "text" && part.text?.trim()) {
          textResponses.push(part.text.trim());
        }
        if (part.type === "tool") {
          const name = part.tool || "unknown";
          let input = "";
          if (part.state?.input) {
            const inputObj = part.state.input;
            if (typeof inputObj === "string") {
              input = inputObj;
            } else if (typeof inputObj === "object") {
              input = Object.entries(inputObj)
                .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
                .join(", ");
            }
          }
          if (input.length > 100) input = input.substring(0, 100) + "...";
          toolCalls.push({ name, input });
        }
      }
    }

    if (textResponses.length === 0 && toolCalls.length === 0) {
      return { success: true, data: { captured: false } };
    }

    // Get latest memory for context
    let latestMemory: string | null = null;
    const { scope, hash } = extractScopeFromTag(data.projectTag);
    const recentRows = await memoryRepo.list({
      scope: scope as MemoryScopeKind,
      scopeHash: hash,
      containerTag: data.projectTag,
      limit: 1,
      profileId: data.profileId,
      repoId: data.repoId,
    });
    const firstRow = recentRows[0];
    if (firstRow && firstRow.content) {
      const content = firstRow.content;
      latestMemory = content.length <= 500 ? content : content.substring(0, 500) + "...";
    }

    // Build AI context
    const sections: string[] = [];
    if (latestMemory) {
      sections.push(`## Previous Memory Context\n---\n${latestMemory}\n---\n`);
    }
    sections.push(`## User Request\n---\n${data.userPrompt}\n---\n`);
    if (textResponses.length > 0) {
      sections.push(`## AI Response\n---\n${textResponses.join("\n\n")}\n---\n`);
    }
    if (toolCalls.length > 0) {
      sections.push("## Tools Used\n---");
      for (const tool of toolCalls) {
        sections.push(`- ${tool.name}${tool.input ? `(${tool.input})` : ""}`);
      }
      sections.push("---\n");
    }
    const context = sections.join("\n");

    // ── ISSUE-005: Retry counting to prevent infinite auto-capture loops ──
    const attemptKey = data.promptMessageId;
    const attempts = autoCaptureAttempts.get(attemptKey) ?? 0;
    if (attempts >= MAX_AUTO_CAPTURE_RETRIES) {
      log("handleAutoCapture: max retries exceeded, skipping prompt", {
        promptMessageId: attemptKey,
        attempts,
      });
      autoCaptureAttempts.delete(attemptKey);
      return { success: true, data: { captured: true } };
    }

    // Generate summary via AI
    const { generateSummary } = await import("./auto-capture-server.js");
    let summaryResult: any;
    try {
      summaryResult = await generateSummary(context, data.sessionID, data.userPrompt);
    } catch (genError) {
      autoCaptureAttempts.set(attemptKey, attempts + 1);
      if (attempts + 1 >= MAX_AUTO_CAPTURE_RETRIES) {
        logError("handleAutoCapture: generateSummary failed after max retries", {
          promptMessageId: attemptKey,
          attempts: attempts + 1,
          error: String(genError),
        });
        autoCaptureAttempts.delete(attemptKey);
        return { success: true, data: { captured: true } };
      }
      log("handleAutoCapture: generateSummary failed, will retry", {
        promptMessageId: attemptKey,
        attempts: attempts + 1,
        error: String(genError),
      });
      return { success: false, error: "Summary generation failed" };
    }

    if (!summaryResult || summaryResult.type === "skip") {
      autoCaptureAttempts.set(attemptKey, attempts + 1);
      if (attempts + 1 >= MAX_AUTO_CAPTURE_RETRIES) {
        log("handleAutoCapture: max retries reached after skip result", {
          promptMessageId: attemptKey,
          attempts: attempts + 1,
        });
        autoCaptureAttempts.delete(attemptKey);
        return { success: true, data: { captured: true } };
      }
      return { success: true, data: { captured: false } };
    }

    // Clear retry tracker on success
    autoCaptureAttempts.delete(attemptKey);

    const tags = summaryResult.tags ?? [];

    // Apply privacy filtering before storage
    const filteredSummary = stripPrivateContent(summaryResult.summary);

    // Embed and store
    const embeddingInput =
      tags.length > 0 ? `${filteredSummary}\nTags: ${tags.join(", ")}` : filteredSummary;

    const vector = await embeddingService.embedWithTimeout(embeddingInput, { kind: "content" });
    let tagsVector: Float32Array | undefined;
    if (tags.length > 0) {
      tagsVector = await embeddingService.embedWithTimeout(tags.join(", "), {
        kind: "tags",
      });
    }

    const id = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    const now = Date.now();

    const insertRecord: MemoryRecord = {
      id,
      content: filteredSummary,
      vector,
      tagsVector,
      containerTag: data.projectTag,
      tags: tags.length > 0 ? tags.join(",") : undefined,
      type: summaryResult.type as any,
      createdAt: now,
      updatedAt: now,
      metadata: JSON.stringify({
        source: "auto-capture",
        sessionID: data.sessionID,
        promptId: data.promptMessageId,
        captureTimestamp: now,
      }),
      profileId: data.profileId,
      repoId: data.repoId,
      localProjectPath: data.projectMetadata.localProjectPath,
      gitRepoUrl: data.projectMetadata.gitRepoUrl,
      repoNickname: data.projectMetadata.repoNickname,
    };

    // ── ISSUE-006: Retry logic for DB insert with exponential backoff ──
    let insertSuccess = false;
    const RETRY_DELAYS = [100, 200, 400];
    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      try {
        await memoryRepo.insert(insertRecord);
        insertSuccess = true;
        break;
      } catch (insertError) {
        if (attempt < RETRY_DELAYS.length) {
          log("handleAutoCapture: insert failed, retrying", {
            attempt: attempt + 1,
            delay: RETRY_DELAYS[attempt],
            error: String(insertError),
          });
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt]));
        } else {
          // All retries exhausted — log summary content as recovery measure
          logError("handleAutoCapture: DB insert failed after all retries, summary lost", {
            memoryId: id,
            summaryText: filteredSummary,
            containerTag: data.projectTag,
            error: String(insertError),
          });
        }
      }
    }

    if (!insertSuccess) {
      return { success: false, error: "Failed to persist auto-capture memory" };
    }

    // Dual-write: also store in canonical tag registry
    if (summaryResult.tags.length > 0) {
      try {
        await tagRegistry.linkMemoryTags(id, summaryResult.tags);
      } catch (err) {
        logError("api-handlers: failed to link auto-capture tags in registry", {
          memoryId: id,
          tags: summaryResult.tags,
          error: String(err),
          hint: "Memory tags saved to memories table but not to canonical tag registry. Data inconsistency may exist.",
        });
      }
    }

    return { success: true, data: { captured: true, memoryId: id } };
  } catch (error) {
    log("handleAutoCapture: error", { error: String(error) });
    return { success: false, error: "Internal server error" };
  }
}

export async function handleUserProfileLearn(data: {
  profileId: string;
  projectTag?: string;
}): Promise<ApiResponse<{ updated: boolean }>> {
  try {
    await ensureInit();

    if (!data.profileId) {
      return {
        success: false,
        error: "Cannot perform profile learning: profileId is required.",
      };
    }
    const profileId = data.profileId;

    // Check if enough unanalyzed prompts exist
    const unanalyzedCount = await promptRepo.countUnanalyzedForUserLearning(profileId);
    const threshold = CONFIG.userProfileAnalysisInterval;

    if (unanalyzedCount < threshold) {
      return {
        success: true,
        data: { updated: false },
      };
    }

    // Fetch prompts for analysis
    const prompts = await promptRepo.getPromptsForUserLearning({ profileId, limit: threshold });
    if (prompts.length === 0) {
      return { success: true, data: { updated: false } };
    }

    // Fetch existing profile (if any)
    const existingProfile = await profileRepo.getActiveProfile(profileId);

    // Build existing profile JSON for the AI context
    let existingProfileJson: string | null = null;
    if (existingProfile) {
      existingProfileJson = existingProfile.profileData;
    }

    // Run AI analysis via server-side learner
    const { analyzeUserProfile, generateChangeSummary } =
      await import("./user-profile-learner-server.js");

    const promptTexts = prompts.map((p) => p.content);

    // ── ISSUE-019: Retry counting for profile learning ──
    const profileAttemptKey = profileId;
    const profileAttempts = profileLearningAttempts.get(profileAttemptKey) ?? 0;

    let updatedProfileData: any;
    try {
      updatedProfileData = await analyzeUserProfile(promptTexts, existingProfileJson);
    } catch (analyzeError) {
      const newAttempts = profileAttempts + 1;
      profileLearningAttempts.set(profileAttemptKey, newAttempts);

      if (newAttempts >= MAX_PROFILE_RETRIES) {
        logError(
          "handleUserProfileLearn: analyzeUserProfile failed after max retries, marking prompts as captured",
          {
            profileId,
            attempts: newAttempts,
            error: String(analyzeError),
          }
        );
        await promptRepo.markMultipleAsUserLearningCaptured(prompts.map((p) => p.id));
        profileLearningAttempts.delete(profileAttemptKey);
        return { success: true, data: { updated: false } };
      }

      log("handleUserProfileLearn: analyzeUserProfile failed, will retry on next cycle", {
        profileId,
        attempts: newAttempts,
        error: String(analyzeError),
      });
      return { success: false, error: "Profile analysis failed" };
    }

    // Clear retry tracker on success
    profileLearningAttempts.delete(profileAttemptKey);

    if (!updatedProfileData) {
      // AI returned nothing useful — mark prompts as analyzed so they don't loop
      await promptRepo.markMultipleAsUserLearningCaptured(prompts.map((p) => p.id));
      profileLearningAttempts.delete(profileAttemptKey);
      return { success: true, data: { updated: false } };
    }

    // Save profile
    if (existingProfile) {
      let oldProfileData: UserProfileData;
      try {
        oldProfileData = JSON.parse(existingProfile.profileData);
      } catch {
        log("Corrupt profile data, skipping learning cycle", {
          profileId: existingProfile.id,
        });
        await promptRepo.markMultipleAsUserLearningCaptured(prompts.map((p) => p.id));
        return { success: true, data: { updated: false } };
      }

      // Merge with existing data using the repository's merge logic
      const mergedData = profileRepo.mergeProfileData(oldProfileData, updatedProfileData);
      const changeSummary = generateChangeSummary(oldProfileData, mergedData);

      await profileRepo.updateProfile(
        existingProfile.id,
        mergedData,
        prompts.length,
        changeSummary
      );
    } else {
      await profileRepo.createProfile(profileId, updatedProfileData, prompts.length);
    }

    // Mark prompts as analyzed
    await promptRepo.markMultipleAsUserLearningCaptured(prompts.map((p) => p.id));

    return { success: true, data: { updated: true } };
  } catch (error) {
    log("handleUserProfileLearn: error", { error: String(error) });
    return { success: false, error: "Internal server error" };
  }
}

// ── Stub endpoints for planned features ─────────────────

export function handleMigrationDetect(): ApiResponse<{ needsMigration: boolean }> {
  return { success: true, data: { needsMigration: false } };
}

export async function handleCleanup(args: { scope: JobScope; skipGuard?: boolean }): Promise<
  ApiResponse<{
    deletedMemories: number;
    deletedMemoriesUser: number;
    deletedMemoriesProject: number;
    deletedPrompts: number;
  }>
> {
  const skipGuard = args.skipGuard ?? false;
  if (!skipGuard && _cleanupInProgress) {
    return { success: false, error: "Cleanup is already in progress" };
  }

  if (!skipGuard) _cleanupInProgress = true;
  try {
    await ensureInit();

    const retentionDays = CONFIG.autoCleanupRetentionDays ?? 90;
    const cutoff = Date.now() - retentionDays * 86_400_000;

    // Step 1: Delete old prompts & collect linked memory IDs (informational)
    const promptResult = await promptRepo.deleteOldPrompts(cutoff);

    // Step 2: Fetch stale memories (single batch of 1000; known limitation — see SPEC §3.4)
    const oldMemories = await memoryRepo.listOlderThan(cutoff, 1000, 0);

    // Step 3: Iterate, protect, delete, tally
    let deletedMemories = 0;
    let deletedUser = 0;
    let deletedProject = 0;

    for (const mem of oldMemories) {
      // Protection P1: pinned memories are never deleted
      if (mem.isPinned) continue;

      // Protection P2: memories derived from a user prompt are preserved
      if (mem.metadata?.promptId != null) continue;

      // Delete the memory
      await memoryRepo.delete(mem.id);
      deletedMemories++;

      // Classify scope from containerTag
      if (mem.containerTag.includes("_user_")) {
        deletedUser++;
      } else {
        deletedProject++;
      }
    }

    return {
      success: true,
      data: {
        deletedMemories,
        deletedMemoriesUser: deletedUser,
        deletedMemoriesProject: deletedProject,
        deletedPrompts: promptResult.deleted,
      },
    };
  } catch (error) {
    log("handleCleanup: error", { error: String(error) });
    return { success: false, error: "Internal server error" };
  } finally {
    if (!skipGuard) _cleanupInProgress = false;
  }
}

export async function handleDeduplicate(args: { scope: JobScope; skipGuard?: boolean }): Promise<
  ApiResponse<{
    totalChecked: number;
    groupsChecked: number;
    duplicatesFound: number;
    duplicatesRemoved: number;
    failedDeletes: string[];
  }>
> {
  const skipGuard = args.skipGuard ?? false;
  if (!skipGuard && _dedupInProgress) {
    return { success: false, error: "Deduplication is already in progress" };
  }
  if (!skipGuard) _dedupInProgress = true;

  try {
    await ensureInit();

    // Load all memories with embedding vectors.
    // getAllWithVectors() is explicitly designed for pairwise similarity checks
    // (see types.ts:143 comment).
    const memories = await memoryRepo.getAllWithVectors();

    if (memories.length === 0) {
      return {
        success: true,
        data: {
          totalChecked: 0,
          groupsChecked: 0,
          duplicatesFound: 0,
          duplicatesRemoved: 0,
          failedDeletes: [],
        },
      };
    }

    // ── Step 1: Group by containerTag to enforce profile/project boundaries ──
    // containerTag encodes scope (user/project) and identity, so memories in
    // different groups must NEVER be compared or merged.
    const groups = new Map<string, MemoryRecord[]>();
    for (const mem of memories) {
      const key = mem.containerTag;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(mem);
    }

    // ── Step 2: Detect duplicate clusters within each group ──
    // Algorithm:
    //   • Compute pairwise cosine similarity on content embedding vectors.
    //   • If similarity ≥ threshold (0.95), mark the pair as duplicates.
    //   • Use union-find to build transitive closure (if A≈B and B≈C, all three
    //     belong to the same duplicate cluster).
    //   • Per cluster, keep the most-recently-updated memory and delete the rest.
    //
    // Threshold rationale: 0.95 cosine similarity on embedding vectors indicates
    // near-identical semantic content.  This is conservative — only clearly
    // redundant copies are removed.
    const SIMILARITY_THRESHOLD = 0.95;

    let totalChecked = 0;
    let duplicatesFound = 0;
    let duplicatesRemoved = 0;
    const failedDeletes: string[] = [];

    for (const [, group] of groups) {
      if (group.length < 2) continue;
      totalChecked += group.length;

      // Union-Find
      const parent = new Int32Array(group.length);
      for (let i = 0; i < group.length; i++) parent[i] = i;

      const find = (x: number): number => {
        while (parent[x]! !== x) {
          parent[x] = parent[parent[x]!]!; // path compression
          x = parent[x]!;
        }
        return x;
      };

      const union = (a: number, b: number): void => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent[ra] = rb!;
      };

      // Pairwise comparison within the group
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const sim = cosineSimilarity(group[i]!.vector, group[j]!.vector);
          if (sim >= SIMILARITY_THRESHOLD) {
            union(i, j);
          }
        }
      }

      // Collect clusters
      const clusters = new Map<number, number[]>();
      for (let i = 0; i < group.length; i++) {
        const root = find(i);
        if (!clusters.has(root)) clusters.set(root, []);
        clusters.get(root)!.push(i);
      }

      // For each cluster with >1 member: keep most recent, delete the rest
      for (const [, indices] of clusters) {
        if (indices.length < 2) continue;
        duplicatesFound += indices.length - 1;

        // Sort descending by updatedAt — first item is kept
        indices.sort((a, b) => group[b]!.updatedAt - group[a]!.updatedAt);

        // Delete all except the most recently updated
        for (let k = 1; k < indices.length; k++) {
          try {
            await memoryRepo.delete(group[indices[k]!]!.id);
            duplicatesRemoved++;
          } catch (e) {
            const failedId = group[indices[k]!]!.id;
            failedDeletes.push(failedId);
            log("handleDeduplicate: failed to delete duplicate", {
              id: failedId,
              error: String(e),
            });
          }
        }
      }
    }

    log("handleDeduplicate: completed", {
      totalChecked,
      groupsChecked: groups.size,
      duplicatesFound,
      duplicatesRemoved,
      failedDeletes: failedDeletes.length,
    });

    return {
      success: true,
      data: {
        totalChecked,
        groupsChecked: groups.size,
        duplicatesFound,
        duplicatesRemoved,
        failedDeletes,
      },
    };
  } catch (error) {
    logError("handleDeduplicate: error", { error: String(error) });
    return { success: false, error: "Internal server error" };
  } finally {
    if (!skipGuard) _dedupInProgress = false;
  }
}

/**
 * Compute cosine similarity between two embedding vectors.
 * Returns a value in [-1, 1], where 1 = identical direction.
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function handleMigrationRun(_body: {
  strategy: string;
}): ApiResponse<{ deletedShards?: number; reEmbeddedMemories?: number; duration: number }> {
  return { success: false, error: "Migration run not yet implemented" };
}

// ── List all user profiles ───────────────────────────────

export async function handleListUserProfiles(_principal?: Principal): Promise<
  ApiResponse<{
    profiles: Array<{ profileId: string }>;
  }>
> {
  try {
    await ensureInit();
    const profiles = await profileRepo.getAllActiveProfiles();
    const list = profiles.map((p) => ({
      profileId: p.profileId,
    }));

    return {
      success: true,
      data: { profiles: list },
    };
  } catch (error) {
    log("handleListUserProfiles: error", { error: String(error) });
    return { success: false, error: "Internal server error" };
  }
}

export async function handleResetTagMigration(): Promise<ApiResponse> {
  resetMigrationState();
  // Also delete the persisted marker file
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const dataDir = CONFIG.storagePath || "/tmp/opencode-memnet-data";
    await fs.unlink(path.join(dataDir, ".migration", "tag-migration.json"));
  } catch {
    /* file may not exist */
  }
  return { success: true };
}

// ── Client Identity Handlers ───────────────────────────────

export async function handleClientConnect(
  data: {
    clientId: string;
    metadata?: Record<string, unknown>;
  },
  _principal?: Principal
): Promise<
  ApiResponse<{
    firstTime: boolean;
    daysSinceLastSeen: number | null;
    welcomeBack: boolean;
    stats: { totalMemories: number; memoriesToday: number; totalPrompts: number } | null;
  }>
> {
  try {
    if (!data.clientId) {
      return { success: false, error: "clientId is required" };
    }
    await ensureInit();

    const metadata = data.metadata ?? {};
    const result = await clientRepo!.upsertClient(data.clientId, metadata);
    const thresholdHours = getServerConfig().clientWelcomeBackThreshold;

    let daysSinceLastSeen: number | null = null;
    let welcomeBack = false;

    if (result.previousLastSeen && thresholdHours > 0) {
      const hoursSince = (Date.now() - result.previousLastSeen) / (1000 * 60 * 60);
      daysSinceLastSeen = Math.round(hoursSince / 24);
      if (hoursSince >= thresholdHours) {
        welcomeBack = true;
      }
    }

    // Log lifecycle event
    const displayName = data.clientId.slice(0, 8);
    if (result.firstTime) {
      logInfo(`🆕 New client connected: ${displayName}`, {
        clientId: data.clientId,
        metadata,
      });
    } else if (welcomeBack) {
      logInfo(`👋 Welcome back: ${displayName} (last seen ${daysSinceLastSeen}d ago)`, {
        clientId: data.clientId,
        daysSinceLastSeen,
      });
    } else {
      logDebug(`Client connected: ${displayName}`, {
        clientId: data.clientId,
        hoursSinceLast: result.previousLastSeen
          ? Math.round((Date.now() - result.previousLastSeen) / (1000 * 60 * 60))
          : null,
      });
    }

    // Get stats
    const stats = await clientRepo!.getClientStats(data.clientId);

    return {
      success: true,
      data: {
        firstTime: result.firstTime,
        daysSinceLastSeen,
        welcomeBack,
        stats: {
          totalMemories: stats.totalMemories,
          memoriesToday: stats.memoriesToday,
          totalPrompts: stats.totalPrompts,
        },
      },
    };
  } catch (error) {
    logError("handleClientConnect: error", { error: String(error) });
    return { success: false, error: "Internal server error" };
  }
}

export async function handleGetClientStats(data: { clientId: string }): Promise<
  ApiResponse<{
    firstSeen: number;
    lastSeen: number;
    totalMemories: number;
    memoriesToday: number;
    totalPrompts: number;
  }>
> {
  try {
    if (!data.clientId) {
      return { success: false, error: "clientId is required" };
    }
    await ensureInit();

    const stats = await clientRepo!.getClientStats(data.clientId);
    if (!stats.client) {
      return { success: false, error: "Client not found — connect first" };
    }

    return {
      success: true,
      data: {
        firstSeen: stats.client.firstSeen,
        lastSeen: stats.client.lastSeen,
        totalMemories: stats.totalMemories,
        memoriesToday: stats.memoriesToday,
        totalPrompts: stats.totalPrompts,
      },
    };
  } catch (error) {
    logError("handleGetClientStats: error", { error: String(error) });
    return { success: false, error: "Internal server error" };
  }
}
