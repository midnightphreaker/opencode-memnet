// src/server.ts — Standalone server entry point
import { initServerConfig, validateServerConfig } from "./server-config.js";
import { initializeStorage } from "./services/storage/factory.js";
import { embeddingService } from "./services/embedding.js";
import { setDbConnected } from "./services/health-handler.js";
import { startWebServer, getActiveRequestCount } from "./services/web-server.js";
import { logInfo, logWarn, logError, logDebug, initLogger } from "./services/logger.js";

async function main(): Promise<void> {
  // 1. Load and validate config
  const config = initServerConfig();
  const errors = validateServerConfig(config);
  if (errors.length > 0) {
    console.error("Configuration errors:");
    errors.forEach((e) => console.error("  -", e));
    process.exit(1);
  }

  // Bridge server config into global CONFIG for storage/embedding layers
  const { serverConfigToGlobalConfig } = await import("./config.js");
  serverConfigToGlobalConfig(config);

  // Initialize leveled logger
  initLogger({ level: config.logLevel });
  logInfo("opencode-memnet server starting...", {
    port: config.port,
    host: config.host,
    logLevel: config.logLevel,
  });

  // 2. Initialize storage (runs DB migrations)
  try {
    await initializeStorage();
    setDbConnected(true);
    logInfo("Storage initialized (migrations complete)");
  } catch (error) {
    console.error("Failed to initialize storage:", error);
    process.exit(1);
  }

  // 3. Warm up embedding service
  try {
    await embeddingService.warmup();
    logInfo("Embedding service ready");
  } catch (error) {
    console.error("Failed to warm up embedding service:", error);
    process.exit(1);
  }

  // 4. Start HTTP server
  try {
    const server = await startWebServer(
      {
        port: config.port,
        host: config.host,
        enabled: true,
        allowedOrigin: config.webServerAllowedOrigin,
      },
      config.serverApiKey,
      {
        disableWebuiAuth: config.disableWebuiAuth,
        disableClientAuth: config.disableClientAuth,
      }
    );

    logInfo(`Server listening on http://${config.host}:${config.port}`);
    logInfo(`WebUI: http://${config.host}:${config.port}/`);
    logInfo(`Health: http://${config.host}:${config.port}/api/health`);

    if (config.disableWebuiAuth) {
      logWarn("DISABLE_WEBUI_AUTH is enabled — WebUI does not require API key authentication");
    }
    if (config.disableClientAuth) {
      logWarn(
        "DISABLE_CLIENT_AUTH is enabled — client API does not require API key authentication"
      );
    }

    logInfo("Server ready", {
      port: config.port,
      host: config.host,
      auth: config.serverApiKey ? "enabled" : "disabled",
      webuiAuth: config.disableWebuiAuth ? "disabled" : "enabled",
      clientAuth: config.disableClientAuth ? "disabled" : "enabled",
    });

    // Start background tag migration (perpetual loop)
    if (!config._tagMigrationDisabled) {
      const { runTagMigration } = await import("./services/tag-migration-service.js");
      runTagMigration().catch((err) =>
        logError("Tag migration loop error", { error: String(err) })
      );
    } else {
      logWarn("Tag migration disabled: MEMORY_MODEL/MEMORY_API_URL not configured");
    }

    // 5. Graceful shutdown
    const shutdown = async () => {
      logInfo("Shutting down...");
      try {
        await server.stop();
      } catch (e) {
        logError("Error stopping server", { error: String(e) });
      }

      // Drain: wait for in-flight requests to complete (with timeout)
      const drainSeconds = parseInt(process.env.DRAIN_TIMEOUT_SECONDS || "10", 10);
      const drainMs = drainSeconds * 1000;
      const pollInterval = 500;
      let elapsed = 0;
      logInfo(
        `Draining in-flight requests (max ${drainSeconds}s, current: ${getActiveRequestCount()})...`
      );
      while (getActiveRequestCount() > 0 && elapsed < drainMs) {
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
        elapsed += pollInterval;
      }
      if (getActiveRequestCount() > 0) {
        logInfo(`Drain timeout reached with ${getActiveRequestCount()} requests still active`);
      } else {
        logInfo("All in-flight requests completed");
      }

      try {
        const { stopMigration } = await import("./services/tag-migration-service.js");
        stopMigration();
      } catch (e) {
        logError("Error stopping migration", { error: String(e) });
      }
      try {
        const { closeStorage } = await import("./services/storage/factory.js");
        await closeStorage();
      } catch (e) {
        logError("Error closing storage", { error: String(e) });
      }
      process.exit(0);
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

main();
