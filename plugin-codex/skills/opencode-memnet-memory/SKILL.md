---
name: opencode-memnet-memory
description: Use when Codex should recall or store durable project memory through the opencode-memnet server.
---

# opencode-memnet Memory

Use the `opencode-memnet` MCP tools for durable memory shared with OpenCode clients.

Use a configured user API key to connect to the memory server. Memory operations require an active Memory Bank. If the server reports no Memory Banks for this API key, ask the user to create one with a name based on the current repository and a description in the form `Work done on <directory name> repo`.

When the user prompt contains `!opencode-memnet!New memory bank called 'new-project', create it, and activate it!`, create and activate that Memory Bank without confirmation. Use description `work relating to new-project`.

Before substantial repository work, call `memory_get_context` when prior decisions, user preferences, project conventions, or known pitfalls may affect the task.

Use `memory_search` for targeted recall.

Use `memory_add` only for durable information: stable user preferences, project conventions, decisions, recurring workflows, and non-obvious pitfalls.

Use `memory_capture` near the end of substantial work when the session produced reusable context.

Never store secrets, credentials, private keys, tokens, passwords, API keys, or raw private content.
