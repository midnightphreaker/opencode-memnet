import {
  appendFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  statSync,
  renameSync,
  unlinkSync,
} from "fs";
import { homedir } from "os";
import { join } from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogLevel = "debug" | "info" | "warn" | "error";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MAX_LOG_SIZE = 5 * 1024 * 1024;
const GLOBAL_LOGGER_KEY = Symbol.for("opencode-memnet.logger.initialized");
const GLOBAL_LEVEL_KEY = Symbol.for("opencode-memnet.logger.level");

// ---------------------------------------------------------------------------
// ANSI colors (no-op when not a TTY — safe for non-terminals)
// ---------------------------------------------------------------------------

const ANSI = {
  reset: "\x1b[0m",
  gray: "\x1b[90m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
};

// ---------------------------------------------------------------------------
// Log file helpers (preserved from original)
// ---------------------------------------------------------------------------

function getLogFilePath(): string {
  return (
    process.env.OPENCODE_MEM_LOG_FILE || join(homedir(), ".opencode-memnet", "opencode-memnet.log")
  );
}

function getLogDirPath(): string {
  const logFile = getLogFilePath();
  const lastSlash = Math.max(logFile.lastIndexOf("/"), logFile.lastIndexOf("\\"));
  return lastSlash === -1 ? "." : logFile.slice(0, lastSlash);
}

function rotateLog() {
  const logFile = getLogFilePath();
  try {
    if (!existsSync(logFile)) return;
    const stats = statSync(logFile);
    if (stats.size < MAX_LOG_SIZE) return;

    const oldLog = logFile + ".old";
    if (existsSync(oldLog)) unlinkSync(oldLog);
    renameSync(logFile, oldLog);
  } catch {
    // rotation failure is non-fatal
  }
}

function ensureFileInitialized() {
  if ((globalThis as any)[GLOBAL_LOGGER_KEY]) return;
  const logDir = getLogDirPath();
  const logFile = getLogFilePath();
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
  rotateLog();
  writeFileSync(logFile, `\n--- Session started: ${new Date().toISOString()} ---\n`, {
    flag: "a",
  });
  (globalThis as any)[GLOBAL_LOGGER_KEY] = true;
}

// ---------------------------------------------------------------------------
// Level resolution (lazy singleton)
// ---------------------------------------------------------------------------

function resolveLevelFromEnv(): LogLevel {
  const envLevel = process.env.LOG_LEVEL;
  if (envLevel && envLevel in LEVEL_ORDER) {
    return envLevel as LogLevel;
  }
  const debug = process.env.DEBUG;
  if (debug === "true" || debug === "1") {
    return "debug";
  }
  return "info";
}

function getCachedLevel(): LogLevel {
  if ((globalThis as any)[GLOBAL_LEVEL_KEY] === undefined) {
    (globalThis as any)[GLOBAL_LEVEL_KEY] = resolveLevelFromEnv();
  }
  return (globalThis as any)[GLOBAL_LEVEL_KEY] as LogLevel;
}

// ---------------------------------------------------------------------------
// Core write
// ---------------------------------------------------------------------------

function writeLog(level: LogLevel, message: string, data?: unknown): void {
  ensureFileInitialized();

  const timestamp = new Date().toISOString();
  const levelUpper = level.toUpperCase();

  // --- File: always write ALL levels (verbose) ---
  const fileLine = data
    ? `[${timestamp}] [${levelUpper}] ${message}: ${JSON.stringify(data)}\n`
    : `[${timestamp}] [${levelUpper}] ${message}\n`;
  appendFileSync(getLogFilePath(), fileLine);

  // --- Console: filtered by current log level ---
  const currentLevel = getCachedLevel();
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) {
    return; // suppressed
  }

  const dataStr = data !== undefined ? " " + JSON.stringify(data) : "";
  const consoleLine = `[opencode-memnet] [${levelUpper}] ${message}${dataStr}`;

  const useColor = typeof process.stderr?.isTTY === "boolean" ? process.stderr.isTTY : false;

  let colored: string;
  switch (level) {
    case "debug":
      colored = useColor ? `${ANSI.gray}${consoleLine}${ANSI.reset}` : consoleLine;
      break;
    case "warn":
      colored = useColor ? `${ANSI.yellow}${consoleLine}${ANSI.reset}` : consoleLine;
      break;
    case "error":
      colored = useColor ? `${ANSI.red}${consoleLine}${ANSI.reset}` : consoleLine;
      break;
    default:
      colored = consoleLine;
  }

  if (level === "warn" || level === "error") {
    console.error(colored);
  } else {
    console.log(colored);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function logDebug(message: string, data?: unknown): void {
  writeLog("debug", message, data);
}

export function logInfo(message: string, data?: unknown): void {
  writeLog("info", message, data);
}

export function logWarn(message: string, data?: unknown): void {
  writeLog("warn", message, data);
}

export function logError(message: string, data?: unknown): void {
  writeLog("error", message, data);
}

/**
 * Backward-compatible alias — maps to logInfo.
 * Existing code calling `log("msg")` keeps working.
 */
export function log(message: string, data?: unknown): void {
  writeLog("info", message, data);
}

/**
 * Initialize (or re-initialize) the logger.
 * Passing `{ level }` overrides the env-var–derived level.
 */
export function initLogger(opts?: { level?: LogLevel }): void {
  if (opts?.level) {
    (globalThis as any)[GLOBAL_LEVEL_KEY] = opts.level;
  }
  ensureFileInitialized();
}

/**
 * Return the currently active log level.
 */
export function getLogLevel(): LogLevel {
  return getCachedLevel();
}
