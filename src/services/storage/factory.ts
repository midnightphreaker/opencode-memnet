/**
 * Storage factory: creates Postgres repository singletons.
 *
 * All heavy imports are deferred via dynamic import to avoid loading
 * the postgres client until the first repository method is called.
 */

import { CONFIG } from "../../config.js";
import { mergeProfileData as sharedMergeProfileData } from "./postgres/profile-utils.js";
import { PostgresTagRegistry } from "./postgres/tag-registry.js";
import type {
  AISessionRepository,
  AIMessageRow,
  AISessionRow,
  ClientRepository,
  ClientRow,
  MemoryRecord,
  MemoryBankRepository,
  MemoryBankRow,
  MemoryBankOwner,
  MemoryRepository,
  MemoryRow,
  MemorySearchOptions,
  SearchResult,
  TagInfo,
  UserApiKeyRepository,
  UserApiKeyRow,
  UserProfileChangelogRow,
  UserProfileData,
  UserProfileRepository,
  UserProfileRow,
  UserPromptRepository,
  UserPromptRow,
} from "./types.js";

// ── Singleton instances (lazily created, cached for the process lifetime) ──

let memoryRepo: MemoryRepository | null = null;
let promptRepo: UserPromptRepository | null = null;
let profileRepo: UserProfileRepository | null = null;
let sessionRepo: AISessionRepository | null = null;
let clientRepo: ClientRepository | null = null;
let userApiKeyRepo: UserApiKeyRepository | null = null;
let memoryBankRepo: MemoryBankRepository | null = null;
let tagRegistry: PostgresTagRegistry | null = null;

export function createMemoryRepository(): MemoryRepository {
  if (memoryRepo) return memoryRepo;
  memoryRepo = new PostgresMemoryRepositoryLazy();
  return memoryRepo;
}

export function createUserPromptRepository(): UserPromptRepository {
  if (promptRepo) return promptRepo;
  promptRepo = new PostgresUserPromptRepositoryLazy();
  return promptRepo;
}

export function createUserProfileRepository(): UserProfileRepository {
  if (profileRepo) return profileRepo;
  profileRepo = new PostgresUserProfileRepositoryLazy();
  return profileRepo;
}

export function createAISessionRepository(): AISessionRepository {
  if (sessionRepo) return sessionRepo;
  sessionRepo = new PostgresAISessionRepositoryLazy();
  return sessionRepo;
}

export function createClientRepository(): ClientRepository {
  if (clientRepo) return clientRepo;
  clientRepo = new PostgresClientRepositoryLazy();
  return clientRepo;
}

export function createUserApiKeyRepository(): UserApiKeyRepository {
  if (userApiKeyRepo) return userApiKeyRepo;
  userApiKeyRepo = new PostgresUserApiKeyRepositoryLazy();
  return userApiKeyRepo;
}

export function createMemoryBankRepository(): MemoryBankRepository {
  if (memoryBankRepo) return memoryBankRepo;
  memoryBankRepo = new PostgresMemoryBankRepositoryLazy();
  return memoryBankRepo;
}

export function createTagRegistry(): PostgresTagRegistry {
  if (tagRegistry) return tagRegistry;
  tagRegistry = new PostgresTagRegistry();
  return tagRegistry;
}

/**
 * Initialize all repositories. Call once at startup.
 */
export async function initializeStorage(): Promise<{
  memoryRepo: MemoryRepository;
  promptRepo: UserPromptRepository;
  profileRepo: UserProfileRepository;
  sessionRepo: AISessionRepository;
  clientRepo: ClientRepository;
  userApiKeyRepo: UserApiKeyRepository;
  memoryBankRepo: MemoryBankRepository;
}> {
  const mem = createMemoryRepository();
  const prompt = createUserPromptRepository();
  const profile = createUserProfileRepository();
  const session = createAISessionRepository();
  const client = createClientRepository();
  const userApiKey = createUserApiKeyRepository();
  const memoryBank = createMemoryBankRepository();

  await mem.initialize();
  await prompt.initialize();
  await profile.initialize();
  await session.initialize();
  await client.initialize();
  await userApiKey.initialize();
  await memoryBank.initialize();

  return {
    memoryRepo: mem,
    promptRepo: prompt,
    profileRepo: profile,
    sessionRepo: session,
    clientRepo: client,
    userApiKeyRepo: userApiKey,
    memoryBankRepo: memoryBank,
  };
}

