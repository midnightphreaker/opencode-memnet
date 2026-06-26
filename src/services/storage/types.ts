/**
 * Storage repository interfaces and shared types for the storage abstraction layer.
 */

export type MemoryScopeKind = "user" | "project";

export interface ProfileScope {
  profileId?: string;
}

export interface ProjectScope extends ProfileScope {
  repoId: string;
}

export interface MemoryBankOwner {
  apiKeyId: string;
  memoryBankId: string;
}

// ── Search and query types ──

export interface MemorySearchOptions {
  queryVector: Float32Array;
  queryText?: string;
  scope: MemoryScopeKind;
  scopeHash: string;
  containerTag: string;
  includeAllContainers?: boolean;
  limit: number;
  similarityThreshold: number;
  profileId?: string;
  repoId?: string;
  apiKeyId?: string;
  memoryBankId?: string;
}

// ── Row / result types ──

export interface MemoryRow {
  id: string;
  content: string;
  containerTag: string;
  tags: string[];
  type?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  profileId?: string;
  repoId?: string;
  apiKeyId?: string;
  memoryBankId?: string;
  localProjectPath?: string;
  gitRepoUrl?: string;
  repoNickname?: string;
  isPinned?: boolean;
}

export interface SearchResult {
  id: string;
  /** Memory text content. Named "memory" for search results but semantically identical to MemoryRow.content */
  memory: string;
  similarity: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
  profileId?: string;
  repoId?: string;
  localProjectPath?: string;
  gitRepoUrl?: string;
  repoNickname?: string;
  isPinned?: boolean;
  containerTag?: string;
  createdAt?: number;
  apiKeyId?: string;
  memoryBankId?: string;
}

export interface TagInfo {
  tag: string;
  tags?: string[];
  profileId?: string;
  repoId?: string;
  apiKeyId?: string;
  memoryBankId?: string;
  localProjectPath?: string;
  gitRepoUrl?: string;
  repoNickname?: string;
}

export interface MemoryRecord {
  id: string;
  content: string;
  vector: Float32Array;
  tagsVector?: Float32Array;
  containerTag: string;
  tags?: string;
  type?: string;
  createdAt: number;
  updatedAt: number;
  metadata?: string;
  profileId?: string;
  repoId?: string;
  apiKeyId?: string;
  memoryBankId?: string;
  localProjectPath?: string;
  gitRepoUrl?: string;
  repoNickname?: string;
}

export interface UserApiKeyRow {
  id: string;
  name: string;
  description: string;
  apiKeyHash: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export interface UserApiKeyRepository {
  initialize(): Promise<void>;
  close(): Promise<void>;
  create(args: {
    id: string;
    name: string;
    description: string;
    apiKeyValue: string;
  }): Promise<UserApiKeyRow>;
  list(): Promise<UserApiKeyRow[]>;
  getById(id: string): Promise<UserApiKeyRow | null>;
  findByApiKey(apiKeyValue: string): Promise<UserApiKeyRow | null>;
  touchLastUsed(id: string): Promise<void>;
  update(args: { id: string; name?: string; description?: string }): Promise<UserApiKeyRow | null>;
  revoke(id: string): Promise<boolean>;
}

export interface MemoryBankRow {
  id: string;
  apiKeyId: string;
  apiKeyName: string;
  name: string;
  description: string;
  shortcut: string;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryBankRepository {
  initialize(): Promise<void>;
  close(): Promise<void>;
  create(args: {
    id: string;
    apiKeyId: string;
    name: string;
    description: string;
  }): Promise<MemoryBankRow>;
  listForApiKey(apiKeyId: string): Promise<MemoryBankRow[]>;
  getForApiKey(args: { apiKeyId: string; memoryBankId: string }): Promise<MemoryBankRow | null>;
  getById(memoryBankId: string): Promise<MemoryBankRow | null>;
  update(args: { id: string; name?: string; description?: string }): Promise<MemoryBankRow | null>;
  countRowsForBank(id: string): Promise<{
    memories: number;
    prompts: number;
    profileLearning: number;
    aiSessions: number;
    aiMessages: number;
  }>;
  delete(id: string): Promise<boolean>;
}

// ── Memory repository interface ──

export interface MemoryRepository {
  initialize(): Promise<void>;
  close(): Promise<void>;

