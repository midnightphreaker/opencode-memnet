import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDirs: string[] = [];
const clientConfigUrl = new URL("../shared/client-config.js", import.meta.url).href;
const remoteClientUrl = new URL("../plugin/src/services/remote-client.js", import.meta.url).href;
const loggerUrl = new URL("../shared/logger.js", import.meta.url).href;

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function runScenario() {
  const home = mkdtempSync(join(tmpdir(), "memnet-newuser-home-"));
  const project = mkdtempSync(join(tmpdir(), "memnet-newuser-project-"));
  tempDirs.push(home, project);
  const globalDir = join(home, ".config", "opencode");
  const projectDir = join(project, ".opencode");
  mkdirSync(globalDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  const globalFile = join(globalDir, "opencode-memnet.jsonc");
  const projectFile = join(projectDir, "opencode-memnet.jsonc");
  writeFileSync(globalFile, JSON.stringify({ serverUrl: "http://global", apiKey: "global-key" }));
  writeFileSync(
    projectFile,
    `{
  // Project enrollment config
  "apiKey": "NEWUSER_API_KEY",
  "profileId": "phrkr",
  "chatMessage": { "maxMemories": 7 }
}`
  );

  const script = `
process.env.HOME = ${JSON.stringify(home)};
process.env.USERPROFILE = ${JSON.stringify(home)};
const clientConfig = await import(${JSON.stringify(clientConfigUrl)});
clientConfig.initClientConfig(${JSON.stringify(project)});
await clientConfig.rewriteClientApiKeySource("generated-profile-key");
console.log(JSON.stringify({
  config: clientConfig.CLIENT_CONFIG,
  sources: clientConfig.CLIENT_CONFIG_SOURCES,
  projectFile: await Bun.file(${JSON.stringify(projectFile)}).text(),
  globalFile: await Bun.file(${JSON.stringify(globalFile)}).text(),
}));
`;
  const result = Bun.spawnSync({
    cmd: [process.execPath, "--eval", script],
    env: { ...process.env, HOME: home, USERPROFILE: home },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = Buffer.from(result.stdout).toString("utf8").trim();
  const stderr = Buffer.from(result.stderr).toString("utf8").trim();
  if (result.exitCode !== 0) throw new Error(stderr || stdout);
  return JSON.parse(stdout);
}

function runRewriteScenario(projectFileContent: string) {
  const home = mkdtempSync(join(tmpdir(), "memnet-newuser-home-"));
  const project = mkdtempSync(join(tmpdir(), "memnet-newuser-project-"));
  tempDirs.push(home, project);
  const projectDir = join(project, ".opencode");
  mkdirSync(projectDir, { recursive: true });
  const projectFile = join(projectDir, "opencode-memnet.jsonc");
  writeFileSync(projectFile, projectFileContent);

  const script = `
process.env.HOME = ${JSON.stringify(home)};
process.env.USERPROFILE = ${JSON.stringify(home)};
const clientConfig = await import(${JSON.stringify(clientConfigUrl)});
clientConfig.initClientConfig(${JSON.stringify(project)});
await clientConfig.rewriteClientApiKeySource("generated-profile-key");
console.log(JSON.stringify({
  config: clientConfig.CLIENT_CONFIG,
  sources: clientConfig.CLIENT_CONFIG_SOURCES,
  projectFile: await Bun.file(${JSON.stringify(projectFile)}).text(),
  sourceFile: await Bun.file(clientConfig.CLIENT_CONFIG_SOURCES.apiKey).text(),
}));
`;
  const result = Bun.spawnSync({
    cmd: [process.execPath, "--eval", script],
    env: { ...process.env, HOME: home, USERPROFILE: home },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = Buffer.from(result.stdout).toString("utf8").trim();
  const stderr = Buffer.from(result.stderr).toString("utf8").trim();
  if (result.exitCode !== 0) throw new Error(stderr || stdout);
  return JSON.parse(stdout);
}

function runRemoteClientRewriteFailureScenario() {
  const script = `
import { mock } from "bun:test";

const warnings = [];
let authorizationHeader;

mock.module(${JSON.stringify(clientConfigUrl)}, () => ({
  CLIENT_CONFIG: {
    serverUrl: "https://memory.example",
    apiKey: "NEWUSER_API_KEY",
    profileId: "phrkr",
  },
  rewriteClientApiKeySource: async () => {
    throw new Error("permission denied");
  },
}));

mock.module(${JSON.stringify(loggerUrl)}, () => ({
  log: () => {},
  logDebug: () => {},
  logWarn: (message, data) => warnings.push({ message, data }),
  initLogger: () => {},
}));

const originalFetch = globalThis.fetch;
globalThis.fetch = async (_url, init) => {
  authorizationHeader = init?.headers?.Authorization;
  return new Response(JSON.stringify({
    success: true,
    data: {
      firstTime: true,
      daysSinceLastSeen: null,
      welcomeBack: false,
      stats: null,
      principal: { kind: "profile", profileId: "phrkr" },
      enrollment: { profileId: "phrkr", apiKey: "generated-profile-key" },
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
};

try {
  const { RemoteMemoryClient } = await import(${JSON.stringify(remoteClientUrl)});
  const client = new RemoteMemoryClient("https://memory.example", "NEWUSER_API_KEY", "client-id");
  const result = await client.clientConnect("client-id", {});
  await client.getClientStats("client-id");
  console.log(JSON.stringify({ result, warnings, authorizationHeader }));
} finally {
  globalThis.fetch = originalFetch;
}
`;
  const result = Bun.spawnSync({
    cmd: [process.execPath, "--eval", script],
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = Buffer.from(result.stdout).toString("utf8").trim();
  const stderr = Buffer.from(result.stderr).toString("utf8").trim();
  if (result.exitCode !== 0) throw new Error(stderr || stdout);
  return JSON.parse(stdout);
}

describe("plugin NEWUSER_API_KEY enrollment config rewrite", () => {
  it("records the apiKey source file and rewrites only that file", () => {
    const result = runScenario();

    expect(result.config.profileId).toBe("phrkr");
    expect(result.sources.apiKey).toEndWith(".opencode/opencode-memnet.jsonc");
    expect(result.projectFile).toContain('"apiKey": "generated-profile-key"');
    expect(result.projectFile).toContain('"profileId": "phrkr"');
    expect(result.projectFile).toContain('"maxMemories": 7');
    expect(result.globalFile).toContain('"apiKey":"global-key"');
  });

  it("rewrites only the top-level apiKey and ignores commented or nested apiKey text", () => {
    const result = runRewriteScenario(`{
  // "apiKey": "commented-bootstrap",
  "profileId": "phrkr",
  "metadata": { "apiKey": "nested-value" },
  "apiKey": "NEWUSER_API_KEY",
}`);

    expect(result.config.apiKey).toBe("generated-profile-key");
    expect(result.projectFile).toContain('// "apiKey": "commented-bootstrap"');
    expect(result.projectFile).toContain('"metadata": { "apiKey": "nested-value" }');
    expect(result.projectFile).toContain('"apiKey": "generated-profile-key"');
    expect(result.projectFile).not.toContain('"apiKey": "NEWUSER_API_KEY"');
  });

  it("adds a missing top-level apiKey to JSONC that already has a trailing comma", () => {
    const result = runRewriteScenario(`{
  "profileId": "phrkr",
}`);

    expect(result.config.apiKey).toBe("generated-profile-key");
    expect(result.sourceFile).toContain('"profileId": "phrkr",');
    expect(result.sourceFile).toContain('"apiKey": "generated-profile-key"');
  });

  it("keeps enrollment usable when config persistence fails", () => {
    const result = runRemoteClientRewriteFailureScenario();

    expect(result.result.success).toBe(true);
    expect(result.result.data.principal).toEqual({ kind: "profile", profileId: "phrkr" });
    expect(result.authorizationHeader).toBe("Bearer generated-profile-key");
    expect(result.warnings[0].message).toContain("Failed to persist enrolled profile API key");
    expect(JSON.stringify(result.warnings)).not.toContain("generated-profile-key");
  });
});