/**
 * Close all repositories. Call once at shutdown. Idempotent.
 */
export async function closeStorage(): Promise<void> {
  if (memoryRepo) {
    await memoryRepo.close();
    memoryRepo = null;
  }
  if (promptRepo) {
    await promptRepo.close();
    promptRepo = null;
  }
  if (profileRepo) {
    await profileRepo.close();
    profileRepo = null;
  }
  if (sessionRepo) {
    await sessionRepo.close();
    sessionRepo = null;
  }
  if (clientRepo) {
    await clientRepo.close();
    clientRepo = null;
  }
  if (userApiKeyRepo) {
    await userApiKeyRepo.close();
    userApiKeyRepo = null;
  }
  if (memoryBankRepo) {
    await memoryBankRepo.close();
    memoryBankRepo = null;
  }
}

// ── Lazy Postgres proxies ──
// Dynamic imports ensure the postgres client is only loaded on first use.

class PostgresMemoryRepositoryLazy implements MemoryRepository {
  private target: Promise<MemoryRepository> | null = null;

  private async repo(): Promise<MemoryRepository> {
    if (!this.target) {
      this.target = import("./postgres/memory-repository.js")
        .then(({ PostgresMemoryRepository }) => new PostgresMemoryRepository())
        .catch((err) => {
          this.target = null;
          throw err;
        });
    }
    return this.target;
  }

  async initialize(): Promise<void> {
    await (await this.repo()).initialize();
  }
  async close(): Promise<void> {
    await (await this.repo()).close();
  }
  async insert(record: MemoryRecord): Promise<void> {
    await (await this.repo()).insert(record);
  }
  async delete(memoryId: string): Promise<boolean> {
    return (await this.repo()).delete(memoryId);
  }
  async deleteMany(ids: string[]): Promise<number> {
    return (await this.repo()).deleteMany(ids);
  }
  async update(record: MemoryRecord): Promise<void> {
    await (await this.repo()).update(record);
  }
  async getById(memoryId: string): Promise<MemoryRow | null> {
    return (await this.repo()).getById(memoryId);
  }
  async search(options: MemorySearchOptions): Promise<SearchResult[]> {
    return (await this.repo()).search(options);
  }
  async list(args: Parameters<MemoryRepository["list"]>[0]): Promise<MemoryRow[]> {
    return (await this.repo()).list(args);
  }
  async getBySessionId(
    args: Parameters<MemoryRepository["getBySessionId"]>[0]
  ): Promise<SearchResult[]> {
    return (await this.repo()).getBySessionId(args);
  }
  async count(args?: Parameters<MemoryRepository["count"]>[0]): Promise<number> {
    return (await this.repo()).count(args);
  }
  async countByType(
    args?: Parameters<MemoryRepository["countByType"]>[0]
  ): Promise<Record<string, number>> {
    return (await this.repo()).countByType(args);
  }
  async getDistinctTags(
    args?: Parameters<MemoryRepository["getDistinctTags"]>[0]
  ): Promise<TagInfo[]> {
    return (await this.repo()).getDistinctTags(args);
  }
  async getDistinctTagValues(
    args?: Parameters<MemoryRepository["getDistinctTagValues"]>[0]
  ): Promise<string[]> {
    return (await this.repo()).getDistinctTagValues(args);
  }
  async pin(memoryId: string): Promise<void> {
    await (await this.repo()).pin(memoryId);
  }
  async unpin(memoryId: string): Promise<void> {
    await (await this.repo()).unpin(memoryId);
  }
  async listOlderThan(
    args: Parameters<MemoryRepository["listOlderThan"]>[0]
  ): Promise<MemoryRow[]> {
    return (await this.repo()).listOlderThan(args);
  }
  async getAllWithVectors(
    args?: Parameters<MemoryRepository["getAllWithVectors"]>[0]
  ): Promise<MemoryRecord[]> {
    return (await this.repo()).getAllWithVectors(args);
  }
  async countUntagged(owner?: MemoryBankOwner): Promise<number> {
    return (await this.repo()).countUntagged(owner);
  }
  async getUntaggedProjectMemories(
    limit?: number,
    offset?: number,
    owner?: MemoryBankOwner
  ): Promise<MemoryRecord[]> {
    return (await this.repo()).getUntaggedProjectMemories(limit, offset, owner);
  }
  async updateTagsAndVectors(
    id: string,
    tags: string,
    vector: Float32Array,
    tagsVector: Float32Array | undefined,
    updatedAt: number,
    owner?: MemoryBankOwner
  ): Promise<void> {
    await (await this.repo()).updateTagsAndVectors(id, tags, vector, tagsVector, updatedAt, owner);
  }
  async updateTagsOnly(
    id: string,
    tags: string,
    updatedAt: number,
    owner?: MemoryBankOwner
  ): Promise<void> {
    await (await this.repo()).updateTagsOnly(id, tags, updatedAt, owner);
  }
  async updateVectorsOnly(
    id: string,
    vector: Float32Array,
    tagsVector: Float32Array | undefined,
    updatedAt: number,
    owner?: MemoryBankOwner
  ): Promise<void> {
    await (await this.repo()).updateVectorsOnly(id, vector, tagsVector, updatedAt, owner);
  }
  async getMemoriesWithoutVectors(
    limit?: number,
    offset?: number,
    owner?: MemoryBankOwner
  ): Promise<MemoryRecord[]> {
    return (await this.repo()).getMemoriesWithoutVectors(limit, offset, owner);
  }
}

