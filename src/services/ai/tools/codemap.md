# src/services/ai/tools/

## Responsibility

Defines the `ChatCompletionTool` type that describes function-calling tool schemas for AI providers.

## Design

- `tool-schema.ts`: Single interface `ChatCompletionTool` mirroring the OpenAI tool-call format — `{ type: "function", function: { name, description, parameters } }`. Parameters follow JSON Schema conventions (`type`, `properties`, `required`).

## Integration

- Consumed by: `providers/openai-chat-completion.ts` (passed as the `toolSchema` argument to `executeToolCall`)
