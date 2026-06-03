# src/services/storage/postgres/

## Responsibility

Concrete PostgreSQL implementations of every storage repository interface, plus shared infrastructure (client pool, migrations, vector utilities, tag registry).

## Design

- **Repository pattern**: each entity gets its own class implementing the corresponding interface from `../types.ts`.
- **Shared client pool**: `client.ts` holds a lazy `postgres.Sql` singleton; all repositories call `getPostgresClient()`.
- **Row mappers**: each repository defines private `rowTo*()` functions converting snake_case DB rows to camelCase domain types.
- **Vector handling**: `vector.ts` provides pure functions for pgvector literal formatting, dimension validation, and URL redaction.

## Entities

| File                       | Entity             | Tables                                                  | Key behavior                                                                                                                             |
| -------------------------- | ------------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `memory-repository.ts`     | Memories           | `memories`                                              | CRUD, HNSW candidate-union search with weighted scoring, pin/unpin, tag/vector migration helpers                                         |
| `prompt-repository.ts`     | User prompts       | `user_prompts`                                          | Save/search prompts, tri-state claim (0=uncaptured, 1=captured, 2=claimed), user-learning capture, cleanup with memory link preservation |
| `profile-repository.ts`    | User profiles      | `user_profiles`, `user_profile_changelogs`              | CRUD with versioned changelogs, confidence decay with optimistic locking, `mergeProfileData` delegates to `profile-utils.ts`             |
| `profile-utils.ts`         | _(shared utility)_ | —                                                       | Pure `mergeProfileData()` with confidence boosting, deduplication, and cap enforcement                                                   |
| `ai-session-repository.ts` | AI sessions        | `ai_sessions`, `ai_messages`                            | Session CRUD with TTL/expiry, message append with sequence retry on UNIQUE violation                                                     |
| `client-repository.ts`     | Clients            | `clients`                                               | Upsert with first-time detection, nickname, aggregate stats                                                                              |
| `tag-registry.ts`          | Canonical tags     | `memory_tags`, `memory_tag_aliases`, `memory_tag_links` | Tag normalization, sorted-term canonicalization, resolve-or-create, memory-tag linking, backfill                                         |
| `migrations.ts`            | Schema migrations  | `schema_migrations`                                     | 14 numbered migrations with transactional/non-transactional support                                                                      |
| `client.ts`                | DB connection pool | —                                                       | Lazy `postgres.Sql` singleton, health check, graceful close                                                                              |
| `vector.ts`                | _(shared utility)_ | —                                                       | `vectorToPgLiteral`, `assertVectorDimensions`, `getVectorCast`, `decodeSqliteVectorBlob`, `redactDatabaseUrl`                            |

## Integration

- Consumed by: `../factory.ts` (via dynamic imports in lazy proxies)
- Depends on: `postgres` npm package, `pgvector` PostgreSQL extension, `../../../config.js`