class PostgresUserPromptRepositoryLazy implements UserPromptRepository {
  private target: Promise<UserPromptRepository> | null = null;

  private async repo(): Promise<UserPromptRepository> {
    if (!this.target) {
      this.target = import("./postgres/prompt-repository.js")
        .then(({ PostgresUserPromptRepository }) => new PostgresUserPromptRepository())
        .catch((err) => {
          this.target = null;
          throw err;
        });
    }
    return this.target;
  }

  async initialize(): Promise<void> {
    await (await this.repo()).initialize();
  }
  async close(): Promise<void> {
    await (await this.repo()).close();
  }
  async savePrompt(args: Parameters<UserPromptRepository["savePrompt"]>[0]): Promise<string> {
    return (await this.repo()).savePrompt(args);
  }
  async getLastUncapturedPrompt(
    sessionId: string,
    owner?: MemoryBankOwner
  ): Promise<UserPromptRow | null> {
    return (await this.repo()).getLastUncapturedPrompt(sessionId, owner);
  }
  async deletePrompt(promptId: string, owner?: MemoryBankOwner): Promise<void> {
    await (await this.repo()).deletePrompt(promptId, owner);
  }
  async markAsCaptured(promptId: string, owner?: MemoryBankOwner): Promise<void> {
    await (await this.repo()).markAsCaptured(promptId, owner);
  }
  async claimPrompt(promptId: string, owner?: MemoryBankOwner): Promise<boolean> {
    return (await this.repo()).claimPrompt(promptId, owner);
  }
  async releasePrompt(promptId: string, owner?: MemoryBankOwner): Promise<void> {
    await (await this.repo()).releasePrompt(promptId, owner);
  }
  async countUncapturedPrompts(owner?: MemoryBankOwner): Promise<number> {
    return (await this.repo()).countUncapturedPrompts(owner);
  }
  async getUncapturedPrompts(limit: number, owner?: MemoryBankOwner): Promise<UserPromptRow[]> {
    return (await this.repo()).getUncapturedPrompts(limit, owner);
  }
  async markMultipleAsCaptured(promptIds: string[], owner?: MemoryBankOwner): Promise<void> {
    await (await this.repo()).markMultipleAsCaptured(promptIds, owner);
  }
  async countUnanalyzedForUserLearning(
    profileId: string,
    owner?: MemoryBankOwner
  ): Promise<number> {
    return (await this.repo()).countUnanalyzedForUserLearning(profileId, owner);
  }
  async getPromptsForUserLearning(
    args: Parameters<UserPromptRepository["getPromptsForUserLearning"]>[0]
  ): Promise<UserPromptRow[]> {
    return (await this.repo()).getPromptsForUserLearning(args);
  }
  async markAsUserLearningCaptured(promptId: string, owner?: MemoryBankOwner): Promise<void> {
    await (await this.repo()).markAsUserLearningCaptured(promptId, owner);
  }
  async markMultipleAsUserLearningCaptured(
    promptIds: string[],
    owner?: MemoryBankOwner
  ): Promise<void> {
    await (await this.repo()).markMultipleAsUserLearningCaptured(promptIds, owner);
  }
  async deleteOldPrompts(
    args: Parameters<UserPromptRepository["deleteOldPrompts"]>[0]
  ): Promise<{ deleted: number; linkedMemoryIds: string[] }> {
    return (await this.repo()).deleteOldPrompts(args);
  }
  async linkMemoryToPrompt(
    promptId: string,
    memoryId: string,
    owner?: MemoryBankOwner
  ): Promise<void> {
    await (await this.repo()).linkMemoryToPrompt(promptId, memoryId, owner);
  }
  async getPromptById(promptId: string, owner?: MemoryBankOwner): Promise<UserPromptRow | null> {
    return (await this.repo()).getPromptById(promptId, owner);
  }
  async getCapturedPrompts(
    args: Parameters<UserPromptRepository["getCapturedPrompts"]>[0]
  ): Promise<UserPromptRow[]> {
    return (await this.repo()).getCapturedPrompts(args);
  }
  async searchPrompts(
    args: Parameters<UserPromptRepository["searchPrompts"]>[0]
  ): Promise<UserPromptRow[]> {
    return (await this.repo()).searchPrompts(args);
  }
  async getPromptsByIds(ids: string[], owner?: MemoryBankOwner): Promise<UserPromptRow[]> {
    return (await this.repo()).getPromptsByIds(ids, owner);
  }
}

