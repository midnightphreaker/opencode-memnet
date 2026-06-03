# src/services/storage/

## Responsibility

PostgreSQL/pgvector persistence layer providing typed repository interfaces for memories, prompts, user profiles, AI sessions, and clients.

## Design

- **Factory pattern** (`factory.ts`): exposes singleton `create*Repository()` functions. Each returns a lazy proxy that dynamically imports the concrete Postgres implementation on first method call, keeping the postgres client out of the module graph until needed.
- **Repository pattern**: each domain entity has a typed interface defined in `types.ts` and a concrete Postgres implementation in `postgres/`.
- **pgvector**: memories store `Float32Array` embeddings in `vector`/`tags_vector` columns; search uses HNSW indexes with candidate-union strategy and weighted scoring (`contentSim × 0.6 + tagsSim × 0.4`).
- **Migration runner** (`postgres/migrations.ts`): numbered migrations with transactional/non-transactional support and promise-based deduplication.

## Flow

1. Service layer calls `createXxxRepository()` from `factory.ts` → receives a lazy proxy.
2. First method call triggers dynamic import of the concrete `PostgresXxxRepository`.
3. Repository calls `getPostgresClient()` → lazily creates the `postgres.js` connection pool.
4. `initialize()` runs pending migrations via `runPostgresMigrations()`.
5. CRUD/search operations issue parameterised SQL through the shared pool.
6. `closeStorage()` gracefully drains all repositories and the connection pool.

## Integration

- Consumed by: `src/services/` (memory-service, prompt-capture-service, user-profile-service, session-service, cleanup-service, deduplication-service, tag-migration)
- Depends on: `postgres` (postgres.js driver), `pgvector` extension, `src/config.js` (connection URL, dimensions, vector type)
