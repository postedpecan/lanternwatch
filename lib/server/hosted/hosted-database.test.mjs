import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

import {
  loadHostedMigrations,
  runHostedMigrations,
} from "./migration-runner.ts";
import {
  validateServerTenantContext,
  withHostedTenantTransaction,
} from "./repository.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(HERE, "migrations");
const BOOTSTRAP = path.join(HERE, "bootstrap", "001_roles.sql");
const IDS = Object.freeze({
  user: "10000000-0000-4000-8000-000000000001",
  otherUser: "10000000-0000-4000-8000-000000000002",
  workspaceA: "20000000-0000-4000-8000-000000000001",
  workspaceB: "20000000-0000-4000-8000-000000000002",
  projectA: "30000000-0000-4000-8000-000000000001",
  projectB: "30000000-0000-4000-8000-000000000002",
  deviceB: "40000000-0000-4000-8000-000000000002",
  principal: "50000000-0000-4000-8000-000000000001",
});

function adapter(database) {
  return {
    query: (text, values) => database.query(text, values ? [...values] : undefined),
    exec: (sql) => database.exec(sql),
  };
}

function poolAdapter(database, hooks = {}) {
  return {
    async connect() {
      hooks.connect?.();
      return {
        ...adapter(database),
        release() {
          hooks.release?.();
        },
      };
    },
  };
}

async function fixture() {
  const database = new PGlite();
  await database.waitReady;
  await database.exec(await readFile(BOOTSTRAP, "utf8"));
  await database.exec("SET ROLE hosted_migrator");
  const migrations = await loadHostedMigrations(MIGRATIONS);
  await runHostedMigrations(poolAdapter(database), migrations);
  await database.exec("RESET ROLE");
  return { database, migrations };
}

async function seedTwoPersonalTenants(database) {
  await database.query(
    "INSERT INTO hosted.users(id, auth_subject) VALUES ($1, 'auth-a'), ($2, 'auth-b')",
    [IDS.user, IDS.otherUser],
  );
  await database.query(
    "INSERT INTO hosted.workspaces(id, kind, personal_owner_user_id) VALUES ($1, 'personal', $2), ($3, 'personal', $4)",
    [IDS.workspaceA, IDS.user, IDS.workspaceB, IDS.otherUser],
  );
  await database.query(
    "INSERT INTO hosted.projects(id, workspace_id, display_name, created_by_user_id) VALUES ($1, $2, 'Private A', $3), ($4, $5, 'Private B', $6)",
    [IDS.projectA, IDS.workspaceA, IDS.user, IDS.projectB, IDS.workspaceB, IDS.otherUser],
  );
}

test("PGlite 0.4.1 runs PostgreSQL 17 and clean migrations are repeatable", async (t) => {
  const packageJson = JSON.parse(await readFile(path.join(HERE, "../../../node_modules/@electric-sql/pglite/package.json"), "utf8"));
  assert.equal(packageJson.version, "0.4.1");

  const { database, migrations } = await fixture();
  t.after(() => database.close());
  assert.equal(migrations.length, 1);

  await database.exec("SET ROLE hosted_migrator");
  const repeated = await runHostedMigrations(poolAdapter(database), migrations);
  await database.exec("RESET ROLE");
  assert.deepEqual(repeated.applied, []);
  assert.deepEqual(repeated.alreadyApplied, ["001_core.sql"]);
  assert.equal(repeated.postgresMajor, 17);
});

test("migration runner owns one checked-out client and always releases it", async (t) => {
  const { database, migrations } = await fixture();
  t.after(() => database.close());
  let connects = 0;
  let releases = 0;

  await database.exec("SET ROLE hosted_migrator");
  await runHostedMigrations(poolAdapter(database, {
    connect: () => connects += 1,
    release: () => releases += 1,
  }), migrations);
  await database.exec("RESET ROLE");

  assert.equal(connects, 1);
  assert.equal(releases, 1);
});

test("migration runner rejects a recorded migration whose file is missing", async (t) => {
  const { database } = await fixture();
  t.after(() => database.close());

  await database.exec("SET ROLE hosted_migrator");
  await assert.rejects(
    runHostedMigrations(poolAdapter(database), []),
    /migration file is missing/,
  );
  await database.exec("RESET ROLE");
});