class PostgresUserProfileRepositoryLazy implements UserProfileRepository {
  private target: Promise<UserProfileRepository> | null = null;

  private async repo(): Promise<UserProfileRepository> {
    if (!this.target) {
      this.target = import("./postgres/profile-repository.js")
        .then(({ PostgresUserProfileRepository }) => new PostgresUserProfileRepository())
        .catch((err) => {
          this.target = null;
          throw err;
        });
    }
    return this.target;
  }

  async initialize(): Promise<void> {
    await (await this.repo()).initialize();
  }
  async close(): Promise<void> {
    await (await this.repo()).close();
  }
  async getActiveProfile(
    profileId: string,
    owner?: MemoryBankOwner
  ): Promise<UserProfileRow | null> {
    return (await this.repo()).getActiveProfile(profileId, owner);
  }
  async getProfileById(profileId: string, owner?: MemoryBankOwner): Promise<UserProfileRow | null> {
    return (await this.repo()).getProfileById(profileId, owner);
  }
  async getAllActiveProfiles(): Promise<UserProfileRow[]> {
    return (await this.repo()).getAllActiveProfiles();
  }
  async createProfile(
    profileId: string,
    profileData: UserProfileData,
    promptsAnalyzed: number,
    ownership?: { apiKeyId?: string; memoryBankId?: string }
  ): Promise<string> {
    return (await this.repo()).createProfile(profileId, profileData, promptsAnalyzed, ownership);
  }
  async updateProfile(
    profileId: string,
    profileData: UserProfileData,
    additionalPromptsAnalyzed: number,
    changeSummary: string,
    ownership?: { apiKeyId?: string; memoryBankId?: string }
  ): Promise<void> {
    await (
      await this.repo()
    ).updateProfile(profileId, profileData, additionalPromptsAnalyzed, changeSummary, ownership);
  }
  async deleteProfile(profileId: string, owner?: MemoryBankOwner): Promise<void> {
    await (await this.repo()).deleteProfile(profileId, owner);
  }
  async applyConfidenceDecay(profileId: string, owner?: MemoryBankOwner): Promise<void> {
    await (await this.repo()).applyConfidenceDecay(profileId, owner);
  }
  async getProfileChangelogs(
    profileId: string,
    limit?: number,
    owner?: MemoryBankOwner
  ): Promise<UserProfileChangelogRow[]> {
    return (await this.repo()).getProfileChangelogs(profileId, limit, owner);
  }
  async getChangelogById(
    changelogId: string,
    owner?: MemoryBankOwner
  ): Promise<UserProfileChangelogRow | null> {
    return (await this.repo()).getChangelogById(changelogId, owner);
  }

