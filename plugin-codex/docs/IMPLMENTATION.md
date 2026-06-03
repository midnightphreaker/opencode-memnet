# Codex Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `plugin-codex`, a Codex CLI plugin bundle that connects Codex to the existing `opencode-memnet` server through MCP tools, command hooks, client identity, nickname sync, and memory operations.

**Architecture:** Implement a standalone TypeScript/Bun package under `plugin-codex/`. The package exposes a stdio MCP server for Codex tools, hook scripts for lifecycle capture, a bundled Codex skill for usage guidance, and a small HTTP client that calls the existing server endpoints without changing server code.

**Tech Stack:** TypeScript, Bun, `@modelcontextprotocol/sdk`, Node built-ins, existing `opencode-memnet` HTTP API, Codex plugin manifest, Codex hooks.

---

## File Structure

- Create: `plugin-codex/package.json` for package scripts, dependencies, and bin entries.
- Create: `plugin-codex/tsconfig.json` for TypeScript compilation.
- Create: `plugin-codex/build.ts` for Bun bundling into `dist/`.
- Create: `plugin-codex/.codex-plugin/plugin.json` for Codex plugin metadata.
- Create: `plugin-codex/hooks/hooks.json` for bundled Codex command hooks.
- Create: `plugin-codex/skills/opencode-memnet-memory/SKILL.md` for Codex usage guidance.
- Create: `plugin-codex/src/config.ts` for config loading.
- Create: `plugin-codex/src/jsonc.ts` for JSONC parsing.
- Create: `plugin-codex/src/privacy.ts` for private block stripping.
- Create: `plugin-codex/src/identity.ts` for Codex client ID and metadata.
- Create: `plugin-codex/src/tags.ts` for project/user tag derivation.
- Create: `plugin-codex/src/http-client.ts` for server API calls.
- Create: `plugin-codex/src/mcp/server.ts` for the MCP stdio entrypoint.
- Create: `plugin-codex/src/mcp/tools.ts` for MCP tool registration and handlers.
- Create: `plugin-codex/src/hooks/runner.ts` for hook command dispatch.
- Create: `plugin-codex/src/hooks/payload.ts` for hook stdin parsing.
- Create: `plugin-codex/tests/*.test.ts` for unit and contract coverage.

### Task 1: Package Scaffold

**Files:**
- Create: `plugin-codex/package.json`
- Create: `plugin-codex/tsconfig.json`
- Create: `plugin-codex/build.ts`

- [ ] **Step 1: Write package metadata**

Create `plugin-codex/package.json`:

```json
{
  "name": "opencode-memnet-codex-plugin",
  "version": "0.1.0",
  "description": "Codex CLI plugin bundle for opencode-memnet",
  "type": "module",
  "bin": {
    "opencode-memnet-codex-mcp": "./dist/mcp/server.js",
    "opencode-memnet-codex-hook": "./dist/hooks/runner.js"
  },
  "scripts": {
    "build": "bun run build.ts",
    "typecheck": "bunx tsc --noEmit",
    "test": "bun test",
    "verify": "bun run typecheck && bun test && bun run build"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.26.0"
  },
  "devDependencies": {
    "@types/bun": "^1.3.8",
    "typescript": "^5.7.3"
  },
  "files": [
    "dist",
    ".codex-plugin",
    "hooks",
    "skills",
    "package.json"
  ],
  "license": "MIT"
}
```

- [ ] **Step 2: Add TypeScript config**

Create `plugin-codex/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "types": ["bun-types"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "build.ts"]
}
```

- [ ] **Step 3: Add build script**

Create `plugin-codex/build.ts`:

```ts
import { mkdir, cp } from "node:fs/promises";

await mkdir("dist/mcp", { recursive: true });
await mkdir("dist/hooks", { recursive: true });

const mcp = await Bun.build({
  entrypoints: ["src/mcp/server.ts"],
  outdir: "dist/mcp",
  target: "node",
  format: "esm",
});

const hook = await Bun.build({
  entrypoints: ["src/hooks/runner.ts"],
  outdir: "dist/hooks",
  target: "node",
  format: "esm",
});

if (!mcp.success || !hook.success) {
  for (const log of [...mcp.logs, ...hook.logs]) console.error(log);
  process.exit(1);
}

await cp(".codex-plugin", "dist/.codex-plugin", { recursive: true });
await cp("hooks", "dist/hooks-config", { recursive: true });
await cp("skills", "dist/skills", { recursive: true });
```

