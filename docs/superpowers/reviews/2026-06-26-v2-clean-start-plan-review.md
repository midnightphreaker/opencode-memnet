# V2 Clean-Start Plan Review

Date: 2026-06-26

Scope: read-only parallel review of `docs/superpowers/plans/2026-06-26-v2-auth-memory-bank-redesign.md` after the process change to: back up existing opencode-memnet data to file, drop v1 opencode-memnet data, then create the v2 structure.

Subagents:
- Debugging/execution-risk reviewer: `FAIL`
- Code review/architecture reviewer: `PARTIAL`
- Optimization/performance reviewer: `PARTIAL`

No subagent changed files. All three reported opencode-memnet memory failures: `Invalid JSON response`.

## Executive Summary

The plan now states the intended clean-start data policy, but it is not yet implementation-ready. The main blocker is that destructive data removal is still described as a normal migration step, while the server currently auto-runs pending migrations at startup. That means an implementation following the plan literally could destroy v1 data before a backup has been machine-verified.

The plan also needs to reconcile "fresh v2 structure" with retained v1-compatible schema, enforce v2 ownership at the database level, and tighten a few API/test contracts.

## Critical Findings

### 1. Destructive Migration Has No Enforced Backup Gate

The plan says operators must create and verify a backup before migration 15, then migration 15 runs `TRUNCATE TABLE ... RESTART IDENTITY CASCADE`.

Evidence:
- Plan backup policy and commands: `docs/superpowers/plans/2026-06-26-v2-auth-memory-bank-redesign.md:742`
- Planned truncate block: `docs/superpowers/plans/2026-06-26-v2-auth-memory-bank-redesign.md:785`
- Current startup initializes storage and runs migrations before serving HTTP: `src/server.ts:31`
- Current migration runner applies pending migrations automatically: `src/services/storage/postgres/migrations.ts:510`

Recommendation:
- Make clean start a two-part contract:
  - operator backup/reset step creates and verifies a backup file;
  - destructive v2 reset refuses to run unless an explicit confirmation is present.
- Add a concrete gate such as `OPENCODE_MEMNET_V2_CLEAN_START_ACK=<expected value>` plus `OPENCODE_MEMNET_V2_BACKUP_PATH=<dump path>`.
- The gate must verify the backup path exists and is readable before any `TRUNCATE`.
- Add a test proving migration/reset aborts before `TRUNCATE` when the gate is missing.
- Consider moving the truncate into an explicit operator script/command instead of ordinary startup migrations. If kept in migration 15, the backup gate is mandatory.

### 2. V2 Ownership Is Not Database-Enforced After Clean Start

The plan says v2 writes use `api_key_id` and `memory_bank_id` only, but migration 15 adds those columns as nullable and only adds nullable foreign keys.

Evidence:
- Plan policy: `docs/superpowers/plans/2026-06-26-v2-auth-memory-bank-redesign.md:748`
- Planned nullable columns: `docs/superpowers/plans/2026-06-26-v2-auth-memory-bank-redesign.md:826`
- Planned FK additions without `NOT NULL`: `docs/superpowers/plans/2026-06-26-v2-auth-memory-bank-redesign.md:836`
- Current memory insert is still profile-based: `src/services/storage/postgres/memory-repository.ts:280`
- Current prompt insert is still profile-based: `src/services/storage/postgres/prompt-repository.ts:50`

Recommendation:
- After v1 data is dropped, make v2 ownership columns `NOT NULL` where the runtime requires ownership:
  - `memories.api_key_id`
  - `memories.memory_bank_id`
  - `user_prompts.api_key_id`
  - `user_prompts.memory_bank_id`
  - active/profile-learning ownership columns where those rows are used by v2.
- Add migration contract tests proving unscoped inserts fail.
- Keep legacy text columns nullable only as transitional storage fields, not as ownership fields.

## High Findings

### 3. Fresh V2 Structure Conflicts With Retained V1-Compatible Schema

The updated requirement says create a fresh v2 structure, but the plan still says to keep old DB columns as temporary compatibility, keep `profileId` types until Task 10, and alter legacy tables instead of clearly defining a fresh v2 schema policy.

Evidence:
- Current architecture summary says old DB columns are kept temporarily: `docs/superpowers/plans/2026-06-26-v2-auth-memory-bank-redesign.md:7`
- Plan keeps `profileId` in types until Task 10: `docs/superpowers/plans/2026-06-26-v2-auth-memory-bank-redesign.md:740`
- Planned schema evolves old tables rather than fully recreating them: `docs/superpowers/plans/2026-06-26-v2-auth-memory-bank-redesign.md:826`

