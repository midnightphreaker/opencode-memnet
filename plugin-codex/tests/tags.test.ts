import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProjectTagInfo } from "../../shared/tags";
import { getTags, sanitizeGitRemoteUrl } from "../src/tags";

describe("getTags", () => {
  test("returns opencode-compatible project tag and stable repo id", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-tags-"));

    try {
      const first = getTags(dir);
      const second = getTags(dir);

      expect(first.projectTag).toStartWith("opencode_project_");
      expect(first.repoId).toStartWith("repo_");
      expect(first.repoId).not.toBe(first.projectTag);
      expect(second.repoId).toBe(first.repoId);
      expect("userId" in first).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("matches the shared OpenCode project tag algorithm for git repos", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-tags-git-"));

    try {
      execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });

      const codex = getTags(dir);
      const shared = await getProjectTagInfo(dir, { containerTagPrefix: "opencode" });

      expect(codex.projectTag).toBe(shared.tag);
      expect(codex.repoId).toStartWith("repo_");
      expect(codex.metadata.projectName).toBe(shared.projectName);
      expect("projectPath" in codex.metadata).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("derives repo id from sanitized remote identity across checkout paths", () => {
    const firstDir = mkdtempSync(join(tmpdir(), "codex-tags-remote-a-"));
    const secondDir = mkdtempSync(join(tmpdir(), "codex-tags-remote-b-"));

    try {
      for (const dir of [firstDir, secondDir]) {
        execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
        execFileSync(
          "git",
          ["remote", "add", "origin", "https://token:secret@example.invalid/Org/Repo.git"],
          { cwd: dir, stdio: "ignore" },
        );
      }

      const first = getTags(firstDir);
      const second = getTags(secondDir);

      expect(first.repoId).toBe(second.repoId);
      expect(first.projectTag).not.toBe(second.projectTag);
      expect(first.metadata.gitRepoUrl).toBe("https://example.invalid/Org/Repo.git");
      expect(JSON.stringify(first.metadata)).not.toContain("secret");
    } finally {
      rmSync(firstDir, { recursive: true, force: true });
      rmSync(secondDir, { recursive: true, force: true });
    }
  });

  test("sanitizes remote URL userinfo", () => {
    expect(sanitizeGitRemoteUrl("https://user:pass@example.invalid/repo.git")).toBe(
      "https://example.invalid/repo.git",
    );
  });
});
