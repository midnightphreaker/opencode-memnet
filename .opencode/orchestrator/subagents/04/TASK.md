# Subagent Task Packet

## 1. Subagent identity

- Subagent ID: `04`
- Subagent type: `documentation`
- Workstream name: `agents-md-authoring`
- Parent task: `opencode-memnet repository understanding and AGENTS.md documentation`
- Task file: `./.opencode/orchestrator/subagents/04/TASK.md`

## 2. Role

You are Subagent `04`.

Your role is:

Scoped documentation author for the root `AGENTS.md` file, using source-grounded repository evidence and prior subagent findings.

You MUST stay inside this role. Do not expand scope. Do not perform unrelated cleanup.

## 3. Objective

Complete this objective:

Replace/update `./AGENTS.md` so it becomes the exhaustive, source-grounded, single source of truth requested by the user-provided repository-understanding workflow. Include YAML frontmatter, a summary paragraph with no H1, complete architecture breakdown with multiple Mermaid diagrams, languages/frameworks/dependencies/tools with version constraints and rationale, all entry points and call chains, configuration mechanisms and options, git flow/CI/CD/contributor patterns, build/test/lint/deploy commands, gotchas/design decisions, related memory references, and markdown footnote citations to source files.

Success means:

- [ ] `AGENTS.md` is updated and is exhaustive per the user-provided requirements.
- [ ] All substantive claims are grounded in current repository files and cited with markdown footnotes.
- [ ] Multiple Mermaid diagrams cover significant architecture/call-flow/identity/deployment relationships.
- [ ] User-required exhaustiveness overrides the loaded `agents-md` skill's brevity/under-100-line guidance; report this conflict explicitly in the handoff.
- [ ] Durable non-secret memory is added summarizing the AGENTS.md update and verified by `memory search` or `memory list`.

Non-goals:

- [ ] Do not modify any file other than `./AGENTS.md`.
- [ ] Do not run tests/builds/package installs unless needed only as safe read-only validation; prefer static verification and final readback.
- [ ] Do not commit or push.

## 4. Context to read

Read these known files, issues, artifacts, or references first when permitted:

- `./AGENTS.md`
- `./README.md`
- `./package.json`
- `./bun.lock`
- `./tsconfig.json`
- `./.env.example`
- `./Dockerfile`
- `./docker-compose.yml`
- `./docker-compose.external-db.yml`
- `./.forgejo/workflows/build-push.yml`
- `./plugin/package.json`, `./plugin/tsconfig.json`, and `./plugin/src/`
- `./plugin-codex/package.json`, `./plugin-codex/README.md`, `./plugin-codex/docs/SPEC.md`, `./plugin-codex/docs/DESIGN.md`, `./plugin-codex/docs/IMPLMENTATION.md`, and `./plugin-codex/src/`
- `./src/`, `./shared/`, and representative `./tests/`
- Memory IDs and findings from prior subagents: `mem_1781931272060_34ils3dji`, `mem_1781931272751_f18gp89kf`, `mem_1781932136772_2mj1mp1tq`, `mem_1781931793014_dnv0ksn45`, `mem_1781931915303_v4c2dyips`, `mem_1781931286213_rwn6pllr8`

You may perform broad repository discovery because your assigned role requires source-grounded documentation. Do not inspect or copy secret values.

## 5. Allowed scope

You may inspect:

- All non-secret source, docs, tests, configs, package files, CI files, Docker/Compose files, and existing `AGENTS.md`.

You may modify only:

- `./AGENTS.md`

If you are a read-only, review, verification, diagnosis, or visual/OCR subagent, your modify scope is:

- Not applicable; this is a documentation-authoring subagent with write scope limited to `./AGENTS.md`.

## 6. Forbidden scope

You MUST NOT modify:

- Any file except `./AGENTS.md`.
- `.opencode/orchestrator/**`
- `.git/**`
- `README.md`, `package.json`, lockfiles, source, tests, plugin files, Docker/Compose files, CI files.
- `.env*`, credential files, private configuration, generated caches, dependency directories.
- unrelated files
- generated junk
- credentials, secrets, tokens, keys, `.env` files, or private configuration

