import {
  findProfileByApiKey,
  timingSafeEqualString,
  type ConfiguredProfile,
  type Principal,
} from "./profile-auth.js";

export type RouteKind = "webui" | "client";

export interface AuthResult {
  principal: Principal;
  authDisabled: boolean;
}

export class AuthMiddleware {
  private readonly apiKey: string;
  private readonly disableWebuiAuth: boolean;
  private readonly disableClientAuth: boolean;
  private readonly configuredProfiles: ConfiguredProfile[];

  constructor(
    apiKey: string,
    options?: {
      disableWebuiAuth?: boolean;
      disableClientAuth?: boolean;
      configuredProfiles?: ConfiguredProfile[];
    }
  ) {
    this.apiKey = apiKey;
    this.disableWebuiAuth = options?.disableWebuiAuth ?? false;
    this.disableClientAuth = options?.disableClientAuth ?? false;
    this.configuredProfiles = options?.configuredProfiles ?? [];
  }

  get isAuthFullyDisabled(): boolean {
    return this.disableWebuiAuth && this.disableClientAuth;
  }

  get isWebuiAuthDisabled(): boolean {
    return this.disableWebuiAuth;
  }

  get isClientAuthDisabled(): boolean {
    return this.disableClientAuth;
  }

  authenticate(req: Request, routeKind: RouteKind): AuthResult | Response {
    const authHeader = req.headers.get("Authorization");
    const routeAuthDisabled =
      routeKind === "client" ? this.disableClientAuth : this.disableWebuiAuth;

    if (!authHeader) {
      if (routeAuthDisabled) {
        return { principal: { kind: "admin" }, authDisabled: true };
      }
      return this.unauthorized("Missing Authorization header");
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer" || !parts[1]) {
      return this.unauthorized("Invalid Authorization format. Use: Bearer <key>");
    }

    const key = parts[1];
    if (this.apiKey && timingSafeEqualString(key, this.apiKey)) {
      return { principal: { kind: "admin" }, authDisabled: false };
    }

    const profile = findProfileByApiKey(this.configuredProfiles, key);
    if (profile) {
      return {
        principal: profile.displayName
          ? { kind: "profile", profileId: profile.profileId, displayName: profile.displayName }
          : { kind: "profile", profileId: profile.profileId },
        authDisabled: false,
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
