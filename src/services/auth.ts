// src/services/auth.ts
import crypto from "node:crypto";

export class AuthMiddleware {
  private readonly apiKey: string;
  private readonly disableWebuiAuth: boolean;
  private readonly disableClientAuth: boolean;

  constructor(
    apiKey: string,
    options?: { disableWebuiAuth?: boolean; disableClientAuth?: boolean }
  ) {
    this.apiKey = apiKey;
    this.disableWebuiAuth = options?.disableWebuiAuth ?? false;
    this.disableClientAuth = options?.disableClientAuth ?? false;
  }

  /** True when both WebUI and client auth are disabled — no auth check needed. */
  get isAuthFullyDisabled(): boolean {
    return this.disableWebuiAuth && this.disableClientAuth;
  }

  get isWebuiAuthDisabled(): boolean {
    return this.disableWebuiAuth;
  }

  get isClientAuthDisabled(): boolean {
    return this.disableClientAuth;
  }

  /**
   * Authenticate a request. Returns null on success, or a 401 Response on failure.
   * If both auth modes are disabled, always returns null.
   */
  authenticate(req: Request): Response | null {
    if (this.isAuthFullyDisabled) return null;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return this.unauthorized("Missing Authorization header");
    }
    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      return this.unauthorized("Invalid Authorization format. Use: Bearer <key>");
    }
    if (!this.apiKey) {
      return this.unauthorized("Invalid API key");
    }
    // Constant-time comparison to prevent timing side-channel attacks
    const keyBuf = Buffer.from(parts[1]!);
    const expectedBuf = Buffer.from(this.apiKey);
    if (keyBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(keyBuf, expectedBuf)) {
      return this.unauthorized("Invalid API key");
    }
    return null;
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
