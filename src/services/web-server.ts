import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { log, logDebug, logError } from "./logger.js";
import { AuthMiddleware } from "./auth.js";
import type { AuthResult, RouteKind } from "./auth.js";
import type { ConfiguredProfile, Principal } from "./profile-auth.js";
import { principalResponse, requireProfileIdForPrincipal } from "./profile-auth.js";
import {
  handleListTags,
  handleListMemories,
  handleAddMemory,
  handleDeleteMemory,
  handleBulkDelete,
  handleUpdateMemory,
  handleSearch,
  handleStats,
  handlePinMemory,
  handleUnpinMemory,
  handleDetectTagMigration,
  handleRunTagMigrationBatch,
  handleResetTagMigration,
  handleGetTagMigrationProgress,
  handleDeletePrompt,
  handleBulkDeletePrompts,
  handleGetUserProfile,
  handleGetProfileChangelog,
  handleGetProfileSnapshot,
  handleRefreshProfile,
  handleMigrationDetect,
  handleCleanup,
  handleDeduplicate,
  handleMigrationRun,
  handleListUserProfiles,
  handleClientConnect,
  handleGetClientStats,
} from "./api-handlers.js";
import {
  enqueueJob,
  getJobStatus,
  getTagMigrationVirtualJob,
} from "./memory-maintenance-job-service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface WebServerConfig {
  port: number;
  host: string;
  enabled: boolean;
  allowedOrigin?: string;
}

// ── In-flight request counter for graceful shutdown ──
let activeRequests = 0;

export function getActiveRequestCount(): number {
  return activeRequests;
}

export class WebServer {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private config: WebServerConfig;
  private isOwner: boolean = false;
  private startPromise: Promise<void> | null = null;
  private readonly allowedOrigin: string;
  private readonly auth: AuthMiddleware | null;

  constructor(
    config: WebServerConfig,
    apiKey: string,
    options?: {
      disableWebuiAuth?: boolean;
      disableClientAuth?: boolean;
      configuredProfiles?: ConfiguredProfile[];
    }
  ) {
    this.config = config;
    this.allowedOrigin = config.allowedOrigin ?? "*";
    this.auth = new AuthMiddleware(apiKey, options);
  }

  async start(): Promise<void> {
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this._start();
    return this.startPromise;
  }

  private async _start(): Promise<void> {
    if (!this.config.enabled) return;
    try {
      this.server = Bun.serve({
        port: this.config.port,
        hostname: this.config.host,
        fetch: this.handleRequest.bind(this),
      });
      this.isOwner = true;
    } catch (error) {
      log("Web server failed to start", { error: String(error) });
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isOwner || !this.server) {
      return;
    }

    this.server.stop();
    this.server = null;
    this.isOwner = false;
    this.startPromise = null;
  }

  isRunning(): boolean {
    return this.server !== null;
  }

  getUrl(): string {
    return `http://${this.config.host}:${this.config.port}`;
  }

  private static readonly MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB

  private checkBodySize(req: Request): Response | null {
    const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
    if (contentLength > WebServer.MAX_BODY_SIZE) {
      return new Response(JSON.stringify({ error: "Request body too large" }), {
        status: 413,
        headers: { "Content-Type": "application/json" },
      });
    }
    return null;
  }

  private async parseBody<T = any>(req: Request): Promise<T> {
    const sizeError = this.checkBodySize(req);
    if (sizeError) {
      throw Object.assign(new Error("Request body too large"), { status: 413 });
    }
    const text = await req.text();
    if (text.length > WebServer.MAX_BODY_SIZE) {
      throw Object.assign(new Error("Request body too large"), { status: 413 });
    }
    try {
      return JSON.parse(text) as T;
    } catch (e) {
      if (e instanceof SyntaxError) {
        throw Object.assign(new Error("Invalid JSON in request body"), { status: 400 });
      }
      throw e;
    }
  }

  private getRouteKind(req: Request): RouteKind {
    return req.headers.get("X-Opencode-Memnet-Client") === "plugin" ? "client" : "webui";
  }

  private authenticateApiRequest(req: Request, path: string): AuthResult | Response {
    if (path === "/api/health") {
      return { principal: { kind: "admin" }, authDisabled: true };
    }
    if (!path.startsWith("/api/")) {
      return { principal: { kind: "admin" }, authDisabled: true };
    }
    if (!this.auth) {
      return this.jsonResponse({ success: false, error: "Authentication is not configured" }, 401);
    }
    return this.auth.authenticate(req, this.getRouteKind(req));
  }

