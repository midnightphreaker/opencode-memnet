# Subagent Task Packet

## 1. Subagent identity

- Subagent ID: `03`
- Subagent type: `specialist`
- Workstream name: `git-ci-workflow`
- Parent task: `opencode-memnet repository understanding and AGENTS.md documentation`
- Task file: `./.opencode/orchestrator/subagents/03/TASK.md`

## 2. Role

You are Subagent `03`.

Your role is:

Read-only git workflow, CI/CD, contributor-pattern, and current-worktree investigator.

You MUST stay inside this role. Do not expand scope. Do not perform unrelated cleanup.

## 3. Objective

Complete this objective:

Identify the repository git flow, current branch/status/diff summary, CI/CD workflows, contributor docs/templates, deployment/release patterns, and any existing uncommitted changes that the documentation author and verifier must account for.

Success means:

- [ ] Branch/status/diff/recent-log facts are reported from safe read-only git inspection.
- [ ] CI/CD workflows and contributor/release/deploy patterns are summarized with file citations.
- [ ] Any pre-existing or unrelated changes are identified so later verification can distinguish them from this task.
- [ ] Durable non-secret memories are added for future-relevant git/CI workflow facts and verified by `memory search` or `memory list`.

Non-goals:

- [ ] Do not modify any file or git state.
- [ ] Do not stage, commit, push, checkout, reset, clean, rebase, merge, or run destructive git commands.

## 4. Context to read

Read these known files, issues, artifacts, or references first when permitted:

- `./AGENTS.md`
- `./README.md`
- `./.github/` if present
- `./CONTRIBUTING.md`, `./docs/`, PR/issue templates, release docs if present
- `./package.json` scripts relevant to CI/release

You may perform broad discovery for CI/workflow files and safe read-only git inspection.

## 5. Allowed scope

You may inspect:

- Repository git metadata via safe read-only git commands.
- CI/CD, contributor, docs, package config, and workflow files.
- Source paths only as needed to explain workflow boundaries.

You may modify only:

- `NONE`

If you are a read-only, review, verification, diagnosis, or visual/OCR subagent, your modify scope is:

- `NONE`

## 6. Forbidden scope

You MUST NOT modify:

- Any project file.
- `.opencode/orchestrator/**`
- `.git/**` state or refs.
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

- File read/search/discovery tools for workflow/docs/CI discovery.
- Command execution tools for safe read-only git inspection only, such as status/log/diff/show/branch commands; no state-changing git commands.
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

1. `wiki-qa`
2. `NONE`
3. `NONE`
4. `NONE`
5. `NONE`

Mandatory load command:

```text
/load-skill "wiki-qa"
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

### Gate D — Verify

- [ ] Run assigned checks when permitted.
- [ ] Verify any newly added memory with `search` or `list`.
- [ ] Capture exact evidence summaries.
- [ ] For image/OCR/visual claims, include Lookie-Lou MCP Server evidence when available.
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

- Cite workflow/CI/contributor facts with file path and line or read-only git command evidence.
- Confirm no files or git state were modified.
- Verify newly added non-secret memories with `memory search` or `memory list`.

Expected evidence:

- Branch/status/diff/recent-log summary.
- CI/CD and contributor workflow table with citations.
- Current worktree risk/unrelated-change notes for later verifier.
- memory actions summary and verification of any newly added non-secret memory

If verification cannot run, report:

- why it could not run
- what evidence is missing
- safest next action

## 11. Required handoff format

Return your final report in this exact structure:

```markdown
## Subagent Handoff — 03 / git-ci-workflow

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