- [ ] **Step 4: Verify scaffold**

Run: `cd plugin-codex && bun install && bun run typecheck`

Expected: TypeScript reports no source files or no errors after source files exist. If `bun install` changes `bun.lock` at repo root, include it in the scaffold commit.

- [ ] **Step 5: Commit scaffold**

```bash
git add plugin-codex/package.json plugin-codex/tsconfig.json plugin-codex/build.ts bun.lock
git commit -m "feat(codex): scaffold codex plugin package"
```

### Task 2: Config, JSONC, Privacy, Identity, And Tags

**Files:**
- Create: `plugin-codex/src/jsonc.ts`
- Create: `plugin-codex/src/config.ts`
- Create: `plugin-codex/src/privacy.ts`
- Create: `plugin-codex/src/identity.ts`
- Create: `plugin-codex/src/tags.ts`
- Test: `plugin-codex/tests/config.test.ts`
- Test: `plugin-codex/tests/privacy.test.ts`
- Test: `plugin-codex/tests/identity.test.ts`

- [ ] **Step 1: Write failing config and privacy tests**

Create `plugin-codex/tests/config.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { mergeConfig, type CodexMemnetConfig } from "../src/config";

describe("mergeConfig", () => {
  test("project config overrides user config and env fills missing values", () => {
    const user: Partial<CodexMemnetConfig> = {
      serverUrl: "http://user.example",
      apiKey: "user-key",
      context: { maxMemories: 3 },
    };
    const project: Partial<CodexMemnetConfig> = {
      serverUrl: "http://project.example",
      nickname: "Codex Workstation",
    };
    const env = {
      OPENCODE_MEMNET_API_KEY: "env-key",
      OPENCODE_MEMNET_NICKNAME: "Env Name",
    };

    const result = mergeConfig(user, project, env);

    expect(result.serverUrl).toBe("http://project.example");
    expect(result.apiKey).toBe("user-key");
    expect(result.nickname).toBe("Codex Workstation");
    expect(result.context.maxMemories).toBe(3);
    expect(result.context.excludeCurrentSession).toBe(true);
  });
});
```

Create `plugin-codex/tests/privacy.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { isFullyPrivate, stripPrivateContent } from "../src/privacy";

describe("privacy", () => {
  test("strips private blocks", () => {
    expect(stripPrivateContent("keep <private>secret</private> done")).toBe("keep  done");
  });

  test("detects fully private content", () => {
    expect(isFullyPrivate("<private>secret</private>")).toBe(true);
    expect(isFullyPrivate("visible <private>secret</private>")).toBe(false);
  });
});
```

Create `plugin-codex/tests/identity.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { buildClientMetadata } from "../src/identity";

describe("buildClientMetadata", () => {
  test("marks metadata as Codex client metadata", () => {
    const metadata = buildClientMetadata("/repo/project");
    expect(metadata.client).toBe("codex");
    expect(metadata.runtime).toBe("codex-cli");
    expect(metadata.cwd).toBe("/repo/project");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd plugin-codex && bun test tests/config.test.ts tests/privacy.test.ts tests/identity.test.ts`

Expected: FAIL because `src/config.ts`, `src/privacy.ts`, and `src/identity.ts` do not exist.

- [ ] **Step 3: Implement JSONC parser**

Create `plugin-codex/src/jsonc.ts`:

```ts
export function stripJsonc(input: string): string {
  let output = "";
  let inString = false;
  let stringQuote = "";
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const next = input[i + 1];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === stringQuote) {
        inString = false;
        stringQuote = "";
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      inString = true;
      stringQuote = char;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      while (i < input.length && input[i] !== "\n") i++;
      output += "\n";
      continue;
    }

    if (char === "/" && next === "*") {
      i += 2;
      while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) i++;
      i++;
      continue;
    }

    output += char;
  }

  return output.replace(/,\s*([}\]])/g, "$1");
}

export function parseJsonc<T>(input: string): T {
  return JSON.parse(stripJsonc(input)) as T;
}
```

