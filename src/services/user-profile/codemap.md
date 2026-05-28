# src/services/user-profile/

## Responsibility
Type definitions and utility functions for the user profile learning subsystem.

## Key Files

| File | Purpose |
|------|---------|
| `types.ts` | Profile data types: `UserProfilePreference` (category, confidence, evidence), `UserProfilePattern` (frequency tracking), `UserProfileWorkflow` (steps), `UserProfileData` aggregate, `UserProfile` row, `UserProfileChangelog` |
| `profile-utils.ts` | Safe parsing helpers: `safeArray()` (handles nested arrays, stringified JSON, comma-separated), `safeObject()` (parses string objects with fallback) |

## Integration
- Consumed by: `src/services/storage/postgres/profile-repository.ts` (merge logic), `src/services/user-memory-learning.ts`
- Note: The actual profile merge logic (`mergeProfileData`) lives in `src/services/storage/postgres/profile-utils.ts` which imports from here