Recommendation:
- Make one explicit decision in the plan:
  - Option A: "fresh v2 data on evolved v1 tables", where legacy columns remain only as ignored nullable implementation residue until cleanup; or
  - Option B: true clean-start schema reset, dropping/recreating runtime tables with v2 ownership columns.
- Given the user direction, prefer Option B where feasible: backup, drop v1 opencode-memnet runtime/auth/memory tables, create fresh v2 runtime/auth/memory structures.
- If implementation keeps any legacy columns temporarily, state that this is schema-transition residue only and not an upgrade/compatibility path.

### 4. AI Session Tables Are Truncated But Not Given V2 Ownership

Migration 15 truncates `ai_messages` and `ai_sessions`, but the plan only adds `api_key_id` and `memory_bank_id` to memories, prompts, and profiles.

Evidence:
- Planned truncation includes AI session tables: `docs/superpowers/plans/2026-06-26-v2-auth-memory-bank-redesign.md:796`
- Planned ownership columns cover only `memories`, `user_prompts`, and `user_profiles`: `docs/superpowers/plans/2026-06-26-v2-auth-memory-bank-redesign.md:826`
- Current AI session schema has no bank owner: `src/services/storage/postgres/migrations.ts:288`

Recommendation:
- Either add v2 ownership columns, FKs, and indexes for AI session data, or explicitly remove/defer AI session persistence from v2 flows after truncation.
- If retained, add tests proving AI sessions/messages are scoped to the active Memory Bank.

### 5. Tag Registry Behavior Is Bank-Local But Schema Is Global

The plan requires tag lists and tag registry links to be bank-local, but current tag tables use global canonical names and global tag links.

Evidence:
- Plan requires bank-local tag behavior: `docs/superpowers/plans/2026-06-26-v2-auth-memory-bank-redesign.md:2491`
- Current global tag schema: `src/services/storage/postgres/migrations.ts:399`
- Current global tag list: `src/services/storage/postgres/tag-registry.ts:361`
- Current related-memory query is global: `src/services/storage/postgres/tag-registry.ts:409`

Recommendation:
- Decide and document one of these:
  - bank-local tags: `memory_tags(memory_bank_id, canonical_name)` unique and `memory_tag_links(memory_bank_id, memory_id, tag_id)`;
  - global canonical vocabulary with bank-local links only.
- Given the Memory Bank isolation model, prefer bank-local tags unless there is a concrete cross-bank vocabulary requirement.
- Add cross-bank tests for tag list, alias lookup, related memories, and tag migration.

### 6. Task 1 Config-File Test Uses A Nonexistent `CONFIG_FILE` Mechanism

The plan's config-file test uses `CONFIG_FILE`, but current config loading reads fixed paths under `~/.config/opencode`, and server config currently reads environment/generated files.

Evidence:
- Planned test sets `CONFIG_FILE`: `docs/superpowers/plans/2026-06-26-v2-auth-memory-bank-redesign.md:279`
- Current config path constants: `src/config.ts:9`
- Current config loading entrypoint: `src/config.ts:216`
- Current server config env loading: `src/server-config.ts:160`

Recommendation:
- Either add and document `CONFIG_FILE` support, or change the test to use a temporary `HOME` with the existing config-file path convention.
- The plan should specify exactly how `server.apiKey` is read into `initServerConfig()`.

### 7. `ClientConnectResponse` Stats Path Needs Contract And Authorization

The plan calls/mocks `getClientStatsForBank`, but `ClientRepository` currently exposes only `getClientStats`. The planned connect handler also needs to authorize `body.memoryBankId` before returning stats.

Evidence:
- Planned mock: `docs/superpowers/plans/2026-06-26-v2-auth-memory-bank-redesign.md:1688`
- Planned handler call: `docs/superpowers/plans/2026-06-26-v2-auth-memory-bank-redesign.md:1882`
- Current `ClientRepository`: `src/services/storage/types.ts:413`
- API contract allows `memoryBankId` for stats: `docs/superpowers/plans/2026-06-26-v2-auth-memory-bank-redesign.md:135`

Recommendation:
- Add `getClientStatsForBank` to repository types, factory, Postgres implementation, and tests, or move scoped stats to memory/prompt repositories.
- In `handleClientConnect`, resolve `body.memoryBankId` through `AuthService.requireBankForPrincipal()` or `memoryBankRepo.getForApiKey()` before stats.
- Add a negative test for a user API key requesting stats for another API key's Memory Bank.

## Medium Findings

### 8. Admin Update/Revoke/Delete Route Tests Are Under-Specified

