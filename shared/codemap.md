# shared/

## Responsibility
Code shared between the server (src/) and the plugin client (plugin/). These modules are imported by both packages and must not depend on server-only or plugin-only modules.

## Key Files

| File | Purpose |
|------|---------|
| `types.ts` | `MemoryType` (string), `MemoryMetadata` interface, `AIProviderType` enum |
| `tags.ts` | Git-based tag generation: user/project identity → SHA256 hashes. `getTags(directory, config)` with per-directory caching. Stateless version that accepts `TagsConfig`. |
| `logger.ts` | Leveled file+console logger with rotation. `logDebug/info/warn/error()`. Level resolved from `LOG_LEVEL`/`DEBUG` env vars. Global singleton via Symbol keys. |
| `client-config.ts` | Client-only config loading: `serverUrl`, `apiKey`, chat message settings, memory scope. Loads from `~/.config/opencode/opencode-memnet.jsonc` and `.opencode/opencode-memnet.jsonc`. |
| `privacy.ts` | `stripPrivateContent()` and `isFullyPrivate()` — removes `<private>` blocks |
| `jsonc.ts` | JSONC parser stripping `//`, `/* */` comments and trailing commas |
| `secret-resolver.ts` | Resolves `file://`, `env://`, and literal values. Checks file permissions on Unix. |

## Design Notes
- `src/services/` contains duplicates of `logger.ts`, `jsonc.ts`, `secret-resolver.ts`, `privacy.ts` because the server Docker build compiles only `src/` and does not include `shared/` in the runtime image
- `plugin/` imports directly from `shared/` (e.g., `../../shared/logger.js`) as the plugin build bundles these files
- `tags.ts` in `shared/` is the parameterized version (accepts `TagsConfig`), while `src/services/tags.ts` reads from the global `CONFIG`

## Integration
- Consumed by: `plugin/src/` (all plugin files), `src/config.ts` (imports `jsonc.ts`, `secret-resolver.ts`)
