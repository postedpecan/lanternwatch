import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { HostedDatabasePool, HostedQueryable } from "./database.ts";

const MIGRATION_NAME = /^([0-9]*[1-9][0-9]*)_([a-z0-9][a-z0-9_-]*)\.sql$/;
const MIGRATION_LOCK_KEY = 1_287_341_197;

export type HostedMigration = Readonly<{
  version: number;
  name: string;
  sql: string;
  checksum: string;
}>;

export type MigrationRunResult = Readonly<{
  applied: readonly string[];
  alreadyApplied: readonly string[];
  postgresMajor: number;
}>;

function checksum(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

export async function loadHostedMigrations(directory: string): Promise<readonly HostedMigration[]> {
  const names = (await readdir(directory)).filter((name) => name.endsWith(".sql"));
  const parsed = names.map((name) => {
    const match = MIGRATION_NAME.exec(name);
    if (!match) {
      throw new Error(`Invalid hosted migration filename: ${name}`);
    }
    return { name, version: Number(match[1]) };
  });
  parsed.sort((left, right) => left.version - right.version);

  const versions = new Set<number>();
  const migrations: HostedMigration[] = [];
  for (const item of parsed) {
    if (versions.has(item.version)) {
      throw new Error(`Duplicate hosted migration version: ${item.version}`);
    }
    versions.add(item.version);
    const sql = await readFile(path.join(directory, item.name), "utf8");
    migrations.push(Object.freeze({ ...item, sql, checksum: checksum(sql) }));
  }
  return Object.freeze(migrations);
}

export async function assertPostgresMajor(
  database: HostedQueryable,
  expectedMajor = 17,
): Promise<number> {
  const result = await database.query<{ server_version_num: string }>(
    "SELECT current_setting('server_version_num') AS server_version_num",
  );
  const versionNumber = result.rows[0]?.server_version_num;
  const major = versionNumber ? Math.floor(Number(versionNumber) / 10_000) : Number.NaN;
  if (major !== expectedMajor) {
    throw new Error(
      `Hosted PostgreSQL major mismatch: expected ${expectedMajor}, received ${versionNumber ?? "unknown"}`,
    );
  }
  return major;
}

export async function runHostedMigrations(
  pool: HostedDatabasePool,
  migrations: readonly HostedMigration[],
  options: Readonly<{ expectedMajor?: number }> = {},
): Promise<MigrationRunResult> {
  const database = await pool.connect();
  const applied: string[] = [];
  const alreadyApplied: string[] = [];
  let transactionStarted = false;

  try {
    const postgresMajor = await assertPostgresMajor(database, options.expectedMajor ?? 17);
    await database.query("BEGIN");
    transactionStarted = true;
    await database.query("SET LOCAL lock_timeout = '5s'");
    await database.query("SET LOCAL statement_timeout = '60s'");
    await database.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);
    await database.query("CREATE SCHEMA IF NOT EXISTS hosted");
    await database.query(`
      CREATE TABLE IF NOT EXISTS hosted.schema_migrations (
        version bigint PRIMARY KEY CHECK (version > 0),
        name text NOT NULL UNIQUE,
        checksum char(64) NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
        applied_at timestamptz NOT NULL DEFAULT transaction_timestamp()
      )
    `);

    const rows = await database.query<{ version: string | number; name: string; checksum: string }>(
      "SELECT version, name, checksum FROM hosted.schema_migrations ORDER BY version",
    );
    const recorded = new Map(rows.rows.map((row) => [Number(row.version), row]));
    const availableVersions = new Set(migrations.map((migration) => migration.version));
    for (const [version, previous] of recorded) {
      if (!availableVersions.has(version)) {
        throw new Error(
          `Hosted migration ${version} (${previous.name}) is recorded but its migration file is missing`,
        );
      }
    }
    const highestRecordedVersion = Math.max(0, ...recorded.keys());

    for (const migration of migrations) {
      const previous = recorded.get(migration.version);
      if (previous) {
        if (previous.name !== migration.name || previous.checksum !== migration.checksum) {
          throw new Error(
            `Hosted migration ${migration.version} checksum mismatch; recorded ${previous.checksum}, current ${migration.checksum}`,
          );
        }
        alreadyApplied.push(migration.name);
        continue;
      }
      if (migration.version < highestRecordedVersion) {
        throw new Error(
          `Hosted migration ${migration.version} cannot be inserted before recorded version ${highestRecordedVersion}`,
        );
      }

      if (database.exec) {
        await database.exec(migration.sql);
      } else {
        await database.query(migration.sql);
      }
      await database.query(
        "INSERT INTO hosted.schema_migrations(version, name, checksum) VALUES ($1, $2, $3)",
        [migration.version, migration.name, migration.checksum],
      );
      applied.push(migration.name);
    }

    await database.query("COMMIT");
    transactionStarted = false;
    return Object.freeze({ applied, alreadyApplied, postgresMajor });
  } catch (error) {
    if (transactionStarted) {
      try {
        await database.query("ROLLBACK");
      } catch {
        // Preserve the migration error. A broken connection is handled by the caller.
      }
    }
    throw error;
  } finally {
    await database.release();
  }
}