  insert(record: MemoryRecord): Promise<void>;
  delete(memoryId: string, owner?: MemoryBankOwner): Promise<boolean>;
  deleteMany(ids: string[], owner?: MemoryBankOwner): Promise<number>;
  update(record: MemoryRecord): Promise<void>;
  getById(memoryId: string, owner?: MemoryBankOwner): Promise<MemoryRow | null>;

  search(options: MemorySearchOptions): Promise<SearchResult[]>;

  list(args: {
    scope: MemoryScopeKind;
    scopeHash: string;
    containerTag: string;
    includeAllContainers?: boolean;
    containerTagFilter?: string;
    limit: number;
    profileId?: string;
    repoId?: string;
    apiKeyId?: string;
    memoryBankId?: string;
  }): Promise<MemoryRow[]>;

  getBySessionId(args: {
    sessionId: string;
    scope: MemoryScopeKind;
    scopeHash: string;
    limit: number;
  }): Promise<SearchResult[]>;

  count(args?: {
    containerTag?: string;
    scope?: MemoryScopeKind;
    scopeHash?: string;
    profileId?: string;
    repoId?: string;
    apiKeyId?: string;
    memoryBankId?: string;
  }): Promise<number>;

  /**
   * Returns a breakdown of memory counts grouped by type.
   * Used by handleStats to avoid loading all rows into memory.
   */
  countByType(args?: {
    profileId?: string;
    repoId?: string;
    apiKeyId?: string;
    memoryBankId?: string;
  }): Promise<Record<string, number>>;

  getDistinctTags(args?: {
    scope?: MemoryScopeKind;
    scopeHash?: string;
    profileId?: string;
    repoId?: string;
    apiKeyId?: string;
    memoryBankId?: string;
  }): Promise<TagInfo[]>;
  getDistinctTagValues(args?: {
    scope?: MemoryScopeKind;
    profileId?: string;
    repoId?: string;
    apiKeyId?: string;
    memoryBankId?: string;
  }): Promise<string[]>;

  pin(memoryId: string, owner?: MemoryBankOwner): Promise<void>;
  unpin(memoryId: string, owner?: MemoryBankOwner): Promise<void>;

  /**
   * Returns memories whose `updatedAt` is older than `cutoffTime`.
   * Used by cleanup-service to identify stale memories.
   */
  listOlderThan(args: {
    cutoffTime: number;
    limit?: number;
    offset?: number;
    profileId?: string;
    apiKeyId?: string;
    memoryBankId?: string;
  }): Promise<MemoryRow[]>;

  /**
   * Returns all memory records including their raw Float32Array vectors.
   * Used by deduplication-service for pairwise similarity checks.
   */
  getAllWithVectors(args?: {
    limit?: number;
    offset?: number;
    profileId?: string;
    apiKeyId?: string;
    memoryBankId?: string;
  }): Promise<MemoryRecord[]>;

  /**
   * Count project memories with NULL or empty tags column.
   * Used by tag-migration detection.
   */
  countUntagged(owner?: MemoryBankOwner): Promise<number>;

  /**
   * Returns untagged project-scoped memories with pagination, including
   * their raw vectors. Used by tag-migration to process memories that
   * need LLM-generated tags.
   */
  getUntaggedProjectMemories(
    limit?: number,
    offset?: number,
    owner?: MemoryBankOwner
  ): Promise<MemoryRecord[]>;

  /**
   * Update the tags column, re-embed and overwrite vector/tags_vector blobs,
   * set updated_at, and refresh the vector backend index.
   * Used by tag-migration batch processing.
   */
  updateTagsAndVectors(
    id: string,
    tags: string,
    vector: Float32Array,
    tagsVector: Float32Array | undefined,
    updatedAt: number,
    owner?: MemoryBankOwner
  ): Promise<void>;

  /**
   * Update only the tags column (no vectors). Used when tags succeed
   * but embedding/vector generation fails, so the memory is marked as
   * tagged and won't be picked up again for tag generation.
   */
  updateTagsOnly(
    id: string,
    tags: string,
    updatedAt: number,
    owner?: MemoryBankOwner
  ): Promise<void>;

  /**
   * Update only the vector/tags_vector columns (tags must already be set).
   * Used as a separate pass after tags are written.
   */
  updateVectorsOnly(
    id: string,
    vector: Float32Array,
    tagsVector: Float32Array | undefined,
    updatedAt: number,
    owner?: MemoryBankOwner
  ): Promise<void>;

