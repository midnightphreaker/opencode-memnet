import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(import.meta.dir, "..", path), "utf-8");

describe("webui strict identity", () => {
  it("uses profileId instead of legacy user identity parameters", () => {
    const app = read("src/web/app.js");

    expect(app).toContain("profileId");
    expect(app).not.toContain("userEmail");
    expect(app).not.toContain("userId");
  });

  it("does not expose nickname settings controls", () => {
    const html = read("src/web/index.html");
    const i18n = read("src/web/i18n.js");

    expect(html).not.toContain("settings-nickname");
    expect(i18n).not.toMatch(/\bnickname\b/);
  });
});
