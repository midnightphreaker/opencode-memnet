import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildClientMetadata, getClientIdFromFile } from "../src/identity";

describe("buildClientMetadata", () => {
  test("marks metadata as Codex client metadata", () => {
    const metadata = buildClientMetadata("/repo/project");

    expect(metadata.client).toBe("codex");
    expect(metadata.runtime).toBe("codex-cli");
    expect(metadata.cwd).toBe("/repo/project");
    expect(metadata.hostname).toBeString();
    expect(metadata.platform).toBeString();
    expect(metadata.projectName).toBe("project");
  });

  test("includes git repo url when available", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-metadata-"));

    try {
      execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["remote", "add", "origin", "https://example.invalid/repo.git"], {
        cwd: dir,
        stdio: "ignore",
      });

      const metadata = buildClientMetadata(dir);

      expect(metadata.projectName).toBeTruthy();
      expect(metadata.gitRepoUrl).toBe("https://example.invalid/repo.git");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("getClientIdFromFile", () => {
  test("persists a generated client id without using the real home directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-client-id-"));
    const path = join(dir, "nested", "client-id");

    try {
      mkdirSync(join(dir, "nested"), { recursive: true });
      const first = getClientIdFromFile(path);
      const second = getClientIdFromFile(path);

      expect(first).toHaveLength(36);
      expect(second).toBe(first);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