You MUST NOT:

- use subtasks
- hide failures
- fake tests
- fake visual inspection
- weaken meaningful tests just to pass
- commit or push unless explicitly assigned and permitted

## 7. Required tools and MCP Servers

Use the following tools only when available and permitted:

- File read/search/discovery tools for current evidence gathering.
- File edit/write tools for `./AGENTS.md` only.
- Command execution tools only for safe read-only inspection if needed; do not run package installs.
- OpenCode-memNET plugin `memory` tool.
- `sequential-thinking` MCP Server for local planning.

Memory guidance:

- You MUST use the OpenCode-memNET plugin `memory` tool when available and permitted.
- During intake/startup, run `help` when mode behavior is uncertain, `profile`, `list`, and targeted `search` for the task, repo, issue, artifacts, and likely synonyms.
- Search memory during planning, before changing files, after new evidence changes understanding, before final verification, and before handoff.
- Add durable non-secret memories for decisions, repo facts, task outcomes, corrected assumptions, and reusable workflows when useful beyond this session.
- If stale knowledge is found, add corrected memory first; use `forget` only when the exact obsolete `memoryId` is known.
- Verify newly added memories with `search` or `list` before reporting them.
- Never store credentials, tokens, private keys, passwords, `.env` values, sensitive OCR text, raw private configs, or unverified claims.
- Memory informs; current files, command outputs, MCP evidence, and task evidence verify.

Archived skill guidance:

- You MUST use the `*-skill` command SKILLs: `/find-skill`, `/download-skill`, and `/load-skill`.
- Use `/find-skill` to search archived skill frontmatter when a skill may help and the exact directory name is unknown.
- Use `/download-skill` only when `/find-skill` routes to it or when the user explicitly asks to download a skill.
- Use `/load-skill` only with exact directory names returned by `/find-skill`, installed by `/download-skill`, or explicitly provided by the user.
- Do not use default, built-in, automatic, or normal skill loading.
- Do not invent a skill name.
- Report loaded skill names and any conflicts with higher-priority instructions.
- Before Gate A, run `/load-skill` for every skill listed in Section `8. Required archived skills to load`.
- If any listed skill cannot be loaded, stop and report `BLOCKED`. Do not continue without a required selected skill.

## 8. Required archived skills to load

The root Orchestrator MUST provide selected archived skills for this subagent.

Rules:

- [ ] Provide at least 1 exact archived skill directory name.
- [ ] Prefer 2 or 3 skills for most subagents.
- [ ] Provide no more than 5 skills.
- [ ] Use `NONE` only in unused optional slots.
- [ ] Do not list guessed names.
- [ ] Do not list broad skills that are unrelated to this subagent objective.
- [ ] The subagent MUST load every non-`NONE` skill below before Gate A.
- [ ] The subagent MUST run one `/load-skill` command containing all non-`NONE` names, or equivalent separate `/load-skill` commands for each selected name.

Selected skills:

1. `agents-md`
2. `wiki-qa`
3. `NONE`
4. `NONE`
5. `NONE`

Mandatory load command:

```text
/load-skill "agents-md,wiki-qa"
```

Subagent loading gate:

- [ ] Run `/load-skill` on every non-`NONE` selected skill before reading additional project context.
- [ ] Confirm each selected skill was loaded.
- [ ] Follow loaded skill instructions when relevant and when they do not conflict with higher-priority instructions.
- [ ] Report loaded skill names in the final handoff.
- [ ] If a required selected skill is missing, malformed, blocked, or conflicts with higher-priority instructions, stop and report the blocker.

MCP guidance:

- Use `sequential-thinking` MCP Server for local planning when useful.
- Use `reminders` MCP Server only for unresolved follow-up when assigned.
- Use Lookie-Lou MCP Server for image, screenshot, OCR, visual state, object location, or visible-text claims.

Do not include exact MCP call syntax in your report. Name the MCP Server, the MCP Server Tool, and the parameter types used.

## 9. Work gates

### Gate A — Intake

