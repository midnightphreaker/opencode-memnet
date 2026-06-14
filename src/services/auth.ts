import {
  findProfileByApiKey,
  timingSafeEqualString,
  type ConfiguredProfile,
  type Principal,
} from "./profile-auth.js";

export type RouteKind = "webui" | "client";

export interface AuthResult {
  principal: Principal;
}

export class AuthMiddleware {
  private readonly apiKey: string;
  private readonly configuredProfiles: ConfiguredProfile[];
  private readonly newUserApiKey: string;

  constructor(
    apiKey: string,
    options?: {
      configuredProfiles?: ConfiguredProfile[];
      newUserApiKey?: string;
    }
  ) {
    this.apiKey = apiKey;
    this.configuredProfiles = options?.configuredProfiles ?? [];
    this.newUserApiKey = options?.newUserApiKey ?? "";
  }

  authenticate(req: Request, _routeKind: RouteKind): AuthResult | Response {
    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      return this.unauthorized("Missing Authorization header");
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer" || !parts[1]) {
      return this.unauthorized("Invalid Authorization format. Use: Bearer <key>");
    }

    const key = parts[1];
    if (this.apiKey && timingSafeEqualString(key, this.apiKey)) {
      return { principal: { kind: "admin" } };
    }

    if (this.newUserApiKey && timingSafeEqualString(key, this.newUserApiKey)) {
      const url = new URL(req.url);
      if (req.method.toUpperCase() === "POST" && url.pathname === "/api/client/connect") {
        return { principal: { kind: "newuser" } };
      }
      return this.unauthorized("NEWUSER_API_KEY is only valid for POST /api/client/connect");
    }

    const profile = findProfileByApiKey(this.configuredProfiles, key);
    if (profile) {
      return {
        principal: profile.displayName
          ? { kind: "profile", profileId: profile.profileId, displayName: profile.displayName }
          : { kind: "profile", profileId: profile.profileId },
      };
    }

    return this.unauthorized("Invalid API key");
  }

  private unauthorized(message: string): Response {
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
}
