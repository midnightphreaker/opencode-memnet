import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const app = readFileSync(join(import.meta.dir, "../src/web/app.js"), "utf-8");
const html = readFileSync(join(import.meta.dir, "../src/web/index.html"), "utf-8");
const css = readFileSync(join(import.meta.dir, "../src/web/styles.css"), "utf-8");
const i18n = readFileSync(join(import.meta.dir, "../src/web/i18n.js"), "utf-8");

describe("WebUI v2 auth and Memory Bank controls", () => {
  it("uses admin API key and Memory Bank state instead of profile state", () => {
    expect(app).toContain("apiKeys: []");
    expect(app).toContain("memoryBanks: []");
    expect(app).toContain("activeMemoryBankId");
    expect(app).not.toContain("activeProfileId");
    expect(app).not.toContain("profileLocked");
  });

  it("calls v2 admin API key and Memory Bank routes", () => {
    expect(app).toContain('fetchAPI("/api/admin/api-keys"');
    expect(app).toContain("/api/admin/api-keys/");
    expect(app).toContain("/memory-banks");
    expect(app).toContain("X-Memory-Bank-ID");
    expect(app).toContain("No active Memory Bank");
    expect(app).toContain("activeMemoryBankId");
  });

  it("renders key and bank management panels", () => {
    expect(html).toContain("api-key-admin-section");
    expect(html).toContain("memory-bank-admin-section");
    expect(html).toContain("generated-key-modal");
    expect(css).toContain(".generated-key-value");
  });

  it("has v2 labels and removes legacy profile wording", () => {
    expect(i18n).toContain("Memory Bank");
    expect(i18n).toContain("API Key Description");
    expect(i18n).not.toContain("Profile key");
  });

  it("serves icon rendering code locally instead of relying on a CDN", () => {
    expect(html).toContain('src="/vendor/lucide.min.js"');
    expect(html).not.toContain("unpkg.com/lucide");
    expect(existsSync(join(import.meta.dir, "../src/web/vendor/lucide.min.js"))).toBe(true);
  });
});
