---
name: opencode-memnet-memory
description: Use when Codex should recall or store durable project memory through the opencode-memnet server.
---

# opencode-memnet Memory

Use the `opencode-memnet` MCP tools for durable memory shared with OpenCode clients.

Before substantial repository work, call `memory_get_context` when prior decisions, user preferences, project conventions, or known pitfalls may affect the task.

Use `memory_search` for targeted recall.

Use `memory_add` only for durable information: stable user preferences, project conventions, decisions, recurring workflows, and non-obvious pitfalls.

Use `memory_capture` near the end of substantial work when the session produced reusable context.

Never store secrets, credentials, private keys, tokens, passwords, API keys, or raw private content.
