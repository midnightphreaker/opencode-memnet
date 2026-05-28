# src/services/ai/

## Responsibility
AI provider abstraction layer for generating structured outputs (memory summaries, tags, user profiles) via LLM APIs. Supports two paths: direct API calls and opencode SDK-based structured output.

## Design Patterns
- **Factory**: `AIProviderFactory.createProvider(type, config)` creates provider instances. Currently supports `openai-chat` only.
- **Adapter**: `BaseAIProvider` defines the `executeToolCall()` interface; `OpenAIChatCompletionProvider` adapts it to OpenAI Chat Completions API with multi-turn tool calling
- **Facade**: `opencode-provider.ts` wraps opencode's v2 SDK (`createOpencodeClient`) for structured output via transient sessions

## Key Files

| File | Purpose |
|------|---------|
| `ai-provider-factory.ts` | Creates AI provider instances by type string. Manages AI session repo for cleanup. |
| `provider-config.ts` | `buildMemoryProviderConfig()` — maps CONFIG fields to `ProviderConfig` for the factory |
| `opencode-provider.ts` | SDK-based structured output: creates transient opencode session, prompts with JSON schema, parses Zod-validated result, deletes session |
| `providers/base-provider.ts` | Abstract `BaseAIProvider` with `ProviderConfig` type and `executeToolCall()` method |
| `providers/openai-chat-completion.ts` | OpenAI Chat Completions implementation with multi-turn conversation, tool call loop, and session persistence |
| `provider-config.ts` | Config builder mapping runtime config to provider config |
| `tools/` | Tool definitions for AI provider interactions |
| `validators/` | Response validation helpers |

## Flow
1. **Opencode path** (preferred): `opencodeProvider` + `opencodeModel` configured → `generateStructuredOutput()` → creates transient session → `session.prompt()` with JSON schema → Zod parse → delete session
2. **Direct API path** (fallback): `memoryModel` + `memoryApiUrl` configured → `AIProviderFactory.createProvider()` → `provider.executeToolCall()` → multi-turn completion with tool schema → parse tool call args

## Integration
- Consumed by: `src/services/auto-capture.ts`, `src/services/user-memory-learning.ts`, `src/services/tag-migration-service.ts`, `src/services/auto-capture-server.ts`, `src/services/user-profile-learner-server.ts`
- Depends on: `@opencode-ai/sdk`, `zod`, storage layer (AI session repo)
