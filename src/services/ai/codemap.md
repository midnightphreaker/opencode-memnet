# src/services/ai/

## Responsibility

Abstracts AI provider interactions for memory extraction, offering two paths: a direct OpenAI-compatible HTTP provider (tool-call loop) and an opencode SDK-based structured-output path that delegates auth/routing to the running opencode server.

## Design

- **Factory pattern**: `AIProviderFactory` instantiates concrete providers by type string (currently `"openai-chat"` → `OpenAIChatCompletionProvider`).
- **SDK path**: `opencode-provider.ts` manages a v2 `OpencodeClient` singleton and exposes `generateStructuredOutput<T>()`, which creates a transient session, prompts with a Zod-derived JSON schema, validates, and deletes the session.
- **Config builder**: `provider-config.ts` normalizes runtime config (`MemoryProviderRuntimeConfig`) into a `ProviderConfig` with safe defaults for temperature, max iterations, and timeout.
- **Subdirectories**: `providers/` (provider implementations), `tools/` (tool schema types), `validators/` (AI response validation).

## Flow

1. Caller imports `AIProviderFactory` + `buildMemoryProviderConfig` (or `opencode-provider` helpers).
2. `buildMemoryProviderConfig()` merges runtime config with overrides → `ProviderConfig`.
3. `AIProviderFactory.createProvider(type, config)` → concrete `BaseAIProvider`.
4. Provider's `executeToolCall()` runs an iterative chat-completion loop: sends system/user prompts, receives tool calls, validates via `UserProfileValidator`, feeds errors back for retry up to `maxIterations`.
5. SDK path: `generateStructuredOutput()` → creates opencode session → prompts with JSON schema → Zod-parse → return typed result → delete session.

## Integration

- Consumed by: `user-memory-learning.ts`, `auto-capture.ts`, `auto-capture-server.ts`, `user-profile-learner-server.ts`, `tag-migration-service.ts`, `src/index.ts`
- Depends on: `@opencode-ai/sdk` (v2 client), OpenAI-compatible chat completion APIs, `services/storage` (session/message persistence), `services/user-profile/types`
