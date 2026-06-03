# src/services/user-profile/

## Responsibility

Defines domain types and safe-deserialization utilities for the user profile learning subsystem.

## Design

- **types.ts**: Core interfaces — `UserProfile` (DB row), `UserProfileData` (analyzed profile payload containing preferences/patterns/workflows), `UserProfileChangelog` (versioned snapshots). `UserProfilePreference`, `UserProfilePattern`, and `UserProfileWorkflow` are the three constituent data categories.
- **profile-utils.ts**: Generic defensive parsers (`safeArray<T>`, `safeObject<T>`) that handle JSON strings, nested arrays (flattened), and null/fallback coercion. Used wherever profile data is deserialized from potentially malformed storage.

## Integration

- Consumed by: `api-handlers` (HTTP routes), `user-memory-learning` (analysis pipeline), `storage/factory` (Postgres repo), `storage/postgres/profile-utils` (merge logic), `web-server` / `web-server-worker` (API endpoints), `index` (CLI orchestration)
- Depends on: No external dependencies; pure TypeScript with no imports outside this directory
