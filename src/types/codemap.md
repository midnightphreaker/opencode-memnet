# src/types/

## Responsibility

Shared value-level types used across the memory network: memory classification (`MemoryType`), capture provenance metadata (`MemoryMetadata`), and AI provider identification (`AIProviderType`).

## Design

- `MemoryType` — string alias for memory category tags
- `MemoryMetadata` — extensible metadata bag with optional fields for source tracking (`source`, `tool`, `sessionID`), user identity (`displayName`, `userName`, `userEmail`), project context (`projectPath`, `projectName`, `gitRepoUrl`), and an open index signature for arbitrary extra fields
- `AIProviderType` — string union (`"openai-chat"`) enumerating supported LLM backends

## Integration

- Consumed by: `index` (CLI entry), `client` (remote client), `api-handlers` (HTTP request/response typing)
- Depends on: Nothing (leaf module)
