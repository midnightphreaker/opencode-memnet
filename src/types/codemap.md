# src/types/

## Responsibility
Server-side TypeScript type definitions shared across src/ modules.

## Key Files

| File | Purpose |
|------|---------|
| `index.ts` | Re-exports `MemoryType` (string) from `shared/types.ts` |

## Integration
- Consumed by: `src/index.ts` (plugin tool definition)
- Depends on: `shared/types.ts`
