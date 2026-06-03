# src/services/ai/validators/

## Responsibility

Validates structured data returned by AI tool calls before accepting it into the system.

## Design

- `user-profile-validator.ts`: Static `UserProfileValidator` class with a `validate(data) → ValidationResult` method. Checks top-level required keys (`preferences`, `patterns`, `workflows` are arrays), then delegates to private sub-validators (`validatePreferences`, `validatePatterns`, `validateWorkflows`) that enforce per-field types and constraints (e.g., `confidence` is number, `evidence` is non-empty array, `steps` is non-empty array).

## Integration

- Depends on: `services/user-profile/types.ts` (`UserProfileData`)
- Consumed by: `providers/openai-chat-completion.ts` (validates tool-call responses for profile-related tools)
