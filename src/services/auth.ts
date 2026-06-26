import type { AuthService, Principal } from "./auth-service.js";

export interface AuthResult {
  principal: Principal;
}

export class AuthMiddleware {
  private readonly authService: Pick<AuthService, "authenticateBearer">;

  constructor(authService: Pick<AuthService, "authenticateBearer">) {
    this.authService = authService;
  }

  async authenticate(req: Request): Promise<AuthResult | Response> {
    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      return this.unauthorized("Missing Authorization header");
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer" || !parts[1]) {
      return this.unauthorized("Invalid Authorization format. Use: Bearer <key>");
    }

    const principal = await this.authService.authenticateBearer(parts[1]);
    if (!principal) return this.unauthorized("Invalid API key");
    return { principal };
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
