import { describe, expect, it } from "bun:test";
import { WebServer } from "../src/services/web-server.js";

function makeServer() {
  return new WebServer({ port: 0, host: "127.0.0.1", enabled: false }, {
    authenticateBearer: async () => null,
  } as any) as any;
}

async function get(path: string) {
  return makeServer()._handleRequest(new Request(`http://localhost${path}`));
}

describe("WebUI static assets", () => {
  it("serves vendored nested JavaScript assets", async () => {
    const response = await get("/vendor/lucide.min.js");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/javascript");
    expect(await response.text()).toContain("lucide");
  });

  it("blocks static path traversal", async () => {
    const response = await get("/../package.json");
    expect(response.status).toBe(404);
  });
});