  /**
   * Get memories that have tags but missing vector/tagsVector columns.
   * Used for the separate vector-generation pass.
   */
  getMemoriesWithoutVectors(
    limit?: number,
    offset?: number,
    owner?: MemoryBankOwner
  ): Promise<MemoryRecord[]>;
}

// ── User prompt repository interface ──

export interface UserPromptRow {
  id: string;
  sessionId: string;
  messageId: string;
  profileId: string;
  repoId: string;
  apiKeyId?: string;
  memoryBankId?: string;
  localProjectPath: string | null;
  content: string;
  createdAt: number;
  captured: number; // 0=uncaptured, 1=captured, 2=claimed
  userLearningCaptured: boolean;
  linkedMemoryId: string | null;
}

export interface UserPromptRepository {
  initialize(): Promise<void>;
  close(): Promise<void>;

  savePrompt(args: {
    sessionId: string;
    messageId: string;
    profileId: string;
    repoId: string;
    apiKeyId?: string;
    memoryBankId?: string;
    localProjectPath?: string;
    content: string;
  }): Promise<string>;
  getLastUncapturedPrompt(
    sessionId: string,
    owner?: MemoryBankOwner
  ): Promise<UserPromptRow | null>;
  deletePrompt(promptId: string, owner?: MemoryBankOwner): Promise<void>;
  markAsCaptured(promptId: string, owner?: MemoryBankOwner): Promise<void>;
  claimPrompt(promptId: string, owner?: MemoryBankOwner): Promise<boolean>;
  releasePrompt(promptId: string, owner?: MemoryBankOwner): Promise<void>;
  countUncapturedPrompts(owner?: MemoryBankOwner): Promise<number>;
  getUncapturedPrompts(limit: number, owner?: MemoryBankOwner): Promise<UserPromptRow[]>;
  markMultipleAsCaptured(promptIds: string[], owner?: MemoryBankOwner): Promise<void>;
  countUnanalyzedForUserLearning(profileId: string, owner?: MemoryBankOwner): Promise<number>;
  getPromptsForUserLearning(args: {
    profileId: string;
    limit: number;
    apiKeyId?: string;
    memoryBankId?: string;
  }): Promise<UserPromptRow[]>;
  markAsUserLearningCaptured(promptId: string, owner?: MemoryBankOwner): Promise<void>;
  markMultipleAsUserLearningCaptured(promptIds: string[], owner?: MemoryBankOwner): Promise<void>;
  deleteOldPrompts(args: {
    cutoffTime: number;
    profileId?: string;
    apiKeyId?: string;
    memoryBankId?: string;
  }): Promise<{ deleted: number; linkedMemoryIds: string[] }>;
  linkMemoryToPrompt(promptId: string, memoryId: string, owner?: MemoryBankOwner): Promise<void>;
  getPromptById(promptId: string, owner?: MemoryBankOwner): Promise<UserPromptRow | null>;
  getCapturedPrompts(args: {
    profileId: string;
    repoId?: string;
    apiKeyId?: string;
    memoryBankId?: string;
  }): Promise<UserPromptRow[]>;
  searchPrompts(args: {
    query: string;
    profileId: string;
    repoId?: string;
    apiKeyId?: string;
    memoryBankId?: string;
    limit?: number;
  }): Promise<UserPromptRow[]>;
  getPromptsByIds(ids: string[], owner?: MemoryBankOwner): Promise<UserPromptRow[]>;
}

// ── User profile repository interface ──

export interface UserProfileData {
  preferences: any[];
  patterns: any[];
  workflows: any[];
}

export interface UserProfileRow {
  id: string;
  profileId: string;
  apiKeyId?: string;
  memoryBankId?: string;
  profileData: string;
  version: number;
  createdAt: number;
  lastAnalyzedAt: number;
  totalPromptsAnalyzed: number;
  isActive: boolean;
}

export interface UserProfileChangelogRow {
  id: string;
  profileId: string;
  apiKeyId?: string;
  memoryBankId?: string;
  version: number;
  changeType: string;
  changeSummary: string;
  profileDataSnapshot: string;
  createdAt: number;
}

export interface UserProfileRepository {
  initialize(): Promise<void>;
  close(): Promise<void>;