  mergeProfileData(existing: UserProfileData, updates: Partial<UserProfileData>): UserProfileData {
    return sharedMergeProfileData(existing, updates, {
      maxPreferences: CONFIG.userProfileMaxPreferences,
      maxPatterns: CONFIG.userProfileMaxPatterns,
      maxWorkflows: CONFIG.userProfileMaxWorkflows,
    });
  }
}

class PostgresAISessionRepositoryLazy implements AISessionRepository {
  private target: Promise<AISessionRepository> | null = null;

  private async repo(): Promise<AISessionRepository> {
    if (!this.target) {
      this.target = import("./postgres/ai-session-repository.js")
        .then(({ PostgresAISessionRepository }) => new PostgresAISessionRepository())
        .catch((err) => {
          this.target = null;
          throw err;
        });
    }
    return this.target;
  }

  async initialize(): Promise<void> {
    await (await this.repo()).initialize();
  }
  async close(): Promise<void> {
    await (await this.repo()).close();
  }
  async getSession(
    sessionId: string,
    provider: string,
    owner?: MemoryBankOwner
  ): Promise<AISessionRow | null> {
    return (await this.repo()).getSession(sessionId, provider, owner);
  }
  async createSession(params: {
    provider: string;
    sessionId: string;
    apiKeyId?: string;
    memoryBankId?: string;
    conversationId?: string;
    metadata?: Record<string, any>;
  }): Promise<AISessionRow> {
    return (await this.repo()).createSession(params);
  }
  async updateSession(
    sessionId: string,
    provider: string,
    updates: { conversationId?: string; metadata?: Record<string, any> },
    owner?: MemoryBankOwner
  ): Promise<void> {
    await (await this.repo()).updateSession(sessionId, provider, updates, owner);
  }
  async deleteSession(sessionId: string, provider: string, owner?: MemoryBankOwner): Promise<void> {
    await (await this.repo()).deleteSession(sessionId, provider, owner);
  }
  async cleanupExpiredSessions(): Promise<number> {
    return (await this.repo()).cleanupExpiredSessions();
  }
  async addMessage(
    message: Omit<AIMessageRow, "id" | "createdAt" | "sequence"> & { sequence?: number }
  ): Promise<number> {
    return (await this.repo()).addMessage(message);
  }
  async getMessages(aiSessionId: string, owner?: MemoryBankOwner): Promise<AIMessageRow[]> {
    return (await this.repo()).getMessages(aiSessionId, owner);
  }
  async getLastSequence(aiSessionId: string, owner?: MemoryBankOwner): Promise<number> {
    return (await this.repo()).getLastSequence(aiSessionId, owner);
  }
  async clearMessages(aiSessionId: string, owner?: MemoryBankOwner): Promise<void> {
    await (await this.repo()).clearMessages(aiSessionId, owner);
  }
}

class PostgresClientRepositoryLazy implements ClientRepository {
  private target: Promise<ClientRepository> | null = null;

  private async repo(): Promise<ClientRepository> {
    if (!this.target) {
      this.target = import("./postgres/client-repository.js")
        .then(({ PostgresClientRepository }) => new PostgresClientRepository())
        .catch((err) => {
          this.target = null;
          throw err;
        });
    }
    return this.target!;
  }

