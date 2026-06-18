# plugin-codex Implementation Review Report

Result: PASS

## Status

The implementation passes local verification. A packaging mismatch found during review was fixed by copying hook config to the manifest-declared `dist/hooks/hooks.json` path. Stale nickname and `userId` requirements in the plugin spec/design docs were also updated to match the current strict profile/repository contract.

## Files Inspected

- `plugin-codex/docs/SPEC.md`
- `plugin-codex/docs/DESIGN.md`
- `plugin-codex/docs/IMPLMENTATION.md`
- `plugin-codex/package.json`
- `package.json`
- `plugin-codex/build.ts`
- `plugin-codex/.codex-plugin/plugin.json`
- `plugin-codex/hooks/hooks.json`
- `plugin-codex/README.md`
- `plugin-codex/skills/opencode-memnet-memory/SKILL.md`
- `plugin-codex/src/config.ts`
- `plugin-codex/src/identity.ts`
- `plugin-codex/src/tags.ts`
- `plugin-codex/src/privacy.ts`
- `plugin-codex/src/http-client.ts`
- `plugin-codex/src/mcp/server.ts`
- `plugin-codex/src/mcp/tools.ts`
- `plugin-codex/src/hooks/payload.ts`
- `plugin-codex/src/hooks/runner.ts`
- `plugin-codex/tests/*.test.ts`
- `tests/client-nickname.test.ts`
- `plugin-codex/dist/*` after build

## Checks Run

- `test -d "$HOME/.codex/skills" && test -d "$HOME/.codex/skills-archive" && test -d "$HOME/.codex/skills-archive/download-skill" && test -f "$HOME/.codex/skills-archive/download-skill/SKILL.md" && test -d "$HOME/.codex/skills-archive/find-skill" && test -f "$HOME/.codex/skills-archive/find-skill/SKILL.md" && test -d "$HOME/.codex/skills-archive/load-skill" && test -f "$HOME/.codex/skills-archive/load-skill/SKILL.md"`
- Loaded archived skills: `requesting-code-review`, `wiki-qa`
- `cd plugin-codex && bun run verify`
- `cd plugin-codex && bun run verify` after fixing the hook manifest path mismatch
- `find plugin-codex/dist -maxdepth 4 -type f | sort`
- `test -f plugin-codex/dist/.codex-plugin/plugin.json && test -f plugin-codex/dist/hooks/hooks.json && test -f plugin-codex/dist/hooks/runner.js && test -f plugin-codex/dist/mcp/server.js && test -f plugin-codex/dist/skills/opencode-memnet-memory/SKILL.md`
- `rg "client/nickname|setClientNickname|userId|userEmail|userName|projectPath|nickname sync" plugin-codex/docs/SPEC.md plugin-codex/docs/DESIGN.md plugin-codex/README.md plugin-codex/src plugin-codex/tests -n`
- Targeted `rg`/`sed`/`nl` inspection of implementation, tests, README, manifest, hooks, and server nickname tests

## Verification Evidence

`cd plugin-codex && bun run verify` passed:

- `bunx tsc --noEmit`
- `bun test`: 44 pass, 0 fail, 170 assertions
- `bun run build.ts`

Built files present:

- `dist/mcp/server.js`
- `dist/hooks/runner.js`
- `dist/.codex-plugin/plugin.json`
- `dist/hooks/hooks.json`
- `dist/skills/opencode-memnet-memory/SKILL.md`

## Findings

### Resolved: `dist` manifest pointed to a hook config path that was not present

Evidence:

- `plugin-codex/.codex-plugin/plugin.json:11` declares `"hooks": "./hooks/hooks.json"`.
- `plugin-codex/build.ts:14-17` builds the hook runner into `dist/hooks/runner.js`.
- `plugin-codex/build.ts` now copies hook config to `dist/hooks`, producing `dist/hooks/hooks.json`.
- After rerunning verification, both `dist/hooks/runner.js` and `dist/hooks/hooks.json` exist.

Impact: fixed.

### Resolved: `plugin-codex` docs required nickname sync, but current strict server removes nickname APIs

Evidence:

- `plugin-codex/docs/SPEC.md` and `plugin-codex/docs/DESIGN.md` now state that nickname update endpoints are unsupported by the current strict server.
- Current implementation returns a clear unsupported result in `memory_set_nickname` and makes no request.
- `plugin-codex/README.md:49` documents that `memory_set_nickname` is unsupported because the current server does not expose nickname updates.
- `tests/client-nickname.test.ts:5-16` asserts nickname identity APIs are removed from the server.

Impact: fixed.

## Passing Review Points

- Strict identity is mostly honored in plugin payloads: MCP and hook tests assert no `userId`, `userEmail`, `userName`, or `projectPath` in key request bodies.
- `repoId` is distinct from `projectTag` and is sent alongside configured `profileId` for context, add, search/list, profile, and capture paths.
- Remote URLs are sanitized for URL-style credentials in `sanitizeGitRemoteUrl`.
- Private blocks are stripped before storage and fully private content is rejected or skipped.
- Hook failures are non-blocking and return success-style results for missing config, connect failure, disabled capture, private prompts, and memory write failure.
- Bins point to built files in `plugin-codex/package.json`.
- Root `package.json` includes `build:codex-plugin`, `typecheck:codex-plugin`, `test:codex-plugin`, and `verify:codex-plugin`.

## Residual Risks

- `projectTag` intentionally remains OpenCode-compatible and can derive from local git common-dir/path. That appears intentional for compatibility, but it is separate from strict `repoId` identity.
- Non-URL SCP-style git remotes are not credential-sanitized beyond returning the trimmed string. The common credential-bearing URL form is covered by tests.
- I did not run a live Codex plugin install or connect to a real `opencode-memnet` server.

## Recommended Next Step

Run a live local install/connect smoke test when a configured `opencode-memnet` server is available.