  private profileIdForRequest(
    principal: Principal,
    requestedProfileId: string | undefined,
    options: { defaultProfileId?: string; requireAdminProfileId?: boolean } = {}
  ): string {
    return requireProfileIdForPrincipal(principal, requestedProfileId, options);
  }

  private applyPrincipalProfileToBody<T extends Record<string, any>>(
    principal: Principal,
    body: T,
    options: { requireAdminProfileId?: boolean } = {}
  ): T {
    return {
      ...body,
      profileId: this.profileIdForRequest(principal, body.profileId, options),
    };
  }

  private deriveJobScope(
    principal: Principal
  ): { kind: "all" } | { kind: "profile"; profileId: string } {
    return principal.kind === "profile"
      ? { kind: "profile", profileId: principal.profileId }
      : { kind: "all" };
  }

  // --- HTTP request handling (inlined from web-server-worker.ts) ---

  private async handleRequest(req: Request): Promise<Response> {
    activeRequests++;
    try {
      return await this._handleRequest(req);
    } finally {
      activeRequests--;
    }
  }

  private async _handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;
    const clientId = req.headers.get("X-Client-ID");

    // Log every API request at debug level (verbose)
    if (path.startsWith("/api/")) {
      const qs = url.search ? `?${url.searchParams.toString()}` : "";
      logDebug(`← ${method} ${path}${qs}`, {
        method,
        path,
        query: Object.fromEntries(url.searchParams),
        client: clientId || "unknown",
      });
    }

    // CORS preflight (no auth required)
    if (method === "OPTIONS") {
      const headers = new Headers();
      headers.set("Access-Control-Allow-Origin", this.allowedOrigin);
      headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      headers.set(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Client-ID, X-Opencode-Memnet-Client"
      );
      headers.set("Access-Control-Max-Age", "86400");
      if (this.allowedOrigin !== "*") headers.set("Vary", "Origin");
      return new Response(null, { status: 204, headers });
    }

    // Auth: all /api/* routes (except public health) produce a request principal.
    let requestPrincipal: Principal = { kind: "admin" };
    if (path.startsWith("/api/") && path !== "/api/health") {
      const authContext = this.authenticateApiRequest(req, path);
      if (authContext instanceof Response) return authContext;
      const principal = authContext.principal;
      requestPrincipal = principal;
    }
    const principal = requestPrincipal;

    const startTime = performance.now();

