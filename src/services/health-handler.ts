// src/services/health-handler.ts
import { readFileSync } from "fs";
import { embeddingService } from "./embedding.js";

const { version } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf-8")
);

let _dbConnected = false;
const _startTime = Date.now();

export function setDbConnected(value: boolean): void {
  _dbConnected = value;
}

export function handleHealthPublic(): { status: "ok" | "degraded" } {
  const embReady = embeddingService.isWarmedUp;
  return {
    status: _dbConnected && embReady ? "ok" : "degraded",
  };
}

export function handleHealthDetailed(): {
  status: string;
  version: string;
  dbConnected: boolean;
  embeddingReady: boolean;
  uptime: number;
} {
  const embReady = embeddingService.isWarmedUp;
  return {
    status: _dbConnected && embReady ? "ok" : "degraded",
    version,
    dbConnected: _dbConnected,
    embeddingReady: embReady,
    uptime: Date.now() - _startTime,
  };
}