- [ ] **Step 4: Implement config**

Create `plugin-codex/src/config.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parseJsonc } from "./jsonc";

export interface CodexMemnetConfig {
  serverUrl: string;
  apiKey: string;
  nickname?: string;
  timeoutMs: number;
  memory: { defaultScope: "project" | "all-projects" };
  context: {
    maxMemories: number;
    maxAgeDays: number | null;
    excludeCurrentSession: boolean;
  };
  capture: {
    enabled: boolean;
    includeRawHookPayload: boolean;
  };
}

const DEFAULT_CONFIG: CodexMemnetConfig = {
  serverUrl: "",
  apiKey: "",
  timeoutMs: 30000,
  memory: { defaultScope: "project" },
  context: {
    maxMemories: 5,
    maxAgeDays: null,
    excludeCurrentSession: true,
  },
  capture: {
    enabled: true,
    includeRawHookPayload: false,
  },
};

function deepMerge<T extends Record<string, any>>(base: T, override: Partial<T>): T {
  const result: Record<string, any> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = deepMerge(result[key] ?? {}, value as Record<string, any>);
    } else if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as T;
}

export function mergeConfig(
  user: Partial<CodexMemnetConfig>,
  project: Partial<CodexMemnetConfig>,
  env: Record<string, string | undefined> = process.env
): CodexMemnetConfig {
  const merged = deepMerge(deepMerge(DEFAULT_CONFIG, user), project);
  if (!merged.serverUrl && env.OPENCODE_MEMNET_SERVER_URL) {
    merged.serverUrl = env.OPENCODE_MEMNET_SERVER_URL;
  }
  if (!merged.apiKey && env.OPENCODE_MEMNET_API_KEY) {
    merged.apiKey = env.OPENCODE_MEMNET_API_KEY;
  }
  if (!merged.nickname && env.OPENCODE_MEMNET_NICKNAME) {
    merged.nickname = env.OPENCODE_MEMNET_NICKNAME;
  }
  return merged;
}

function readConfigFile(path: string): Partial<CodexMemnetConfig> {
  if (!existsSync(path)) return {};
  return parseJsonc<Partial<CodexMemnetConfig>>(readFileSync(path, "utf8"));
}

export function loadConfig(cwd = process.cwd()): CodexMemnetConfig {
  const userPath = join(homedir(), ".config", "codex", "opencode-memnet.jsonc");
  const projectPath = join(cwd, ".codex", "opencode-memnet.jsonc");
  return mergeConfig(readConfigFile(userPath), readConfigFile(projectPath));
}

export function assertConfigured(config: CodexMemnetConfig): void {
  if (!config.serverUrl) throw new Error("Missing serverUrl");
  if (!config.apiKey) throw new Error("Missing apiKey");
}
```

- [ ] **Step 5: Implement privacy**

Create `plugin-codex/src/privacy.ts`:

```ts
const PRIVATE_BLOCK = /<private>[\s\S]*?<\/private>/gi;

export function stripPrivateContent(content: string): string {
  return content.replace(PRIVATE_BLOCK, "");
}

export function isFullyPrivate(content: string): boolean {
  return stripPrivateContent(content).trim().length === 0 && PRIVATE_BLOCK.test(content);
}
```

- [ ] **Step 6: Implement identity and tags**

Create `plugin-codex/src/identity.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { homedir, hostname, platform } from "node:os";

const CLIENT_ID_FILE = join(homedir(), ".config", "codex", "opencode-memnet-client-id");

export function getClientId(): string {
  if (existsSync(CLIENT_ID_FILE)) {
    const value = readFileSync(CLIENT_ID_FILE, "utf8").trim();
    if (value.length === 36) return value;
  }

  const id = randomUUID();
  mkdirSync(join(homedir(), ".config", "codex"), { recursive: true });
  writeFileSync(CLIENT_ID_FILE, id, "utf8");
  return id;
}

export function buildClientMetadata(cwd = process.cwd()): Record<string, unknown> {
  return {
    client: "codex",
    runtime: "codex-cli",
    hostname: hostname(),
    platform: platform(),
    cwd,
  };
}
```

