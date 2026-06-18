#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "../config";
import { getClientId } from "../identity";
import { createToolHandlers } from "./tools";

const cwd = process.cwd();
const config = loadConfig(cwd);
const clientId = getClientId();
const handlers = createToolHandlers({ cwd, config, clientId });

const server = new McpServer(
  {
    name: "opencode-memnet",
    version: "0.1.0",
  },
  {
    instructions:
      "Use opencode-memnet memory tools to recall durable project context, user preferences, prior decisions, and workflows. Never store secrets. Call memory_get_context before work where prior context may matter, and call memory_capture near the end of substantial work.",
  },
);

function text(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

server.tool("memory_connect", { nickname: z.string().optional() }, async (args) =>
  text(await handlers.memory_connect(args)),
);
server.tool(
  "memory_get_context",
  { sessionID: z.string().optional(), maxMemories: z.number().optional() },
  async (args) => text(await handlers.memory_get_context(args)),
);
server.tool(
  "memory_add",
  { content: z.string(), type: z.string().optional(), tags: z.array(z.string()).optional() },
  async (args) => text(await handlers.memory_add(args)),
);
server.tool("memory_search", { query: z.string(), limit: z.number().optional() }, async (args) =>
  text(await handlers.memory_search(args)),
);
server.tool("memory_list", { limit: z.number().optional() }, async (args) =>
  text(await handlers.memory_list(args)),
);
server.tool("memory_forget", { memoryId: z.string() }, async (args) =>
  text(await handlers.memory_forget(args)),
);
server.tool("memory_profile", {}, async () => text(await handlers.memory_profile()));
server.tool("memory_stats", {}, async () => text(await handlers.memory_stats()));
server.tool("memory_set_nickname", { nickname: z.string() }, async (args) =>
  text(await handlers.memory_set_nickname(args)),
);
server.tool(
  "memory_capture",
  {
    summary: z.string().optional(),
    sessionID: z.string().optional(),
    conversationMessages: z.array(z.unknown()).optional(),
    userPrompt: z.string().optional(),
    promptMessageId: z.string().optional(),
  },
  async (args) => text(await handlers.memory_capture(args)),
);

await server.connect(new StdioServerTransport());
