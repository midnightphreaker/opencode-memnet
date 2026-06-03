# shared/

## Responsibility

Provides cross-module utilities consumed by both client (`src/`) and server (`server/`): configuration loading, logging, JSONC parsing, secret resolution, privacy redaction, tag generation, and shared type definitions.

## Design

- **Pure-function utilities** with minimal coupling — each file exports standalone helpers or types
- **Singleton config** (`client-config.ts`) merges global (`~/.config/opencode`) and project-level (`.opencode/`) JSONC configs with deep-merge on nested objects
- **Logger** (`logger.ts`) writes to a rotating log file (5 MiB cap) and conditionally to stderr with ANSI colors; level resolved from env vars or explicit `initLogger()` call
- **Tag system** (`tags.ts`) derives hashed user/project identity tags from git metadata with a per-directory TTL cache (60s)
- **Secret resolver** (`secret-resolver.ts`) supports `file://` and `env://` prefixed values with Unix permission checks

## Flow

1. On init, `initClientConfig()` loads global then project JSONC files → merges → stores in `CLIENT_CONFIG` singleton → initializes logger
2. `stripJsoncComments()` strips `//`, `/* */` comments and trailing commas, respecting string boundaries
3. `resolveSecretValue()` resolves `file://`/`env://` prefixed secret references at runtime
4. `getTags()` reads git config (email, name, remote URL, repo root) → hashes identity → returns cached `TagInfo` pair
5. `stripPrivateContent()` redacts `<private>…</private>` blocks from text before storage/transmission

## Integration

- Consumed by: `src/` (client extension), `server/` (API server), and `src/hooks/` (chat/message hooks)
- Depends on: Node.js built-ins (`fs`, `path`, `os`, `crypto`, `child_process`)
