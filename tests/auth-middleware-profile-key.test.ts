import { describe, expect, it } from "bun:test";
import { AuthMiddleware } from "../src/services/auth.js";

function requestWithBearer(key?: string): Request {
  const headers = new Headers();
  if (key !== undefined) headers.set("Authorization", `Bearer ${key}`);
  return new Request("http://localhost/api/memories", { headers });
}

describe("AuthMiddleware profile keys", () => {
  const auth = new AuthMiddleware("admin-secret", {
    disableWebuiAuth: false,
    disableClientAuth: false,
    configuredProfiles: [{ profileId: "phrkr", displayName: "Phrkr", apiKey: "profile-secret" }],
  });

  it("authenticates SERVER_API_KEY as admin", () => {
    const result = auth.authenticate(requestWithBearer("admin-secret"), "webui");

    expect(result instanceof Response).toBe(false);
    expect(result).toEqual({ principal: { kind: "admin" } });
  });

  it("authenticates configured profile keys as profile principals", () => {
    const result = auth.authenticate(requestWithBearer("profile-secret"), "client");

    expect(result instanceof Response).toBe(false);
    expect(result).toEqual({
      principal: { kind: "profile", profileId: "phrkr", displayName: "Phrkr" },
    });
  });

  it("rejects missing bearer tokens when route auth is enabled", async () => {
    const result = auth.authenticate(requestWithBearer(undefined), "client");

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
    await expect((result as Response).json()).resolves.toEqual({
      success: false,
      error: "Missing Authorization header",
    });
  });

  it("rejects missing bearer tokens on webui routes even if legacy disableWebuiAuth is set", async () => {
    const disabled = new AuthMiddleware("admin-secret", {
      disableWebuiAuth: true,
      disableClientAuth: false,
      configuredProfiles: [],
    });

    const result = disabled.authenticate(requestWithBearer(undefined), "webui");

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
    await expect((result as Response).json()).resolves.toEqual({
      success: false,
      error: "Missing Authorization header",
    });
  });

  it("rejects missing bearer tokens on client routes even if legacy disableClientAuth is set", async () => {
    const disabled = new AuthMiddleware("admin-secret", {
      disableWebuiAuth: false,
      disableClientAuth: true,
      configuredProfiles: [],
    });

    const result = disabled.authenticate(requestWithBearer(undefined), "client");

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
    await expect((result as Response).json()).resolves.toEqual({
      success: false,
      error: "Missing Authorization header",
    });
  });

  it("rejects invalid explicit bearer tokens even if legacy auth-disable options are set", async () => {
    const disabled = new AuthMiddleware("admin-secret", {
      disableWebuiAuth: true,
      disableClientAuth: true,
      configuredProfiles: [],
    });

    const result = disabled.authenticate(requestWithBearer("wrong"), "webui");

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });
});
