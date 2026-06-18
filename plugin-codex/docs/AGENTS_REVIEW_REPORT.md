# AGENTS.md Review Report

## Result

PASS. No blocking issues found.

## Scope

Reviewed:

- `AGENTS.md`
- `README.md`
- `package.json`
- `plugin/package.json`
- `plugin-codex/docs/SPEC.md`
- `plugin-codex/docs/DESIGN.md`
- `plugin-codex/docs/IMPLMENTATION.md`

## Skills Loaded

- `agents-md`
- `wiki-qa`

## Findings

1. Low: `AGENTS.md` does not list the future `plugin-codex` package verify command directly.
   - Evidence: `plugin-codex/docs/IMPLMENTATION.md:54-58` defines `verify` as `bun run typecheck && bun test && bun run build`, and `plugin-codex/docs/IMPLMENTATION.md:1182-1186` expects `cd plugin-codex && bun run verify`. `AGENTS.md:23-32` lists server, OpenCode plugin, and full repo commands, but not a `plugin-codex` command.
   - Impact: non-blocking because `AGENTS.md:7` and `AGENTS.md:11-15` require following the `plugin-codex` docs before package work.

2. Info: `AGENTS.md` correctly incorporates the main `plugin-codex` doc guardrails.
   - Evidence: `AGENTS.md:11-15` requires reading `SPEC.md`, `DESIGN.md`, and `IMPLMENTATION.md` before `plugin-codex/` work and says the current server API is the source of truth. This matches `plugin-codex/docs/SPEC.md:5-8`, `plugin-codex/docs/SPEC.md:31-38`, `plugin-codex/docs/DESIGN.md:5-17`, and `plugin-codex/docs/DESIGN.md:170-174`.

3. Info: skill guidance is present and aligned with the implementation plan.
   - Evidence: `AGENTS.md:17-21` requires the archived command-skill workflow, `agents-md` for AGENTS updates, `wiki-qa` for repo-grounded review, and either `superpowers:subagent-driven-development` or `superpowers:executing-plans` for `IMPLMENTATION.md` execution. This matches `plugin-codex/docs/IMPLMENTATION.md:3`.

4. Info: command guidance matches the existing root and OpenCode plugin packages.
   - Evidence: `package.json:11-22` defines root build/typecheck/test and plugin wrapper scripts. `plugin/package.json:15-17` defines OpenCode plugin build/typecheck. `AGENTS.md:23-32` captures those root and OpenCode plugin commands.

## Evidence

- `README.md:11-17` says normal use has a server plus local OpenCode plugin install shape and no required npm package install flow.
- `README.md:149-161` documents the strict profile and repo identity model.
- `plugin-codex/docs/SPEC.md:21-29` requires a Codex plugin package, existing server endpoint reuse, MCP tools, hooks, a bundled skill, and secret-safe behavior.
- `plugin-codex/docs/DESIGN.md:33-49` defines the planned `plugin-codex/` module and package structure.
- `plugin-codex/docs/IMPLMENTATION.md:13-31` lists the planned files for the Codex plugin implementation.
- `AGENTS.md:34-39` preserves identity, clean-start, secret-handling, and focused-test conventions.

## Recommendations

- Optional: once `plugin-codex/package.json` exists, add a `plugin-codex` verification row to `AGENTS.md`, for example `cd plugin-codex && bun run verify`.
- Keep `AGENTS.md` concise; the current file is short and appropriately delegates detailed `plugin-codex` behavior to the three docs.