test("migration and tenant transaction clients release when BEGIN fails", async () => {
  function beginFailurePool(counter) {
    return {
      async connect() {
        counter.connects += 1;
        return {
          async query(text) {
            if (text.includes("server_version_num")) {
              return { rows: [{ server_version_num: "170005" }] };
            }
            if (text === "BEGIN") throw new Error("begin failed");
            return { rows: [] };
          },
          release() {
            counter.releases += 1;
          },
        };
      },
    };
  }

  const migrationCounter = { connects: 0, releases: 0 };
  await assert.rejects(runHostedMigrations(beginFailurePool(migrationCounter), []), /begin failed/);
  assert.deepEqual(migrationCounter, { connects: 1, releases: 1 });

  const tenantCounter = { connects: 0, releases: 0 };
  const context = validateServerTenantContext({
    workspaceId: IDS.workspaceA,
    principalId: IDS.principal,
    principalKind: "user_session",
  });
  await assert.rejects(
    withHostedTenantTransaction(beginFailurePool(tenantCounter), context, async () => undefined),
    /begin failed/,
  );
  assert.deepEqual(tenantCounter, { connects: 1, releases: 1 });
});

test("role bootstrap repairs pre-existing privilege and membership drift", async (t) => {
  const database = new PGlite();
  await database.waitReady;
  t.after(() => database.close());
  await database.exec(`
    CREATE ROLE hosted_migrator LOGIN REPLICATION;
    CREATE ROLE hosted_app LOGIN REPLICATION;
    GRANT hosted_migrator TO hosted_app;
  `);
  await database.exec(await readFile(BOOTSTRAP, "utf8"));

  const roles = await database.query(`
    SELECT rolname, rolcanlogin, rolreplication, rolbypassrls
    FROM pg_roles
    WHERE rolname IN ('hosted_app', 'hosted_migrator')
    ORDER BY rolname
  `);
  assert.equal(roles.rows.length, 2);
  for (const role of roles.rows) {
    assert.equal(role.rolcanlogin, false);
    assert.equal(role.rolreplication, false);
    assert.equal(role.rolbypassrls, false);
  }
  const membership = await database.query(
    "SELECT pg_has_role('hosted_app', 'hosted_migrator', 'MEMBER') AS can_set_migrator",
  );
  assert.equal(membership.rows[0].can_set_migrator, false);
});

test("existing tenant data survives a repeated migration run", async (t) => {
  const { database, migrations } = await fixture();
  t.after(() => database.close());
  await seedTwoPersonalTenants(database);

  await database.exec("SET ROLE hosted_migrator");
  await runHostedMigrations(poolAdapter(database), migrations);
  await database.exec("RESET ROLE");
  const result = await database.query("SELECT display_name FROM hosted.projects ORDER BY display_name");
  assert.deepEqual(result.rows.map((row) => row.display_name), ["Private A", "Private B"]);
});

test("every tenant table has a non-null boundary and forced RLS", async (t) => {
  const { database } = await fixture();
  t.after(() => database.close());
  const tenantTables = [
    "organizations",
    "organization_memberships",
    "organization_invitations",
    "enrollment_tokens",
    "devices",
    "device_credentials",
    "projects",
    "runs",
    "events",
    "idempotency_records",
    "replay_records",
    "security_audit_events",
    "deletion_markers",
  ];
  const columns = await database.query(`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'hosted' AND column_name = 'workspace_id' AND is_nullable = 'NO'
  `);
  assert.deepEqual(
    columns.rows.map((row) => row.table_name).filter((name) => tenantTables.includes(name)).sort(),
    [...tenantTables].sort(),
  );
  const rls = await database.query(`
    SELECT relname FROM pg_class
    WHERE relnamespace = 'hosted'::regnamespace
      AND relname = ANY($1::text[])
      AND relrowsecurity AND relforcerowsecurity
  `, [["workspaces", ...tenantTables]]);
  assert.deepEqual(rls.rows.map((row) => row.relname).sort(), ["workspaces", ...tenantTables].sort());
});

