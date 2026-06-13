export interface ProfileScope {
  profileId: string;
}

export interface ProjectScope extends ProfileScope {
  repoId: string;
}

export interface ResolvedProject extends ProjectScope {
  gitRepoUrl: string;
  repoNickname: string;
  gitUserName: string;
  gitUserEmail: string;
  localProjectPath?: string;
}

export function normalizeGitRepoUrl(rawUrl: string): string {
  let url = rawUrl.trim();
  if (url.endsWith("/")) url = url.replace(/\/+$/, "");
  if (url.endsWith(".git")) url = url.slice(0, -4);
  const sshMatch = url.match(/^git@([^:]+):(.+)$/);
  if (sshMatch) {
    url = `https://${sshMatch[1]}/${sshMatch[2]}`;
  }
  return url.replace(/\/+$/, "").toLowerCase();
}

export function requireProfileScope(input: { profileId?: string | null }): ProfileScope {
  const profileId = input.profileId?.trim();
  if (!profileId) throw new Error("profileId is required");
  return { profileId };
}

export function requireProjectScope(input: {
  profileId?: string | null;
  repoId?: string | null;
}): ProjectScope {
  const { profileId } = requireProfileScope(input);
  const repoId = input.repoId?.trim();
  if (!repoId) throw new Error("repoId is required");
  return { profileId, repoId };
}
