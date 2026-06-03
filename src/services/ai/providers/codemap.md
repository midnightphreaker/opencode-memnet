# src/services/ai/providers/

## Responsibility

Concrete AI provider implementations that execute tool-call loops against chat-completion APIs.

## Design

- `base-provider.ts`: Abstract `BaseAIProvider` class with `executeToolCall()`, `getProviderName()`, `supportsSession()` contract. Exports `ProviderConfig` interface and `applySafeExtraParams()` (blocks protected keys like `model`, `messages`, `temperature` from user-supplied overrides).
- `openai-chat-completion.ts`: `OpenAIChatCompletionProvider` — implements the iterative tool-call loop. Manages conversation history via `AISessionRepository`, handles abort timeouts, API error detection, incomplete tool-call sequence filtering, and validation of tool responses through `UserProfileValidator`.

## Flow

1. `executeToolCall()` loads or creates a session from `AISessionRepository`.
2. Replays persisted messages (filtering incomplete tool-call sequences).
3. Sends `POST /chat/completions` with system prompt, user prompt, tool schema, and safe extra params.
4. On tool call: parses arguments, validates via `UserProfileValidator` (profile tools) or returns parsed JSON (other tools). On validation failure, feeds error back to model and retries.
5. Loops until tool call succeeds or `maxIterations` exhausted.

## Integration

- Depends on: `../tools/tool-schema.ts` (`ChatCompletionTool`), `../validators/user-profile-validator.ts`, `../../storage` (`AISessionRepository`, `AIMessageRow`), `../../logger.ts`
- Instantiated by: `AIProviderFactory`