Task 4B says to implement admin update/revoke/delete routes, but the shown route tests only cover list/create/CORS.

Evidence:
- Contract declares update/revoke/delete routes: `docs/superpowers/plans/2026-06-26-v2-auth-memory-bank-redesign.md:136`
- Task 4B says to implement those routes: `docs/superpowers/plans/2026-06-26-v2-auth-memory-bank-redesign.md:2224`
- Current test snippet covers list/create/CORS only: `docs/superpowers/plans/2026-06-26-v2-auth-memory-bank-redesign.md:2065`

Recommendation:
- Add route tests for:
  - `PATCH /api/admin/api-keys/:id`
  - `POST /api/admin/api-keys/:id/revoke`
  - `PATCH /api/admin/memory-banks/:id`
  - `DELETE /api/admin/memory-banks/:id`
  - refusal to delete a non-empty Memory Bank.

### 9. No Concrete Test File Proves No V1 Import/Backfill Path Remains

The plan says no v1 import/backfill/compatibility path remains, but the final scans target mainly legacy auth/profile symbols.

Evidence:
- Plan requirement: `docs/superpowers/plans/2026-06-26-v2-auth-memory-bank-redesign.md:900`
- Final scan section focuses on legacy auth/profile terms: `docs/superpowers/plans/2026-06-26-v2-auth-memory-bank-redesign.md:3630`

Recommendation:
- Add an explicit test such as `tests/v2-clean-start-no-upgrade-path.test.ts`.
- It should assert no source path contains v1 import/backfill/compatibility code for memories/prompts/profiles and no v2 API can expose rows lacking `api_key_id`/`memory_bank_id`.

### 10. Prompt Indexes Miss Bank-Scoped Queue And Learning Query Shapes

The planned prompt indexes cover created/captured/session, but current hot paths include uncaptured queues, user-learning queues, linked-memory cleanup, and content search.

Evidence:
- Planned prompt indexes: `docs/superpowers/plans/2026-06-26-v2-auth-memory-bank-redesign.md:875`
- Current uncaptured prompt count/query paths: `src/services/storage/postgres/prompt-repository.ts:101`
- Current user-learning queue paths: `src/services/storage/postgres/prompt-repository.ts:129`
- Current linked-memory cleanup paths: `src/services/storage/postgres/prompt-repository.ts:170`
- Current content search path: `src/services/storage/postgres/prompt-repository.ts:233`

Recommendation:
- Add targeted indexes:
  - `(memory_bank_id, captured, created_at ASC)`
  - `(memory_bank_id, user_learning_captured, created_at ASC)`
  - `(memory_bank_id, linked_memory_id)`
- Decide whether prompt content search uses `pg_trgm` or accepts a bank-local scan.

### 11. Bank-Scoped Vector Search Needs Recall/Latency Validation

The plan adds btree bank indexes, but pgvector HNSW indexes remain global. This may affect filtered ANN recall/latency under many small Memory Banks.

Evidence:
- Current global HNSW indexes: `src/services/storage/postgres/migrations.ts:193`
- Current search combines vector ordering with filters: `src/services/storage/postgres/memory-repository.ts:189`
- Planned bank btree indexes: `docs/superpowers/plans/2026-06-26-v2-auth-memory-bank-redesign.md:867`

Recommendation:
- Add an acceptance benchmark for bank-filtered vector search with realistic bank cardinalities.
- Include validation/tuning for `hnsw.ef_search`, candidate limits, and query plan shape.

## Recommended Plan Patch Outline

1. Add a second review-fixup section near the top: "Clean-Start Review Fixups Applied".
2. Add a mandatory destructive reset gate before migration 15 can truncate data.
3. Decide "fresh v2 structure" schema policy and reflect it consistently in the architecture summary and Task 2.
4. Make v2 ownership columns `NOT NULL` after the clean-start purge.
5. Add or remove/defer AI session v2 ownership explicitly.
6. Make tag registry isolation schema-level or explicitly define global vocabulary plus bank-local links.
7. Fix the config-file test to match actual config loading or add `CONFIG_FILE` support.
8. Add scoped stats contract and authorization for `ClientConnectResponse`.
9. Expand Task 4B route tests for admin update/revoke/delete.
10. Add a no-upgrade-path test file.
11. Add prompt indexes and vector-search validation acceptance criteria.

## Verification Evidence

Main-session read-only checks also confirmed:
- The current README still contains legacy SQL backup text and profile/repo language that Task 10 must replace.
- The current migration runner auto-applies pending migrations.
- The current migration definitions include global tag schema and AI session tables without bank ownership.