  async initialize(): Promise<void> {
    await (await this.repo()).initialize();
  }
  async close(): Promise<void> {
    await (await this.repo()).close();
  }
  async upsertClient(
    id: string,
    metadata: Record<string, unknown>
  ): Promise<{ firstTime: boolean; previousLastSeen: number | null; row: ClientRow }> {
    return (await this.repo()).upsertClient(id, metadata);
  }
  async getClient(id: string): Promise<ClientRow | null> {
    return (await this.repo()).getClient(id);
  }
  async getClientStats(id: string): Promise<{
    client: ClientRow | null;
    totalMemories: number;
    memoriesToday: number;
    totalPrompts: number;
  }> {
    return (await this.repo()).getClientStats(id);
  }
  async getClientStatsForBank(
    args: Parameters<ClientRepository["getClientStatsForBank"]>[0]
  ): Promise<{
    totalMemories: number;
    memoriesToday: number;
    totalPrompts: number;
  }> {
    return (await this.repo()).getClientStatsForBank(args);
  }
}

class PostgresUserApiKeyRepositoryLazy implements UserApiKeyRepository {
  private target: Promise<UserApiKeyRepository> | null = null;

  private async repo(): Promise<UserApiKeyRepository> {
    if (!this.target) {
      this.target = import("./postgres/user-api-key-repository.js")
        .then(({ PostgresUserApiKeyRepository }) => new PostgresUserApiKeyRepository())
        .catch((err) => {
          this.target = null;
          throw err;
        });
    }
    return this.target;
  }

  async initialize(): Promise<void> {
    await (await this.repo()).initialize();
  }
  async close(): Promise<void> {
    await (await this.repo()).close();
  }
  async create(args: Parameters<UserApiKeyRepository["create"]>[0]): Promise<UserApiKeyRow> {
    return (await this.repo()).create(args);
  }
  async list(): Promise<UserApiKeyRow[]> {
    return (await this.repo()).list();
  }
  async getById(id: string): Promise<UserApiKeyRow | null> {
    return (await this.repo()).getById(id);
  }
  async findByApiKey(apiKeyValue: string): Promise<UserApiKeyRow | null> {
    return (await this.repo()).findByApiKey(apiKeyValue);
  }
  async touchLastUsed(id: string): Promise<void> {
    await (await this.repo()).touchLastUsed(id);
  }
  async update(args: Parameters<UserApiKeyRepository["update"]>[0]): Promise<UserApiKeyRow | null> {
    return (await this.repo()).update(args);
  }
  async revoke(id: string): Promise<boolean> {
    return (await this.repo()).revoke(id);
  }
}

class PostgresMemoryBankRepositoryLazy implements MemoryBankRepository {
  private target: Promise<MemoryBankRepository> | null = null;

  private async repo(): Promise<MemoryBankRepository> {
    if (!this.target) {
      this.target = import("./postgres/memory-bank-repository.js")
        .then(({ PostgresMemoryBankRepository }) => new PostgresMemoryBankRepository())
        .catch((err) => {
          this.target = null;
          throw err;
        });
    }
    return this.target;
  }

  async initialize(): Promise<void> {
    await (await this.repo()).initialize();
  }
  async close(): Promise<void> {
    await (await this.repo()).close();
  }
  async create(args: Parameters<MemoryBankRepository["create"]>[0]): Promise<MemoryBankRow> {
    return (await this.repo()).create(args);
  }
  async listForApiKey(apiKeyId: string): Promise<MemoryBankRow[]> {
    return (await this.repo()).listForApiKey(apiKeyId);
  }
  async getForApiKey(
    args: Parameters<MemoryBankRepository["getForApiKey"]>[0]
  ): Promise<MemoryBankRow | null> {
    return (await this.repo()).getForApiKey(args);
  }
  async getById(memoryBankId: string): Promise<MemoryBankRow | null> {
    return (await this.repo()).getById(memoryBankId);
  }
  async update(args: Parameters<MemoryBankRepository["update"]>[0]): Promise<MemoryBankRow | null> {
    return (await this.repo()).update(args);
  }
  async countRowsForBank(id: string): Promise<{
    memories: number;
    prompts: number;
    profileLearning: number;
    aiSessions: number;
    aiMessages: number;
  }> {
    return (await this.repo()).countRowsForBank(id);
  }
  async delete(id: string): Promise<boolean> {
    return (await this.repo()).delete(id);
  }
}