test("private-beta codes are global and distinct from tenant organization invitations", async (t) => {
  const { database } = await fixture();
  t.after(() => database.close());
  const betaVerifier = new Uint8Array(32).fill(3);
  const organizationVerifier = new Uint8Array(32).fill(4);

  await database.query(
    "INSERT INTO hosted.users(id, auth_subject) VALUES ($1, 'inviter')",
    [IDS.user],
  );
  await database.query(
    "INSERT INTO hosted.workspaces(id, kind) VALUES ($1, 'organization')",
    [IDS.workspaceA],
  );
  await database.query(
    "INSERT INTO hosted.organizations(id, workspace_id, display_name) VALUES ($1, $2, 'Team A')",
    ["21000000-0000-4000-8000-000000000001", IDS.workspaceA],
  );

  await database.query(`
    INSERT INTO hosted.beta_invitations(
      id, token_verifier, max_uses, expires_at
    ) VALUES (
      '22000000-0000-4000-8000-000000000001', $1, 5, now() + interval '7 days'
    )
  `, [betaVerifier]);
  await database.query(`
    INSERT INTO hosted.organization_invitations(
      id, workspace_id, organization_id, token_verifier, role,
      expires_at, created_by_user_id
    ) VALUES (
      '23000000-0000-4000-8000-000000000001', $1, $2, $3, 'member',
      now() + interval '7 days', $4
    )
  `, [IDS.workspaceA, "21000000-0000-4000-8000-000000000001", organizationVerifier, IDS.user]);

  const beta = await database.query(`
    SELECT max_uses, email_constraint, domain_constraint
    FROM hosted.beta_invitations
  `);
  assert.deepEqual(beta.rows, [{ max_uses: 5, email_constraint: null, domain_constraint: null }]);
  const boundaries = await database.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'hosted'
      AND table_name IN ('beta_invitations', 'organization_invitations')
      AND column_name = 'workspace_id'
  `);
  assert.deepEqual(boundaries.rows, [{ table_name: "organization_invitations", column_name: "workspace_id" }]);
});

test("migration checksum drift fails closed", async (t) => {
  const { database, migrations } = await fixture();
  t.after(() => database.close());
  const changed = [{ ...migrations[0], checksum: "0".repeat(64) }];

  await database.exec("SET ROLE hosted_migrator");
  await assert.rejects(
    runHostedMigrations(poolAdapter(database), changed),
    /checksum mismatch/,
  );
  await database.exec("RESET ROLE");
});

test("a failed migration rolls back its schema and ledger entry", async (t) => {
  const database = new PGlite();
  await database.waitReady;
  t.after(() => database.close());
  await database.exec(await readFile(BOOTSTRAP, "utf8"));
  await database.exec("SET ROLE hosted_migrator");
  const broken = Object.freeze([Object.freeze({
    version: 2,
    name: "002_broken.sql",
    checksum: "1".repeat(64),
    sql: "CREATE TABLE hosted.must_rollback(id integer); SELECT definitely_missing_function();",
  })]);
  await assert.rejects(runHostedMigrations(poolAdapter(database), broken));
  await database.exec("RESET ROLE");

  const result = await database.query("SELECT to_regclass('hosted.must_rollback') AS table_name");
  assert.equal(result.rows[0].table_name, null);
});

test("composite foreign keys reject cross-tenant references", async (t) => {
  const { database } = await fixture();
  t.after(() => database.close());
  await seedTwoPersonalTenants(database);
  await database.query(
    "INSERT INTO hosted.devices(id, workspace_id, display_name, state) VALUES ($1, $2, 'Device B', 'active')",
    [IDS.deviceB, IDS.workspaceB],
  );

  await assert.rejects(
    database.query(`
      INSERT INTO hosted.runs(
        id, workspace_id, project_id, device_id, agent_instance_id,
        agent_platform, agent_role, status, started_at, last_occurred_at
      ) VALUES (
        '60000000-0000-4000-8000-000000000001', $1, $2, $3,
        '70000000-0000-4000-8000-000000000001', 'codex', 'worker', 'working', now(), now()
      )
    `, [IDS.workspaceB, IDS.projectA, IDS.deviceB]),
    /runs_project_fk/,
  );
});

test("event idempotency and replay records reject duplicate delivery", async (t) => {
  const { database } = await fixture();
  t.after(() => database.close());
  await seedTwoPersonalTenants(database);
  const digest = new Uint8Array(32).fill(7);
  const nonce = new Uint8Array(32).fill(9);
  await database.query(
    "INSERT INTO hosted.devices(id, workspace_id, display_name, state) VALUES ($1, $2, 'Device A', 'active')",
    ["40000000-0000-4000-8000-000000000001", IDS.workspaceA],
  );
  await database.query(
    "INSERT INTO hosted.device_credentials(id, workspace_id, device_id, verifier) VALUES ($1, $2, $3, $4)",
    ["41000000-0000-4000-8000-000000000001", IDS.workspaceA, "40000000-0000-4000-8000-000000000001", digest],
  );
  await database.query(`
    INSERT INTO hosted.runs(
      id, workspace_id, project_id, device_id, agent_instance_id,
      agent_platform, agent_role, status, started_at, last_occurred_at
    ) VALUES ($1, $2, $3, $4, $5, 'codex', 'worker', 'working', now(), now())
  `, [
    "60000000-0000-4000-8000-000000000001",
    IDS.workspaceA,
    IDS.projectA,
    "40000000-0000-4000-8000-000000000001",
    "70000000-0000-4000-8000-000000000001",
  ]);
  await database.query(`
    INSERT INTO hosted.events(
      id, workspace_id, run_id, project_id, device_id, connector_version,
      agent_platform, agent_role, agent_instance_id, status, occurred_at
    ) VALUES ($1, $2, $3, $4, $5, '1.0.0', 'codex', 'worker', $6, 'working', now())
  `, [
    "80000000-0000-4000-8000-000000000001",
    IDS.workspaceA,
    "60000000-0000-4000-8000-000000000001",
    IDS.projectA,
    "40000000-0000-4000-8000-000000000001",
    "70000000-0000-4000-8000-000000000001",
  ]);
  const idempotencyValues = [
    "90000000-0000-4000-8000-000000000001",
    IDS.workspaceA,
    "41000000-0000-4000-8000-000000000001",
    "80000000-0000-4000-8000-000000000001",
    digest,
  ];
  await database.query(`
    INSERT INTO hosted.idempotency_records(
      id, workspace_id, device_credential_id, event_id, request_digest, expires_at
    ) VALUES ($1, $2, $3, $4, $5, now() + interval '90 days')
  `, idempotencyValues);
  await assert.rejects(
    database.query(`
      INSERT INTO hosted.idempotency_records(
        id, workspace_id, device_credential_id, event_id, request_digest, expires_at
      ) VALUES ('90000000-0000-4000-8000-000000000002', $1, $2, $3, $4, now() + interval '90 days')
    `, [IDS.workspaceA, idempotencyValues[2], idempotencyValues[3], digest]),
    /idempotency_event_once/,
  );

  await database.query(`
    INSERT INTO hosted.replay_records(
      id, workspace_id, device_credential_id, nonce_digest, expires_at
    ) VALUES ('91000000-0000-4000-8000-000000000001', $1, $2, $3, now() + interval '10 minutes')
  `, [IDS.workspaceA, idempotencyValues[2], nonce]);
  await assert.rejects(
    database.query(`
      INSERT INTO hosted.replay_records(
        id, workspace_id, device_credential_id, nonce_digest, expires_at
      ) VALUES ('91000000-0000-4000-8000-000000000002', $1, $2, $3, now() + interval '10 minutes')
    `, [IDS.workspaceA, idempotencyValues[2], nonce]),
    /replay_nonce_once/,
  );
});

test("RLS defaults to deny and transaction-local tenant context cannot cross tenants", async (t) => {
  const { database } = await fixture();
  t.after(() => database.close());
  await seedTwoPersonalTenants(database);
  await database.exec("SET ROLE hosted_app");

  const withoutContext = await database.query("SELECT id FROM hosted.projects");
  assert.equal(withoutContext.rows.length, 0);

  const context = validateServerTenantContext({
    workspaceId: IDS.workspaceA,
    principalId: IDS.principal,
    principalKind: "user_session",
  });
  const pool = poolAdapter(database);
  const projects = await withHostedTenantTransaction(pool, context, (repository) => repository.listProjects());
  assert.deepEqual(projects.map((project) => project.id), [IDS.projectA]);

  await assert.rejects(
    database.query(
      "INSERT INTO hosted.projects(id, workspace_id, display_name, created_by_user_id) VALUES ($1, $2, 'Escape', $3)",
      ["30000000-0000-4000-8000-000000000003", IDS.workspaceB, IDS.user],
    ),
    /row-level security policy/,
  );

  const afterTransaction = await database.query("SELECT id FROM hosted.projects");
  assert.equal(afterTransaction.rows.length, 0);
  await database.exec("RESET ROLE");
});

test("tenant context validation rejects untrusted identifiers", () => {
  assert.throws(
    () => validateServerTenantContext({ workspaceId: "not-a-uuid", principalId: IDS.principal, principalKind: "user_session" }),
    /workspaceId/,
  );
});