- [ ] Complete the Section `8` mandatory archived skill loading gate.
- [ ] Read this `TASK.md` fully.
- [ ] Restate the objective in your own words.
- [ ] Confirm allowed and forbidden scope.
- [ ] Identify risks/blockers before changing anything.
- [ ] Complete required memory startup/search actions and identify whether memory introduces corrected assumptions or stale-knowledge risks.

### Gate B — Plan

- [ ] Create a short local plan.
- [ ] Identify files to inspect.
- [ ] Identify files to modify, or confirm read-only mode.
- [ ] Identify verification checks.
- [ ] Identify memory actions needed for planning, stale correction, and final outcome capture.
- [ ] Stop and report if the scope is unsafe or unclear.

### Gate C — Execute

- [ ] Perform only assigned work.
- [ ] Keep changes minimal and reversible.
- [ ] Do not touch forbidden scope.
- [ ] Do not perform unrelated cleanup.
- [ ] In `AGENTS.md`, include all required sections from the user-provided repository-understanding workflow:
  - YAML frontmatter: `title`, `description`, `date`, `tags` with at least 2 tags.
  - Summary paragraph and no H1.
  - Complete architecture breakdown with multiple Mermaid diagrams.
  - Every language, framework, dependency, and tool with version constraints and why chosen.
  - All entry points and call chains.
  - Configuration mechanisms and every option documented from source/config evidence.
  - Git flow, CI/CD pipelines, contributor patterns.
  - Build, test, lint, deploy commands.
  - Known gotchas, constraints, and design decisions with rationale.
  - References to related memories.
  - Markdown footnote citations to source files.
  - Everything relevant in memory about this repo, verified against current evidence before inclusion.

### Gate D — Verify

- [ ] Read back the final `AGENTS.md`.
- [ ] Verify all required user sections are present.
- [ ] Verify all substantive claims are cited by markdown footnotes or otherwise clearly tied to evidence.
- [ ] Verify only `AGENTS.md` was modified by you.
- [ ] Verify any newly added memory with `search` or `list`.
- [ ] Capture exact evidence summaries.
- [ ] Distinguish pass, fail, blocked, and not-run checks.

### Gate E — Handoff

- [ ] Complete the required handoff format below.
- [ ] Include changed files.
- [ ] Include commands/checks run by description and result.
- [ ] Include MCP Server Tools used by name and parameter types, not exact invocation syntax.
- [ ] Include memory modes used, memory IDs added/corrected/forgotten when safe to report, and verification method for new memories.
- [ ] Include unresolved risks.
- [ ] State whether you stayed inside scope.

## 10. Verification required

Required verification:

- `AGENTS.md` exists and includes YAML frontmatter, summary paragraph, multiple Mermaid diagrams, exhaustive architecture/commands/config/git/dependency/call-chain/gotchas/memory-reference/citation content.
- All source-grounded claims cite current evidence with markdown footnotes.
- Only `AGENTS.md` changed.
- Newly added non-secret memory is verified with `memory search` or `memory list`.

Expected evidence:

- Changed file list.
- Brief outline of final `AGENTS.md` sections.
- Citation/footnote strategy used.
- memory actions summary and verification of any newly added non-secret memory

If verification cannot run, report:

- why it could not run
- what evidence is missing
- safest next action

## 11. Required handoff format

Return your final report in this exact structure:

```markdown
## Subagent Handoff — 04 / agents-md-authoring

- Result: PASS | FAIL | BLOCKED | PARTIAL
- Role performed:
- Objective completed:
- Files inspected:
- Files changed:
- Archived skills loaded:
- Commands/checks run:
- MCP Servers / MCP Server Tools used:
- Memory actions:
- Evidence:
- Failures or blockers:
- Risks or assumptions:
- Out-of-scope findings:
- Recommended next action:
- Stayed within allowed scope: true | false
```

## 12. Stop conditions

Stop and report immediately if:

- required context is unavailable
- a required selected archived skill from Section `8` cannot be loaded
- scope is contradictory
- permissions block the assigned work
- verification fails and you are not assigned to repair
- repair would require touching forbidden files
- secrets or sensitive data are encountered
- image/OCR evidence is required but Lookie-Lou MCP Server is unavailable and no equivalent visual-verification path is assigned

Do not claim completion when stopped or blocked.