    try {
      if (path === "/" || path === "/index.html") {
        return this.serveStaticFile("index.html", "text/html");
      }

      if (path === "/styles.css") {
        return this.serveStaticFile("styles.css", "text/css");
      }

      if (path === "/app.js") {
        return this.serveStaticFile("app.js", "application/javascript");
      }

      if (path === "/i18n.js") {
        return this.serveStaticFile("i18n.js", "application/javascript");
      }

      if (path === "/favicon.ico") {
        return this.serveStaticFile("favicon.ico", "image/x-icon");
      }

      if (path === "/api/health" && method === "GET") {
        const { handleHealthPublic } = await import("./health-handler.js");
        return this.jsonResponse(handleHealthPublic());
      }

      if (path === "/api/health/details" && method === "GET") {
        const { handleHealthDetailed } = await import("./health-handler.js");
        return this.jsonResponse(handleHealthDetailed());
      }

      if (path === "/api/tags" && method === "GET") {
        const profileId = principal.kind === "profile" ? principal.profileId : undefined;
        const result = await handleListTags(profileId);
        return this.jsonResponse(result);
      }

      if (path === "/api/memories" && method === "GET") {
        if (url.searchParams.has("userEmail") || url.searchParams.has("userId")) {
          return this.jsonResponse({ success: false, error: "Use profileId instead" }, 400);
        }
        const tag = url.searchParams.get("tag") || undefined;
        const page = parseInt(url.searchParams.get("page") || "1") || 1;
        const pageSize = parseInt(url.searchParams.get("pageSize") || "20") || 20;
        const includePrompts = url.searchParams.get("includePrompts") !== "false";
        const requestedProfileId = url.searchParams.get("profileId") || undefined;
        const profileId = this.profileIdForRequest(principal, requestedProfileId, {
          defaultProfileId: "default",
        });
        const repoId = url.searchParams.get("repoId") || undefined;
        const result = await handleListMemories(
          tag,
          page,
          pageSize,
          includePrompts,
          profileId,
          repoId
        );
        return this.jsonResponse(result);
      }

      if (path === "/api/memories" && method === "POST") {
        const body = await this.parseBody(req);
        const scopedBody = this.applyPrincipalProfileToBody(principal, body, {
          requireAdminProfileId: true,
        });
        const result = await handleAddMemory(scopedBody);
        return this.jsonResponse(result);
      }

      if (path.startsWith("/api/memories/") && method === "DELETE") {
        const parts = path.split("/");
        const id = parts[3];
        if (!id || id === "bulk-delete") {
          return this.jsonResponse({ success: false, error: "Invalid ID" });
        }
        const cascade = url.searchParams.get("cascade") === "true";
        const result = await handleDeleteMemory(id, cascade, principal);
        return this.jsonResponse(result);
      }

      if (path.startsWith("/api/memories/") && method === "PUT") {
        const parts = path.split("/");
        const id = parts[3];
        if (!id) {
          return this.jsonResponse({ success: false, error: "Invalid ID" });
        }
        const body = await this.parseBody(req);
        const result = await handleUpdateMemory(id, body, principal);
        return this.jsonResponse(result);
      }

      if (path === "/api/memories/bulk-delete" && method === "POST") {
        const body = await this.parseBody(req);
        const cascade = body.cascade !== false;
        const result = await handleBulkDelete(body.ids || [], cascade, principal);
        return this.jsonResponse(result);
      }

      if (path === "/api/search" && method === "GET") {
        if (url.searchParams.has("userEmail") || url.searchParams.has("userId")) {
          return this.jsonResponse({ success: false, error: "Use profileId instead" }, 400);
        }
        const query = url.searchParams.get("q");
        const tag = url.searchParams.get("tag") || undefined;
        const page = parseInt(url.searchParams.get("page") || "1") || 1;
        const pageSize = parseInt(url.searchParams.get("pageSize") || "20") || 20;
        const requestedProfileId = url.searchParams.get("profileId") || undefined;
        const profileId = this.profileIdForRequest(principal, requestedProfileId, {
          defaultProfileId: "default",
        });
        const repoId = url.searchParams.get("repoId") || undefined;

        if (query && query.length > 1000) {
          return new Response(
            JSON.stringify({ success: false, error: "Query too long (max 1000 characters)" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        if (!query) {
          return this.jsonResponse({ success: false, error: "query parameter required" });
        }

        const result = await handleSearch(query, tag, page, pageSize, profileId, repoId);
        return this.jsonResponse(result);
      }

      if (path === "/api/stats" && method === "GET") {
        const result = await handleStats();
        return this.jsonResponse(result);
      }

      if (path.match(/^\/api\/memories\/[^/]+\/pin$/) && method === "POST") {
        const id = path.split("/")[3];
        if (!id) {
          return this.jsonResponse({ success: false, error: "Invalid ID" });
        }
        const result = await handlePinMemory(id, principal);
        return this.jsonResponse(result);
      }

      if (path.match(/^\/api\/memories\/[^/]+\/unpin$/) && method === "POST") {
        const id = path.split("/")[3];
        if (!id) {
          return this.jsonResponse({ success: false, error: "Invalid ID" });
        }
        const result = await handleUnpinMemory(id, principal);
        return this.jsonResponse(result);
      }

      if (path === "/api/migration/tags/detect" && method === "GET") {
        const result = await handleDetectTagMigration();
        return this.jsonResponse(result);
      }

      if (path === "/api/migration/tags/reset" && method === "POST") {
        const result = await handleResetTagMigration();
        return this.jsonResponse(result);
      }

      if (path === "/api/migration/tags/run-batch" && method === "POST") {
        const body = await this.parseBody(req);
        const batchSize = body?.batchSize || 5;
        const result = await handleRunTagMigrationBatch(batchSize);
        return this.jsonResponse(result);
      }

      if (path === "/api/migration/tags/progress" && method === "GET") {
        const result = await handleGetTagMigrationProgress();
        return this.jsonResponse(result);
      }

      if (path.startsWith("/api/prompts/") && method === "DELETE") {
        const parts = path.split("/");
        const id = parts[3];
        if (!id || id === "bulk-delete") {
          return this.jsonResponse({ success: false, error: "Invalid ID" });
        }
        const cascade = url.searchParams.get("cascade") === "true";
        const result = await handleDeletePrompt(id, cascade, principal);
        return this.jsonResponse(result);
      }

      if (path === "/api/prompts/bulk-delete" && method === "POST") {
        const body = await this.parseBody(req);
        const cascade = body.cascade !== false;
        const result = await handleBulkDeletePrompts(body.ids || [], cascade, principal);
        return this.jsonResponse(result);
      }

      if (path === "/api/user-profile" && method === "GET") {
        if (url.searchParams.has("userId")) {
          return this.jsonResponse({ success: false, error: "Use profileId, not userId" }, 400);
        }
        const requestedProfileId = url.searchParams.get("profileId") || undefined;
        const profileId =
          principal.kind === "admin"
            ? requestedProfileId
            : this.profileIdForRequest(principal, requestedProfileId);
        const result = await handleGetUserProfile(profileId);
        return this.jsonResponse(result);
      }

      if (path === "/api/user-profile/changelog" && method === "GET") {
        const profileId = this.profileIdForRequest(
          principal,
          url.searchParams.get("profileId") || undefined,
          {
            requireAdminProfileId: true,
          }
        );
        const limit = parseInt(url.searchParams.get("limit") || "5");
        const result = await handleGetProfileChangelog(profileId, limit);
        return this.jsonResponse(result);
      }

      if (path === "/api/user-profile/snapshot" && method === "GET") {
        const changelogId = url.searchParams.get("chlogId");
        if (!changelogId) {
          return this.jsonResponse({ success: false, error: "changelogId parameter required" });
        }
        const result = await handleGetProfileSnapshot(changelogId, principal);
        return this.jsonResponse(result);
      }

      if (path === "/api/user-profile/refresh" && method === "POST") {
        const body = await this.parseBody(req);
        if (body.userId) {
          return this.jsonResponse({ success: false, error: "Use profileId, not userId" }, 400);
        }
        const profileId = this.profileIdForRequest(principal, body.profileId, {
          requireAdminProfileId: true,
        });
        const result = await handleRefreshProfile(profileId);
        return this.jsonResponse(result);
      }

      if (path === "/api/context/inject" && method === "POST") {
        const body = await this.parseBody(req);
        const scopedBody = this.applyPrincipalProfileToBody(principal, body, {
          requireAdminProfileId: true,
        });
        const result = await (await import("./api-handlers.js")).handleContextInject(scopedBody);
        return this.jsonResponse(result);
      }

      if (path === "/api/auto-capture" && method === "POST") {
        const body = await this.parseBody(req);
        const scopedBody = this.applyPrincipalProfileToBody(principal, body, {
          requireAdminProfileId: true,
        });
        const result = await (await import("./api-handlers.js")).handleAutoCapture(scopedBody);
        return this.jsonResponse(result);
      }

      if (path === "/api/user-profile/learn" && method === "POST") {
        const body = await this.parseBody(req);
        const scopedBody = this.applyPrincipalProfileToBody(principal, body, {
          requireAdminProfileId: true,
        });
        const result = await (await import("./api-handlers.js")).handleUserProfileLearn(scopedBody);
        return this.jsonResponse(result);
      }

      if (path === "/api/migration/detect" && method === "GET") {
        const result = handleMigrationDetect();
        return this.jsonResponse(result);
      }

      if (path === "/api/cleanup" && method === "POST") {
        const scope = this.deriveJobScope(principal);
        const result = enqueueJob("cleanup_memories", scope);
        if (!result.success) {
          return this.jsonResponse({ success: false, error: result.error, code: result.code }, 409);
        }
        return this.jsonResponse({
          success: true,
          data: {
            jobId: result.data!.id,
            status: result.data!.status,
            type: result.data!.type,
            message: "Job queued successfully",
          },
        });
      }

      if (path === "/api/deduplicate" && method === "POST") {
        const scope = this.deriveJobScope(principal);
        const result = enqueueJob("deduplicate_memories", scope);
        if (!result.success) {
          return this.jsonResponse({ success: false, error: result.error, code: result.code }, 409);
        }
        return this.jsonResponse({
          success: true,
          data: {
            jobId: result.data!.id,
            status: result.data!.status,
            type: result.data!.type,
            message: "Job queued successfully",
          },
        });
      }

      // Tag normalization job
      if (path === "/api/tags/normalize" && method === "POST") {
        const scope = this.deriveJobScope(principal);
        const result = enqueueJob("normalize_memory_tags", scope);
        if (!result.success) {
          return this.jsonResponse({ success: false, error: result.error, code: result.code }, 409);
        }
        return this.jsonResponse({
          success: true,
          data: {
            jobId: result.data!.id,
            status: result.data!.status,
            type: result.data!.type,
            message: "Tag normalization job queued successfully",
          },
        });
      }

      // Get canonical tags
      if (path === "/api/tags/canonical" && method === "GET") {
        try {
          const { createTagRegistry } = await import("./storage/factory.js");
          const registry = createTagRegistry();
          const tags = await registry.getAllCanonicalTags();
          return this.jsonResponse({ success: true, data: { tags } });
        } catch (err) {
          return this.jsonResponse({ success: false, error: String(err) }, 500);
        }
      }

      if (path === "/api/jobs/memory" && method === "GET") {
        const status = getJobStatus();
        const tagJob = await getTagMigrationVirtualJob();
        if (tagJob && !status.current) {
          status.current = tagJob;
          status.activity.active = true;
          status.activity.text = "Tag Untagged in progress...";
        }
        return this.jsonResponse({ success: true, data: status });
      }

      if (path === "/api/migration/run" && method === "POST") {
        const body = await this.parseBody(req);
        const result = handleMigrationRun(body);
        return this.jsonResponse(result);
      }

      if (path === "/api/user-profiles" && method === "GET") {
        const result = await handleListUserProfiles(principal);
        if (!result.success) return this.jsonResponse(result);
        return this.jsonResponse({
          success: true,
          data: {
            ...result.data,
            principal: principalResponse(principal),
          },
        });
      }

      // ── Client Identity ──
      if (path === "/api/client/connect" && method === "POST") {
        const body = await this.parseBody(req);
        const result = await handleClientConnect(body, principal);
        return this.jsonResponse(result);
      }

      if (path === "/api/client/stats" && method === "GET") {
        const clientIdParam = url.searchParams.get("clientId");
        if (!clientIdParam) {
          return this.jsonResponse({ success: false, error: "clientId query parameter required" });
        }
        const result = await handleGetClientStats({ clientId: clientIdParam });
        return this.jsonResponse(result);
      }

      // Generic static file serving (svg, html, png, etc.)
      const staticExts: Record<string, string> = {
        ".svg": "image/svg+xml",
        ".html": "text/html",
        ".png": "image/png",
        ".ico": "image/x-icon",
        ".json": "application/json",
        ".txt": "text/plain",
        ".md": "text/markdown",
      };
      const ext = path.substring(path.lastIndexOf("."));
      const contentType = staticExts[ext];
      if (contentType) {
        // Prevent directory traversal
        const filename = path.split("/").pop() || "";
        if (filename && !filename.includes("..")) {
          return this.serveStaticFile(filename, contentType);
        }
      }

      return new Response("Not Found", { status: 404 });
    } catch (error: any) {
      const elapsed = Math.round(performance.now() - startTime);
      const status = error?.status || 500;
      if (status >= 500) {
        logError(`✗ ${method} ${path} ${elapsed}ms error`, { error: String(error), elapsed });
      }
      return this.jsonResponse(
        {
          success: false,
          error: status >= 500 ? "Internal server error" : error?.message || "Bad request",
        },
        status
      );
    }
  }

  private serveStaticFile(filename: string, contentType: string): Response {
    try {
      const webDir = join(__dirname, "..", "web");
      const filePath = join(webDir, filename);

      if (contentType.startsWith("image/")) {
        const content = readFileSync(filePath);
        return new Response(content, {
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=86400",
          },
        });
      }

      const content = readFileSync(filePath, "utf-8");

      return new Response(content, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "no-cache",
        },
      });
    } catch (error) {
      return new Response("File not found", { status: 404 });
    }
  }

  private jsonResponse(data: any, status: number = 200): Response {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": this.allowedOrigin,
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, X-Client-ID, X-Opencode-Memnet-Client",
    };

    if (this.allowedOrigin !== "*") {
      headers["Vary"] = "Origin";
      headers["Access-Control-Allow-Credentials"] = "true";
    }

    return new Response(JSON.stringify(data), {
      status,
      headers,
    });
  }
}

export async function startWebServer(
  config: WebServerConfig,
  apiKey: string,
  options?: {
    disableWebuiAuth?: boolean;
    disableClientAuth?: boolean;
    configuredProfiles?: ConfiguredProfile[];
  }
): Promise<WebServer> {
  const server = new WebServer(config, apiKey, options);
  await server.start();
  return server;
}
