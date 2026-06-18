import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, normalize, resolve } from "node:path";

export interface TagInfo {
  projectTag: string;
  profileId?: string;
  repoId: string;
  metadata: Record<string, unknown>;
}

export interface ProjectDetails {
  repoRoot: string;
  projectName: string;
  gitRepoUrl?: string;
  projectIdentity: string;
  repoIdentity: string;
}

const GIT_TIMEOUT_MS = 1_000;
const gitCache = new Map<string, string | undefined>();
const tagCache = new Map<string, TagInfo>();
const projectDetailsCache = new Map<string, ProjectDetails>();

export function getTags(cwd = process.cwd()): TagInfo {
  const cached = tagCache.get(cwd);
  if (cached) {
    return cached;
  }

  const details = getProjectDetails(cwd);
  const projectTag = `opencode_project_${hash(details.projectIdentity)}`;
  const repoId = `repo_${hash(details.repoIdentity)}`;

  const result = {
    projectTag,
    repoId,
    metadata: {
      displayName: details.projectName,
      projectName: details.projectName,
      gitRepoUrl: details.gitRepoUrl,
    },
  };

  tagCache.set(cwd, result);
  return result;
}

export function getProjectDetails(cwd = process.cwd()): ProjectDetails {
  const cached = projectDetailsCache.get(cwd);
  if (cached) {
    return cached;
  }

  const commonDir = getGitCommonDir(cwd);
  const repoRoot =
    commonDir && basename(commonDir) === ".git"
      ? dirname(commonDir)
      : (git(cwd, ["rev-parse", "--show-toplevel"]) ?? cwd);
  const gitRepoUrl = git(cwd, ["config", "--get", "remote.origin.url"]);
  const sanitizedGitRepoUrl = sanitizeGitRemoteUrl(gitRepoUrl);
  const projectName = basename(repoRoot);
  const projectIdentity = commonDir
    ? `git-common:${commonDir}`
    : sanitizedGitRepoUrl
      ? `remote:${sanitizedGitRepoUrl}`
      : `path:${normalize(cwd)}`;
  const repoIdentity = sanitizedGitRepoUrl
    ? `remote:${canonicalizeGitRemoteUrl(sanitizedGitRepoUrl)}`
    : `repo-root:${basename(repoRoot)}`;
  const details = {
    repoRoot,
    projectName,
    gitRepoUrl: sanitizedGitRepoUrl,
    projectIdentity,
    repoIdentity,
  };

  projectDetailsCache.set(cwd, details);
  return details;
}

function getGitCommonDir(cwd: string): string | undefined {
  const commonDir = git(cwd, ["rev-parse", "--git-common-dir"]);
  if (!commonDir) {
    return undefined;
  }

  const resolved = isAbsolute(commonDir) ? normalize(commonDir) : normalize(resolve(cwd, commonDir));
  if (existsSync(resolved)) {
    return realpathSync(resolved);
  }

  return resolved;
}

function git(cwd: string, args: string[]): string | undefined {
  const key = `${cwd}\0${args.join("\0")}`;
  if (gitCache.has(key)) {
    return gitCache.get(key);
  }

  try {
    const value = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: GIT_TIMEOUT_MS,
    }).trim();
    const result = value || undefined;
    gitCache.set(key, result);
    return result;
  } catch {
    gitCache.set(key, undefined);
    return undefined;
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function sanitizeGitRemoteUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const url = new URL(trimmed);
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return trimmed;
  }
}

function canonicalizeGitRemoteUrl(value: string): string {
  return value.trim().replace(/\.git$/i, "").replace(/\/+$/g, "").toLowerCase();
}
