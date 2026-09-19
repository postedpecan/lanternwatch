import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

import {
  loadHostedMigrations,
  runHostedMigrations,
} from "../lib/server/hosted/migration-runner.ts";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error(
    "TEST_DATABASE_URL is required. Point it only at a disposable PostgreSQL 17 database or branch; production databases are forbidden.",
  );
}

const bootstrap = await readFile(
  path.join(process.cwd(), "lib/server/hosted/bootstrap/001_roles.sql"),
  "utf8",
);
const migrations = await loadHostedMigrations(
  path.join(process.cwd(), "lib/server/hosted/migrations"),
);
const admin = new pg.Client({ connectionString: url });
const pool = new pg.Pool({ connectionString: url, max: 2 });
await admin.connect();

try {
  const existing = await admin.query("SELECT to_regnamespace('hosted') AS schema_name");
  if (existing.rows[0]?.schema_name) {
    throw new Error("Refusing to use TEST_DATABASE_URL because the hosted schema already exists; use a fresh disposable PostgreSQL 17 database or branch.");
  }
  await admin.query(bootstrap);

  const migrationPool = {
    async connect() {
      const client = await pool.connect();
      try {
        await client.query("SET ROLE hosted_migrator");
        return {
          query: (text, values) => client.query(text, values),
          async release() {
            try {
              await client.query("RESET ROLE");
            } finally {
              client.release();
            }
          },
        };
      } catch (error) {
        client.release();
        throw error;
      }
    },
  };
  const outcomes = await Promise.all([
    runHostedMigrations(migrationPool, migrations),
    runHostedMigrations(migrationPool, migrations),
  ]);
  assert.equal(outcomes.flatMap((outcome) => outcome.applied).length, 1, "advisory locking must apply each migration once");

  const roleProof = await admin.query(`
    SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolreplication, rolbypassrls
    FROM pg_roles WHERE rolname IN ('hosted_app', 'hosted_migrator') ORDER BY rolname
  `);
  assert.equal(roleProof.rows.length, 2);
  for (const role of roleProof.rows) {
    assert.equal(role.rolcanlogin, false);
    assert.equal(role.rolsuper, false);
    assert.equal(role.rolcreatedb, false);
    assert.equal(role.rolcreaterole, false);
    assert.equal(role.rolinherit, false);
    assert.equal(role.rolreplication, false);
    assert.equal(role.rolbypassrls, false);
  }
  assert.equal((await admin.query("SELECT pg_has_role('hosted_app', 'hosted_migrator', 'MEMBER') AS can_set_migrator")).rows[0].can_set_migrator, false);

  await admin.query(`
    INSERT INTO hosted.users(id, auth_subject) VALUES
      ('10000000-0000-4000-8000-000000000001', 'integration-a'),
      ('10000000-0000-4000-8000-000000000002', 'integration-b');
    INSERT INTO hosted.workspaces(id, kind, personal_owner_user_id) VALUES
      ('20000000-0000-4000-8000-000000000001', 'personal', '10000000-0000-4000-8000-000000000001'),
      ('20000000-0000-4000-8000-000000000002', 'personal', '10000000-0000-4000-8000-000000000002');
    INSERT INTO hosted.projects(id, workspace_id, display_name, created_by_user_id) VALUES
      ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'A', '10000000-0000-4000-8000-000000000001'),
      ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'B', '10000000-0000-4000-8000-000000000002')
  `);
  await admin.query("INSERT INTO hosted.devices(id, workspace_id, display_name, state) VALUES ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'B', 'active')");
  await assert.rejects(admin.query(`
    INSERT INTO hosted.runs(
      id, workspace_id, project_id, device_id, agent_instance_id,
      agent_platform, agent_role, status, started_at, last_occurred_at
    ) VALUES (
      '60000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000002',
      '70000000-0000-4000-8000-000000000001',
      'codex', 'worker', 'working', now(), now()
    )
  `));
  await admin.query("SET ROLE hosted_app");
  assert.equal((await admin.query("SELECT id FROM hosted.projects")).rows.length, 0);
  await admin.query("BEGIN");
  await admin.query("SELECT set_config('lanternwatch.workspace_id', $1, true)", ["20000000-0000-4000-8000-000000000001"]);
  assert.equal((await admin.query("SELECT id FROM hosted.projects")).rows.length, 1);
  await assert.rejects(
    admin.query("INSERT INTO hosted.projects(id, workspace_id, display_name, created_by_user_id) VALUES ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', 'Escape', '10000000-0000-4000-8000-000000000001')"),
  );
  await admin.query("ROLLBACK");
  await admin.query("RESET ROLE");

  console.log("PostgreSQL 17 hosted integration passed: roles, concurrent migrations, constraints, and RLS.");
} finally {
  await pool.end();
  await admin.end();
}
