// plugin/src/plugin.ts — Remote-mode ONLY entry point
import type { PluginModule } from "@opencode-ai/plugin";

export const id = "opencode-memnet";

async function resolvePlugin() {
  const { initClientConfig, isClientConfigured } = await import("../../shared/client-config.js");
  // First init with cwd for default config gating. index-remote.ts re-inits with correct ctx.directory for actual config loading.
  initClientConfig(process.cwd());

  if (!isClientConfigured()) {
    console.warn(
      "[opencode-memnet] Not configured. Set serverUrl + apiKey in " +
        "~/.config/opencode/opencode-memnet.jsonc or .opencode/opencode-memnet.jsonc"
    );
    return {};
  }

  const { OpenCodeMemPlugin } = await import("./index-remote.js");
  console.log("[opencode-memnet] Remote server-client mode active");
  return OpenCodeMemPlugin;
}

const OpenCodeMemPlugin = await resolvePlugin();
export { OpenCodeMemPlugin };
export default { id, server: OpenCodeMemPlugin } satisfies PluginModule;
