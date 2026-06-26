#!/usr/bin/env bun

import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const V1_DATA_TABLES = [
  "memory_tag_links",
  "memory_tag_aliases",
  "memory_tags",
  "user_profile_changelogs",
  "user_profiles",
  "user_prompts",
  "memories",
  "profile_repo_links",
  "git_repositories",
  "ai_messages",
  "ai_sessions",
  "clients",
  "profile_api_keys",
] as const;

const RESTORE_VERIFY_COMMAND = "pg_restore --list";
const BACKUP_PREFIX = "backups/opencode-memnet-v1-";

function utcTimestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function run(command: string, args: string[], options: { input?: string } = {}) {
  const result = spawnSync(command, args, {
    encoding: options.input ? "utf8" : undefined,
    input: options.input,
    stdio: options.input ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString("utf8")
      : String(result.stderr ?? "");
    throw new Error(`${command} failed: ${stderr.trim() || `exit ${result.status}`}`);
  }
  return result.stdout;
}

function buildResetSql(): string {
  const tableList = V1_DATA_TABLES.map((table) => `'${table}'`).join(", ");
  return `
BEGIN;
DO $$
DECLARE
  reset_tables text[];
BEGIN
  SELECT array_agg(format('%I', table_name))
    INTO reset_tables
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN (${tableList});

  IF reset_tables IS NOT NULL AND array_length(reset_tables, 1) > 0 THEN
    EXECUTE 'TRUNCATE TABLE ' || array_to_string(reset_tables, ', ') || ' RESTART IDENTITY CASCADE';
  END IF;
END $$;
COMMIT;
`;
}

function main() {
  mkdirSync("backups", { recursive: true });
  const backupPath = `${BACKUP_PREFIX}${utcTimestamp()}.dump`;
  const postgresUrl = process.env.POSTGRES_URL;

  if (postgresUrl) {
    run("pg_dump", ["--format=custom", "--file", backupPath, postgresUrl]);
  } else {
    const user = process.env.POSTGRES_USER || "opencode";
    const database = process.env.POSTGRES_DB || "opencode_mem";
    const stdout = run("docker", [
      "compose",
      "exec",
      "-T",
      "db",
      "pg_dump",
      "-U",
      user,
      "-d",
      database,
      "--format=custom",
      "--file=-",
    ]);
    writeFileSync(backupPath, stdout);
  }

  run("pg_restore", ["--list", backupPath]);

  const resetSql = buildResetSql();
  if (postgresUrl) {
    run("psql", [postgresUrl], { input: resetSql });
  } else {
    const user = process.env.POSTGRES_USER || "opencode";
    const database = process.env.POSTGRES_DB || "opencode_mem";
    run("docker", ["compose", "exec", "-T", "db", "psql", "-U", user, "-d", database], {
      input: resetSql,
    });
  }

  console.log(`Backup verified with ${RESTORE_VERIFY_COMMAND}: ${backupPath}`);
  console.log(`Reset v1 tables: ${V1_DATA_TABLES.join(", ")}`);
}

main();