Create `plugin-codex/src/tags.ts`:

```ts
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { basename } from "node:path";

export interface TagInfo {
  projectTag: string;
  userId?: string;
  metadata: Record<string, unknown>;
}

function git(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function getTags(cwd = process.cwd()): TagInfo {
  const repoRoot = git(cwd, ["rev-parse", "--show-toplevel"]) ?? cwd;
  const gitRepoUrl = git(cwd, ["config", "--get", "remote.origin.url"]);
  const userEmail = git(cwd, ["config", "--get", "user.email"]);
  const userName = git(cwd, ["config", "--get", "user.name"]);
  const projectName = basename(repoRoot);
  const projectHash = hash(gitRepoUrl || repoRoot);

  return {
    projectTag: `opencode_project_${projectHash}`,
    userId: userEmail,
    metadata: {
      displayName: projectName,
      userName,
      userEmail,
      projectPath: repoRoot,
      projectName,
      gitRepoUrl,
    },
  };
}
```

- [ ] **Step 7: Run tests**

Run: `cd plugin-codex && bun test tests/config.test.ts tests/privacy.test.ts tests/identity.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit config and identity**

```bash
git add plugin-codex/src plugin-codex/tests
git commit -m "feat(codex): add config identity privacy and tags"
```

### Task 3: HTTP Client

**Files:**
- Create: `plugin-codex/src/http-client.ts`
- Test: `plugin-codex/tests/http-client.test.ts`

- [ ] **Step 1: Write failing HTTP client tests**

Create `plugin-codex/tests/http-client.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { RemoteMemoryClient } from "../src/http-client";

