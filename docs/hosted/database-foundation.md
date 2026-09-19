# Hosted PostgreSQL database foundation

Status: implemented for isolated local and disposable integration testing

This phase adds a PostgreSQL 17 data boundary for the hosted product. It is
separate from the local SQLite dashboard and does not migrate or expose the
local event contract.

## Invariants

- `hosted.workspaces.id` is the canonical tenant identifier. A personal
  workspace has one user owner; an organization row can reference only a
  workspace whose kind is `organization`.
- Every tenant-owned table has a non-null `workspace_id`. Every relationship
  between tenant-owned records uses a composite `(workspace_id, id)` foreign
  key, so a child cannot name a record from another tenant.
- Secret-bearing enrollment, invitation, device-credential, request-digest,
  and replay values store verifiers/digests only. Private-beta access codes are
  global pre-account records with expiration, usage, revocation, and optional
  email/domain restrictions; organization invitations are separate
  tenant-owned records governed by workspace RLS. The schema has no prompt,
  response, code, command, path, arbitrary metadata, or unbounded event field.
- Runtime tenant tables have row-level security enabled and forced. Each policy
  has both `USING` and `WITH CHECK`; an absent transaction-local
  `lanternwatch.workspace_id` matches no row.
- The runtime role is `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOINHERIT`,
  `NOLOGIN`, `NOREPLICATION`, and `NOBYPASSRLS`. The repeatable bootstrap also
  removes runtime membership in the migrator role. Runtime cannot read the
  migration ledger, global user table, or global beta-invitation table. The
  separate migrator role owns schema changes.
- The TypeScript transaction boundary accepts only a validated, server-derived
  tenant context, starts a transaction on one checked-out handle, applies the
  workspace and principal context with `set_config(..., true)`, and exposes
  tenant-scoped repository methods rather than a global query API.

The schema establishes tenant isolation, not the full authorization matrix.
Owner/admin/member/viewer checks, last-owner enforcement, MFA/recent-auth
gates, and device-credential authentication remain application-service work
for the identity and ingestion phase.

## Migrations

Ordinary SQL migrations live in `lib/server/hosted/migrations` and use an
immutable `NNN_description.sql` name. The runner calculates SHA-256 over the
exact file bytes and records version, name, and checksum in
`hosted.schema_migrations`.

Every run:

1. asserts PostgreSQL major version 17;
2. checks out exactly one client, starts one transaction, and sets local lock
   and statement timeouts;
3. takes a transaction-scoped advisory lock;
4. rejects any recorded name/checksum drift, missing historical file, or
   out-of-order insertion;
5. applies and records all pending files atomically.

The runner releases its checked-out client on success and on every failure,
including a failure to begin the transaction.

The role bootstrap is deliberately separate at
`lib/server/hosted/bootstrap/001_roles.sql`. A database administrator runs it
once on a dedicated database. Login credentials and provider grants are
environment configuration and do not belong in source control.

## Verification commands

The default executable proof is completely in-memory:

```powershell
npm run test:hosted-db
```

It pins PGlite exactly at 0.4.1, asserts its embedded server is PostgreSQL 17,
and covers a clean migration, repeated startup with existing tenant records,
deleted-history and checksum rejection, rollback, pinned-client cleanup,
repeatable least-privilege role repair, distinct beta and organization
invitations, cross-tenant composite constraints, duplicate event/replay
rejection, missing-context default deny, and transaction-local RLS scope. It
never opens Lanternwatch's SQLite file or an Obsidian vault.

Before CI or a private beta, a real PostgreSQL 17 run is mandatory:

```powershell
$env:TEST_DATABASE_URL = '<disposable PostgreSQL 17 database or branch URL>'
npm run test:hosted-db:postgres
```

The command fails clearly without `TEST_DATABASE_URL` and refuses a target
where a `hosted` schema already exists. It intentionally leaves its data in
the disposable database for inspection; destroy the test database or provider
branch afterward. Never point it at production, a shared development database,
or a patron database.

The real-server test checks PostgreSQL 17 behavior that PGlite cannot prove by
itself: least-privilege role attributes, two-client migration serialization,
ordinary network-client behavior, transaction-local context, and RLS denial.
CI must also exercise the selected provider's pooled and direct connections,
maximum concurrency, role/login grants, TLS policy, restore workflow, backup
deletion reconciliation, and retention jobs before beta.

## Intentionally deferred

- No Neon or Vercel account, branch, role, credential, or deployment is
  created by this phase.
- No provider pooling/concurrency claim is made until the real integration
  command runs against the chosen disposable PostgreSQL 17 environment.
- The 90-day event retention indexes and deletion markers are foundations;
  scheduled deletion, tombstone reconciliation after restore, and approved
  audit retention policy remain launch gates.
- Identity synchronization, sessions, invitations, enrollment exchange,
  ingestion DTO validation, rate limiting, and audit writers are not yet wired.
