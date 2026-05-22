import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";
import { initConfig, CONFIG } from "../src/config.js";

describe("project-scoped config resolution", () => {
  let readSpy: ReturnType<typeof spyOn>;
  let existsSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    readSpy?.mockRestore();
    existsSpy?.mockRestore();
    // Reset to global-only config
    initConfig("/nonexistent-project");
  });

  it("uses global config when no project config exists", () => {
    existsSpy = spyOn(fs, "existsSync").mockImplementation((p) => {
      const path = String(p);
      return path.includes(".config/opencode/opencode-mem");
    });
    readSpy = spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify({ opencodeModel: "global-model" })
    );
    initConfig("/some/project");
    expect(CONFIG.opencodeModel).toBe("global-model");
  });

  it("project config overrides global config", () => {
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(true);
    readSpy = spyOn(fs, "readFileSync").mockImplementation((p) => {
      const path = String(p);
      if (path.includes(".opencode/opencode-mem")) {
        return JSON.stringify({
          opencodeProvider: "openai",
          opencodeModel: "project-model",
        }) as any;
      }
      return JSON.stringify({
        opencodeProvider: "anthropic",
        opencodeModel: "global-model",
      }) as any;
    });
    initConfig("/my/project");
    expect(CONFIG.opencodeProvider).toBe("openai");
    expect(CONFIG.opencodeModel).toBe("project-model");
  });

  it("shallow merge: project adds fields, global fields preserved when not overridden", () => {
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(true);
    readSpy = spyOn(fs, "readFileSync").mockImplementation((p) => {
      const path = String(p);
      if (path.includes(".opencode/opencode-mem")) {
        return JSON.stringify({ opencodeProvider: "anthropic" }) as any;
      }
      return JSON.stringify({ opencodeModel: "claude-haiku", autoCaptureEnabled: false }) as any;
    });
    initConfig("/my/project");
    expect(CONFIG.opencodeProvider).toBe("anthropic");
    expect(CONFIG.opencodeModel).toBe("claude-haiku");
    expect(CONFIG.autoCaptureEnabled).toBe(false);
  });

  it("falls back to defaults when neither global nor project config exists", () => {
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(false);
    initConfig("/no/config/project");
    expect(CONFIG.autoCaptureEnabled).toBe(true); // default value
    expect(CONFIG.opencodeProvider).toBeUndefined();
  });
});

describe("storageBackend and embeddingMaxTokens config resolution", () => {
  let readSpy: ReturnType<typeof spyOn>;
  let existsSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    readSpy?.mockRestore();
    existsSpy?.mockRestore();
    initConfig("/nonexistent-project");
  });

  it("storageBackend defaults to sqlite", () => {
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(false);
    initConfig("/no/config/project");
    expect(CONFIG.storageBackend).toBe("sqlite");
  });

  it("storageBackend can be overridden to postgres", () => {
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(true);
    readSpy = spyOn(fs, "readFileSync").mockImplementation(() => {
      return JSON.stringify({
        storageBackend: "postgres",
        postgres: { url: "postgres://user:pass@localhost:5432/testdb" },
      }) as any;
    });
    initConfig("/pg/project");
    expect(CONFIG.storageBackend).toBe("postgres");
    expect(CONFIG.postgres.url).toBe("postgres://user:pass@localhost:5432/testdb");
  });

  it("embeddingMaxTokens can be partially overridden", () => {
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(true);
    readSpy = spyOn(fs, "readFileSync").mockImplementation(() => {
      return JSON.stringify({
        embeddingMaxTokens: { content: 4096 },
      }) as any;
    });
    initConfig("/override/project");
    expect(CONFIG.embeddingMaxTokens.content).toBe(4096);
    // Other fields keep defaults
    expect(CONFIG.embeddingMaxTokens.tags).toBe(256);
    expect(CONFIG.embeddingMaxTokens.query).toBe(512);
    expect(CONFIG.embeddingMaxTokens.migration).toBe(2048);
  });

  it("resolves postgres.url via env:// secret reference", () => {
    process.env.TEST_PG_URL = "postgres://envuser:envpass@localhost:5432/envdb";
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(true);
    readSpy = spyOn(fs, "readFileSync").mockImplementation(() => {
      return JSON.stringify({
        storageBackend: "postgres",
        postgres: { url: "env://TEST_PG_URL" },
      }) as any;
    });
    initConfig("/env/project");
    expect(CONFIG.postgres.url).toBe("postgres://envuser:envpass@localhost:5432/envdb");
    delete process.env.TEST_PG_URL;
  });

  it("throws if storageBackend is postgres and no url configured", () => {
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(true);
    readSpy = spyOn(fs, "readFileSync").mockImplementation(() => {
      return JSON.stringify({
        storageBackend: "postgres",
      }) as any;
    });
    expect(() => initConfig("/pg-no-url/project")).toThrow(
      /storageBackend.*postgres.*no postgres\.url/i
    );
  });

  it("does not throw if storageBackend is sqlite even with no postgres url", () => {
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(false);
    expect(() => initConfig("/sqlite-ok/project")).not.toThrow();
    expect(CONFIG.storageBackend).toBe("sqlite");
  });
});
