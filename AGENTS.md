# Agent Instructions

## Package Manager
- Use **Bun**.
- Server install/test/build from repo root.
- OpenCode plugin commands run through root scripts or from `plugin/`.
- Codex plugin work lives under `plugin-codex/`; follow its docs before creating package files.

## Required Reading
- Before broad repo work, read `README.md` and the relevant source/test files.
- Before `plugin-codex/` work, read in order:
  - `plugin-codex/docs/SPEC.md`
  - `plugin-codex/docs/DESIGN.md`
  - `plugin-codex/docs/IMPLMENTATION.md`
- Treat the current server API as source of truth; first `plugin-codex` version must avoid server changes unless the docs prove a hard client-side gap.

## Required Skills
- Use the archived command-skill workflow from the active agent instructions: `find-skill`, `download-skill`, then `load-skill`.
- For `plugin-codex/docs/IMPLMENTATION.md` execution, load and follow either `superpowers:subagent-driven-development` or `superpowers:executing-plans` as required by that plan.
- For AGENTS.md updates, use `agents-md`.
- For repo-grounded review/reporting, use `wiki-qa` or a more specific exact archived skill found by `find-skill`.

## File-Scoped Commands
| Task | Command |
| --- | --- |
| Server typecheck | `bun run typecheck` |
| Server tests | `bun run test` |
| Server build | `bun run build` |
| OpenCode plugin typecheck | `bun run typecheck:plugin` |
| OpenCode plugin build | `bun run build:plugin` |
| Full typecheck | `bun run typecheck:all` |
| Full build | `bun run build:all` |

## Key Conventions
- Keep profile identity keyed by `profile_id`; keep git repository identity keyed by normalized repo URL and `repo_id`.
- Local paths, display names, git user names, emails, and nicknames are metadata only.
- Preserve the strict clean-start model; do not add compatibility shims for removed user-email, nickname-endpoint, or path-keyed identity flows.
- Do not print or store API keys, database URLs, `.env` values, bearer tokens, or private memory payloads.
- Use tests near existing coverage patterns in `tests/`; prefer focused tests before full-suite checks.

## Commit Attribution
AI commits MUST include:
```text
Co-Authored-By: (the agent model's name and attribution byline)
```
