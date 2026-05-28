# src/services/storage/

## Responsibility
Storage abstraction layer providing repository interfaces and Postgres implementations for memories, user prompts, user profiles, AI sessions, and client tracking.

## Design Patterns
- **Repository Pattern**: Each domain entity (Memory, UserPrompt, UserProfile, AISession, Client) has a typed interface in `types.ts` and a concrete Postgres implementation
- **Lazy Proxy / Virtual Proxy**: `factory.ts` wraps each Postgres repo in a lazy class that defers the dynamic import until first method call, keeping the postgres client out of the initial bundle
- **Factory**: `createMemoryRepository()`, `createUserPromptRepository()`, etc. return singleton instances
- **Strategy**: `mergeProfileData()` from `postgres/profile-utils.ts` handles confidence decay, deduplication, and cap enforcement for profile updates

## Key Files

| File | Purpose |
|------|---------|
| `types.ts` | All repository interfaces (`MemoryRepository`, `UserPromptRepository`, `UserProfileRepository`, `AISessionRepository`, `ClientRepository`) plus row/result types |
| `factory.ts` | Singleton factory with lazy Postgres proxies. `initializeStorage()` creates and inits all repos. `closeStorage()` for graceful shutdown. |
| `postgres/` | Concrete Postgres implementations (memory-repository, prompt-repository, profile-repository, ai-session-repository, client-repository, profile-utils) |

## Data Model
- **Memories**: id, content, vector (Float32Array), tagsVector, containerTag, tags, type, metadata JSON, project/user identity fields, timestamps
- **User Prompts**: id, sessionId, messageId, projectPath, content, capture state machine (uncaptured→claimed→captured), linked memory ID
- **User Profiles**: userId, profileData (JSON with preferences/patterns/workflows), version, changelog with snapshots
- **AI Sessions**: provider, sessionId, conversation tracking, message history, expiration
- **Clients**: id, nickname, firstSeen/lastSeen, metadata, stats (total memories/prompts)

## Flow
1. `factory.ts` → `createXxxRepository()` → lazy proxy wraps dynamic import of `postgres/xxx-repository.ts`
2. First method call triggers `import()` → real Postgres class instantiation → `initialize()` runs migrations
3. All subsequent calls delegate to the cached real instance

## Integration
- Consumed by: `src/services/client.ts`, `src/services/auto-capture.ts`, `src/services/api-handlers.ts`, `src/services/user-memory-learning.ts`
- Depends on: `src/config.ts` (connection params), `postgres` package