describe("RemoteMemoryClient", () => {
  test("sends auth and client headers", async () => {
    const requests: Request[] = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return Response.json({ success: true, data: { firstTime: true, nickname: null, welcomeBack: false, daysSinceLastSeen: null, stats: null } });
    };

    const client = new RemoteMemoryClient({
      baseUrl: "http://server.test/",
      apiKey: "secret",
      clientId: "client-123",
      fetcher,
    });

    await client.clientConnect({ client: "codex" });
    expect(requests[0].headers.get("Authorization")).toBe("Bearer secret");
    expect(requests[0].headers.get("X-Client-ID")).toBe("client-123");
    expect(new URL(requests[0].url).pathname).toBe("/api/client/connect");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `cd plugin-codex && bun test tests/http-client.test.ts`

Expected: FAIL because `src/http-client.ts` does not exist.

- [ ] **Step 3: Implement HTTP client**

Create `plugin-codex/src/http-client.ts`:

```ts
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface RemoteMemoryClientOptions {
  baseUrl: string;
  apiKey: string;
  clientId: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}

export class RemoteMemoryClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly clientId: string;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;

  constructor(options: RemoteMemoryClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.clientId = options.clientId;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.fetcher = options.fetcher ?? fetch;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | undefined>
  ): Promise<ApiResponse<T>> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, value);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "X-Client-ID": this.clientId,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      const json = (await response.json()) as ApiResponse<T>;
      if (!response.ok) return { success: false, error: json.error ?? `HTTP ${response.status}` };
      return json;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timeout);
    }
  }

  clientConnect(metadata: Record<string, unknown>) {
    return this.request("POST", "/api/client/connect", { clientId: this.clientId, metadata });
  }

  setClientNickname(nickname: string) {
    return this.request<{ nickname: string }>("PUT", "/api/client/nickname", { clientId: this.clientId, nickname });
  }

  getClientStats() {
    return this.request("GET", "/api/client/stats", undefined, { clientId: this.clientId });
  }

  getContext(params: Record<string, unknown>) {
    return this.request("POST", "/api/context/inject", params);
  }

  addMemory(body: Record<string, unknown>) {
    return this.request<{ id: string }>("POST", "/api/memories", body);
  }

  deleteMemory(memoryId: string) {
    return this.request("DELETE", `/api/memories/${encodeURIComponent(memoryId)}`);
  }

  listMemories(tag: string, pageSize: number) {
    return this.request("GET", "/api/memories", undefined, { tag, pageSize: String(pageSize) });
  }

  searchMemories(q: string, tag: string, pageSize: number) {
    return this.request("GET", "/api/search", undefined, { q, tag, pageSize: String(pageSize) });
  }

  getUserProfile(userId?: string) {
    return this.request("GET", "/api/user-profile", undefined, userId ? { userId } : undefined);
  }

  autoCapture(body: Record<string, unknown>) {
    return this.request("POST", "/api/auto-capture", body);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd plugin-codex && bun test tests/http-client.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit HTTP client**

```bash
git add plugin-codex/src/http-client.ts plugin-codex/tests/http-client.test.ts
git commit -m "feat(codex): add remote memory HTTP client"
```

### Task 4: MCP Tools And Server

**Files:**
- Create: `plugin-codex/src/mcp/tools.ts`
- Create: `plugin-codex/src/mcp/server.ts`
- Test: `plugin-codex/tests/mcp-tools.test.ts`

- [ ] **Step 1: Write failing tool handler test**

Create `plugin-codex/tests/mcp-tools.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createToolHandlers } from "../src/mcp/tools";

describe("memory_add", () => {
  test("rejects fully private content", async () => {
    const handlers = createToolHandlers({
      cwd: "/repo",
      config: {
        serverUrl: "http://server.test",
        apiKey: "key",
        timeoutMs: 30000,
        memory: { defaultScope: "project" },
        context: { maxMemories: 5, maxAgeDays: null, excludeCurrentSession: true },
        capture: { enabled: true, includeRawHookPayload: false },
      },
      clientId: "client-123",
      fetcher: async () => Response.json({ success: true }),
    });

    const result = await handlers.memory_add({ content: "<private>secret</private>" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Private content blocked");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `cd plugin-codex && bun test tests/mcp-tools.test.ts`

Expected: FAIL because MCP tool handlers do not exist.

- [ ] **Step 3: Implement tool handlers**

Create `plugin-codex/src/mcp/tools.ts`:

```ts
import { RemoteMemoryClient } from "../http-client";
import type { CodexMemnetConfig } from "../config";
import { stripPrivateContent, isFullyPrivate } from "../privacy";
import { getTags } from "../tags";
import { buildClientMetadata } from "../identity";

interface HandlerContext {
  cwd: string;
  config: CodexMemnetConfig;
  clientId: string;
  fetcher?: typeof fetch;
}

function client(ctx: HandlerContext): RemoteMemoryClient {
  return new RemoteMemoryClient({
    baseUrl: ctx.config.serverUrl,
    apiKey: ctx.config.apiKey,
    clientId: ctx.clientId,
    timeoutMs: ctx.config.timeoutMs,
    fetcher: ctx.fetcher,
  });
}

export function createToolHandlers(ctx: HandlerContext) {
  return {
    async memory_connect(args: { nickname?: string } = {}) {
      const http = client(ctx);
      const connect = await http.clientConnect(buildClientMetadata(ctx.cwd));
      const nickname = args.nickname ?? ctx.config.nickname;
      if (connect.success && nickname) await http.setClientNickname(nickname);
      return connect;
    },

    async memory_get_context(args: { query?: string; sessionID?: string; maxMemories?: number } = {}) {
      const tags = getTags(ctx.cwd);
      return client(ctx).getContext({
        sessionID: args.sessionID,
        projectTag: tags.projectTag,
        userId: tags.userId,
        maxMemories: args.maxMemories ?? ctx.config.context.maxMemories,
        excludeCurrentSession: ctx.config.context.excludeCurrentSession,
        maxAgeDays: ctx.config.context.maxAgeDays,
      });
    },

    async memory_add(args: { content?: string; type?: string; tags?: string[] }) {
      if (!args.content || !args.content.trim()) return { success: false, error: "content required" };
      if (isFullyPrivate(args.content)) return { success: false, error: "Private content blocked" };
      const tags = getTags(ctx.cwd);
      return client(ctx).addMemory({
        content: stripPrivateContent(args.content),
        containerTag: tags.projectTag,
        type: args.type,
        tags: args.tags,
        ...tags.metadata,
      });
    },

    async memory_search(args: { query?: string; limit?: number }) {
      if (!args.query || !args.query.trim()) return { success: false, error: "query required" };
      const tags = getTags(ctx.cwd);
      return client(ctx).searchMemories(args.query, tags.projectTag, args.limit ?? 20);
    },

    async memory_list(args: { limit?: number } = {}) {
      const tags = getTags(ctx.cwd);
      return client(ctx).listMemories(tags.projectTag, args.limit ?? 20);
    },

    async memory_forget(args: { memoryId?: string }) {
      if (!args.memoryId) return { success: false, error: "memoryId required" };
      return client(ctx).deleteMemory(args.memoryId);
    },

    async memory_profile() {
      const tags = getTags(ctx.cwd);
      return client(ctx).getUserProfile(tags.userId);
    },

    async memory_stats() {
      return client(ctx).getClientStats();
    },

    async memory_set_nickname(args: { nickname?: string }) {
      if (!args.nickname || !args.nickname.trim()) return { success: false, error: "nickname required" };
      return client(ctx).setClientNickname(args.nickname.trim());
    },

    async memory_capture(args: { summary?: string; sessionID?: string }) {
      if (!args.summary || !args.summary.trim()) return { success: false, error: "summary required" };
      const tags = getTags(ctx.cwd);
      return client(ctx).addMemory({
        content: stripPrivateContent(args.summary),
        containerTag: tags.projectTag,
        type: "codex-session",
        source: "codex-mcp",
        sessionID: args.sessionID,
        ...tags.metadata,
      });
    },
  };
}
```

- [ ] **Step 4: Implement MCP server**

Create `plugin-codex/src/mcp/server.ts`:

```ts
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

const server = new McpServer({
  name: "opencode-memnet",
  version: "0.1.0",
  instructions:
    "Use opencode-memnet memory tools to recall durable project context, user preferences, prior decisions, and workflows. Never store secrets. Call memory_get_context before work where prior context may matter, and call memory_capture near the end of substantial work.",
});

function text(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

server.tool("memory_connect", { nickname: z.string().optional() }, async (args) => text(await handlers.memory_connect(args)));
server.tool("memory_get_context", { query: z.string().optional(), sessionID: z.string().optional(), maxMemories: z.number().optional() }, async (args) => text(await handlers.memory_get_context(args)));
server.tool("memory_add", { content: z.string(), type: z.string().optional(), tags: z.array(z.string()).optional() }, async (args) => text(await handlers.memory_add(args)));
server.tool("memory_search", { query: z.string(), limit: z.number().optional() }, async (args) => text(await handlers.memory_search(args)));
server.tool("memory_list", { limit: z.number().optional() }, async (args) => text(await handlers.memory_list(args)));
server.tool("memory_forget", { memoryId: z.string() }, async (args) => text(await handlers.memory_forget(args)));
server.tool("memory_profile", {}, async () => text(await handlers.memory_profile()));
server.tool("memory_stats", {}, async () => text(await handlers.memory_stats()));
server.tool("memory_set_nickname", { nickname: z.string() }, async (args) => text(await handlers.memory_set_nickname(args)));
server.tool("memory_capture", { summary: z.string(), sessionID: z.string().optional() }, async (args) => text(await handlers.memory_capture(args)));

await server.connect(new StdioServerTransport());
```

- [ ] **Step 5: Run tests and typecheck**

Run: `cd plugin-codex && bun test tests/mcp-tools.test.ts && bun run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit MCP server**

```bash
git add plugin-codex/src/mcp plugin-codex/tests/mcp-tools.test.ts
git commit -m "feat(codex): expose memory MCP tools"
```

### Task 5: Hook Runner

**Files:**
- Create: `plugin-codex/src/hooks/payload.ts`
- Create: `plugin-codex/src/hooks/runner.ts`
- Test: `plugin-codex/tests/hooks.test.ts`

- [ ] **Step 1: Write failing hook payload test**

Create `plugin-codex/tests/hooks.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { parseHookPayload } from "../src/hooks/payload";

describe("parseHookPayload", () => {
  test("tolerates empty stdin", () => {
    expect(parseHookPayload("")).toEqual({});
  });

  test("extracts prompt and session id from common shapes", () => {
    const payload = parseHookPayload(JSON.stringify({ session_id: "s1", prompt: "hello" }));
    expect(payload.sessionID).toBe("s1");
    expect(payload.prompt).toBe("hello");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `cd plugin-codex && bun test tests/hooks.test.ts`

Expected: FAIL because hook parser does not exist.

- [ ] **Step 3: Implement hook payload parser**

Create `plugin-codex/src/hooks/payload.ts`:

```ts
export interface ParsedHookPayload {
  event?: string;
  sessionID?: string;
  prompt?: string;
  cwd?: string;
  raw?: Record<string, unknown>;
}

export function parseHookPayload(input: string): ParsedHookPayload {
  if (!input.trim()) return {};
  try {
    const raw = JSON.parse(input) as Record<string, any>;
    return {
      event: raw.event ?? raw.hook_event ?? raw.type,
      sessionID: raw.sessionID ?? raw.session_id ?? raw.session?.id,
      prompt: raw.prompt ?? raw.user_prompt ?? raw.input,
      cwd: raw.cwd ?? raw.working_directory,
      raw,
    };
  } catch {
    return {};
  }
}
```

- [ ] **Step 4: Implement hook runner**

Create `plugin-codex/src/hooks/runner.ts`:

```ts
#!/usr/bin/env node
import { loadConfig } from "../config";
import { getClientId, buildClientMetadata } from "../identity";
import { RemoteMemoryClient } from "../http-client";
import { getTags } from "../tags";
import { isFullyPrivate, stripPrivateContent } from "../privacy";
import { parseHookPayload } from "./payload";

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const input = await readStdin();
  const payload = parseHookPayload(input);
  const cwd = payload.cwd ?? process.cwd();
  const config = loadConfig(cwd);
  if (!config.serverUrl || !config.apiKey) return;

  const clientId = getClientId();
  const client = new RemoteMemoryClient({
    baseUrl: config.serverUrl,
    apiKey: config.apiKey,
    clientId,
    timeoutMs: config.timeoutMs,
  });

  await client.clientConnect(buildClientMetadata(cwd));
  if (config.nickname) await client.setClientNickname(config.nickname);

  if (!config.capture.enabled || !payload.prompt || isFullyPrivate(payload.prompt)) return;

  const tags = getTags(cwd);
  await client.addMemory({
    content: stripPrivateContent(payload.prompt),
    containerTag: tags.projectTag,
    type: "codex-hook",
    source: "codex-hook",
    hookEvent: payload.event,
    sessionID: payload.sessionID,
    ...tags.metadata,
  });
}

main().catch((error) => {
  console.error(`[opencode-memnet-codex-hook] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(0);
});
```

- [ ] **Step 5: Run hook tests**

Run: `cd plugin-codex && bun test tests/hooks.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit hooks**

```bash
git add plugin-codex/src/hooks plugin-codex/tests/hooks.test.ts
git commit -m "feat(codex): add memory hook runner"
```

### Task 6: Codex Plugin Manifest, Hooks Config, And Skill

**Files:**
- Create: `plugin-codex/.codex-plugin/plugin.json`
- Create: `plugin-codex/hooks/hooks.json`
- Create: `plugin-codex/skills/opencode-memnet-memory/SKILL.md`

- [ ] **Step 1: Add plugin manifest**

Create `plugin-codex/.codex-plugin/plugin.json`:

```json
{
  "name": "opencode-memnet-codex",
  "version": "0.1.0",
  "description": "Codex CLI integration for opencode-memnet persistent memory",
  "skills": "./skills/",
  "mcp_servers": {
    "opencode-memnet": {
      "command": "opencode-memnet-codex-mcp"
    }
  },
  "hooks": "./hooks/hooks.json"
}
```

- [ ] **Step 2: Add bundled hooks**

Create `plugin-codex/hooks/hooks.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "opencode-memnet-codex-hook",
            "timeout": 30,
            "statusMessage": "Connecting opencode-memnet"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "opencode-memnet-codex-hook",
            "timeout": 30,
            "statusMessage": "Checking opencode-memnet memory"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "opencode-memnet-codex-hook",
            "timeout": 30,
            "statusMessage": "Saving opencode-memnet memory"
          }
        ]
      }
    ],
    "PostCompact": [
      {
        "matcher": "manual|auto",
        "hooks": [
          {
            "type": "command",
            "command": "opencode-memnet-codex-hook",
            "timeout": 30,
            "statusMessage": "Restoring opencode-memnet context"
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 3: Add memory skill**

Create `plugin-codex/skills/opencode-memnet-memory/SKILL.md`:

```md
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

Never store secrets, credentials, private keys, tokens, or raw private content.
```

- [ ] **Step 4: Commit Codex plugin metadata**

```bash
git add plugin-codex/.codex-plugin/plugin.json plugin-codex/hooks/hooks.json plugin-codex/skills/opencode-memnet-memory/SKILL.md
git commit -m "feat(codex): add codex plugin metadata"
```

### Task 7: Build, Verification, And Local Install Docs

**Files:**
- Create: `plugin-codex/README.md`
- Modify: `plugin-codex/package.json`

- [ ] **Step 1: Add README**

Create `plugin-codex/README.md`:

```md
# opencode-memnet Codex Plugin

Codex CLI integration for the existing opencode-memnet server.

## Configuration

Create `~/.config/codex/opencode-memnet.jsonc`:

```jsonc
{
  "serverUrl": "http://localhost:4747",
  "apiKey": "your-server-api-key",
  "nickname": "codex"
}
```

Project-level config may be placed at `.codex/opencode-memnet.jsonc`.

## Development

```bash
bun install
bun run verify
```

## Direct MCP Setup

```toml
[mcp_servers.opencode-memnet]
command = "opencode-memnet-codex-mcp"
startup_timeout_sec = 10
tool_timeout_sec = 60
```

## Tools

- `memory_connect`
- `memory_get_context`
- `memory_add`
- `memory_search`
- `memory_list`
- `memory_forget`
- `memory_profile`
- `memory_stats`
- `memory_set_nickname`
- `memory_capture`
```

- [ ] **Step 2: Run verification**

Run: `cd plugin-codex && bun run verify`

Expected: typecheck passes, tests pass, build creates `dist/mcp/server.js` and `dist/hooks/runner.js`.

- [ ] **Step 3: Inspect generated package**

Run: `cd plugin-codex && find dist -maxdepth 3 -type f | sort`

Expected output includes:

```text
dist/.codex-plugin/plugin.json
dist/hooks/runner.js
dist/hooks-config/hooks.json
dist/mcp/server.js
dist/skills/opencode-memnet-memory/SKILL.md
```

- [ ] **Step 4: Commit docs and build verification**

```bash
git add plugin-codex/README.md plugin-codex/package.json
git commit -m "docs(codex): document codex plugin setup"
```

## Self-Review

Spec coverage:

- Client identity and nickname sync are covered in Tasks 2, 3, and 4.
- Existing server API reuse is covered in Task 3.
- MCP tools are covered in Task 4.
- Hooks are covered in Task 5 and Task 6.
- Plugin packaging and skill bundle are covered in Task 6.
- Verification is covered in Task 7.

Placeholder scan:

- This plan intentionally contains no placeholder or deferred-work markers.
- Each code-producing task includes concrete file content.

Type consistency:

- `CodexMemnetConfig`, `RemoteMemoryClient`, `createToolHandlers`, `parseHookPayload`, and `getTags` are introduced before later tasks use them.
- MCP handler names match the tool names in the spec and README.
