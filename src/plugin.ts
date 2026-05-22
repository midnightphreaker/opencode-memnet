// src/plugin.ts — Phase 4 update
import type { PluginModule } from "@opencode-ai/plugin";
import pkg from "../package.json" with { type: "json" };

export const id =
  typeof pkg.name === "string" && pkg.name.trim() ? pkg.name.trim() : "opencode-mem";

async function resolvePlugin() {
  try {
    const { initClientConfig, isClientConfigured } = await import("./config.js");
    initClientConfig(process.cwd());
    if (isClientConfigured()) {
      const { OpenCodeMemPlugin } = await import("./index-remote.js");
      console.log("[opencode-mem] Using remote server-client mode");
      return OpenCodeMemPlugin;
    }
  } catch {
    /* fall through */
  }

  console.warn(
    "[opencode-mem] Using legacy in-process mode. Configure serverUrl + apiKey for server-client mode."
  );
  const { OpenCodeMemPlugin } = await import("./index.js");
  return OpenCodeMemPlugin;
}

const OpenCodeMemPlugin = await resolvePlugin();
export { OpenCodeMemPlugin };
export default { id, server: OpenCodeMemPlugin } satisfies PluginModule;