  getActiveProfile(profileId: string, owner?: MemoryBankOwner): Promise<UserProfileRow | null>;
  getProfileById(profileId: string, owner?: MemoryBankOwner): Promise<UserProfileRow | null>;
  getAllActiveProfiles(): Promise<UserProfileRow[]>;
  createProfile(
    profileId: string,
    profileData: UserProfileData,
    promptsAnalyzed: number,
    ownership?: { apiKeyId?: string; memoryBankId?: string }
  ): Promise<string>;
  updateProfile(
    profileId: string,
    profileData: UserProfileData,
    additionalPromptsAnalyzed: number,
    changeSummary: string,
    ownership?: { apiKeyId?: string; memoryBankId?: string }
  ): Promise<void>;
  deleteProfile(profileId: string, owner?: MemoryBankOwner): Promise<void>;
  applyConfidenceDecay(profileId: string, owner?: MemoryBankOwner): Promise<void>;
  getProfileChangelogs(
    profileId: string,
    limit?: number,
    owner?: MemoryBankOwner
  ): Promise<UserProfileChangelogRow[]>;
  getChangelogById(
    changelogId: string,
    owner?: MemoryBankOwner
  ): Promise<UserProfileChangelogRow | null>;

  /**
   * Merge incoming profile data into the existing data, applying
   * confidence boosting, deduplication, and cap enforcement.
   */
  mergeProfileData(existing: UserProfileData, updates: Partial<UserProfileData>): UserProfileData;
}

// ── AI session repository interface ──

export interface AISessionRow {
  id: string;
  apiKeyId?: string;
  memoryBankId?: string;
  provider: string;
  sessionId: string;
  conversationId?: string;
  metadata?: Record<string, any>;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

export interface AIMessageRow {
  id?: number;
  aiSessionId: string;
  apiKeyId?: string;
  memoryBankId?: string;
  sequence: number;
  role: string;
  content: string;
  toolCalls?: any;
  toolCallId?: string;
  contentBlocks?: any;
  createdAt: number;
}

export interface AISessionRepository {
  initialize(): Promise<void>;
  close(): Promise<void>;

  getSession(
    sessionId: string,
    provider: string,
    owner?: MemoryBankOwner
  ): Promise<AISessionRow | null>;
  createSession(params: {
    provider: string;
    sessionId: string;
    apiKeyId?: string;
    memoryBankId?: string;
    conversationId?: string;
    metadata?: Record<string, any>;
  }): Promise<AISessionRow>;
  updateSession(
    sessionId: string,
    provider: string,
    updates: { conversationId?: string; metadata?: Record<string, any> },
    owner?: MemoryBankOwner
  ): Promise<void>;
  deleteSession(sessionId: string, provider: string, owner?: MemoryBankOwner): Promise<void>;
  cleanupExpiredSessions(): Promise<number>;

  addMessage(
    message: Omit<AIMessageRow, "id" | "createdAt" | "sequence"> & { sequence?: number }
  ): Promise<number>;
  getMessages(aiSessionId: string, owner?: MemoryBankOwner): Promise<AIMessageRow[]>;
  getLastSequence(aiSessionId: string, owner?: MemoryBankOwner): Promise<number>;
  clearMessages(aiSessionId: string, owner?: MemoryBankOwner): Promise<void>;
}

// ── Client tracking types ──

export interface ClientRow {
  id: string;
  firstSeen: number; // unix epoch ms
  lastSeen: number; // unix epoch ms
  clientMetadata: Record<string, unknown>;
  createdAt: number; // unix epoch ms
  updatedAt: number; // unix epoch ms
}

export interface ClientRepository {
  initialize(): Promise<void>;
  close(): Promise<void>;
  upsertClient(
    id: string,
    metadata: Record<string, any>
  ): Promise<{ firstTime: boolean; previousLastSeen: number | null; row: ClientRow }>;
  getClient(id: string): Promise<ClientRow | null>;
  getClientStats(id: string): Promise<{
    client: ClientRow | null;
    totalMemories: number;
    memoriesToday: number;
    totalPrompts: number;
  }>;
  getClientStatsForBank(args: {
    clientId: string;
    apiKeyId: string;
    memoryBankId: string;
  }): Promise<{
    totalMemories: number;
    memoriesToday: number;
    totalPrompts: number;
  }>;
}
