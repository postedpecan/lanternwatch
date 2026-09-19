# Hosted private-beta threat model

Status: normative phase-one security design

Last reviewed: 2026-08-16

## Purpose and scope

This threat model covers the planned invitation-only, multi-user Lanternwatch
service: browser accounts, personal and organization workspaces, one-time
connector enrollment, metadata-only lifecycle ingestion, the hosted dashboard,
managed PostgreSQL, backups, and production operations.

It does not declare the current local app safe to publish. The current
`/api/guild/*` routes are intentionally unauthenticated and loopback-only, the
existing event contract can carry raw paths and free-form text, and the SQLite
store has no tenant boundary. Those surfaces remain a local compatibility mode
until a separate hosted pipeline passes the controls and tests below.

The companion [data-classification policy](data-classification.md) is
normative. Where the two documents differ, the stricter rule applies.

## Security objectives

The private beta must preserve these invariants:

1. Hosted lifecycle events cannot contain prompts, responses, code, commands,
   tool I/O, raw paths, secrets, or arbitrary diagnostics.
2. A credential identifies its own security principal. A request-body account,
   workspace, organization, project, user, or device ID never grants access.
3. Personal workspaces remain invisible to organizations and their owners.
4. Every tenant-owned read and write requires explicit server-derived tenant
   context; missing or invalid scope fails closed.
5. User sessions, enrollment tokens, and device credentials are distinct and
   non-interchangeable credential classes.
6. Revocation stops new access immediately. Offline work never bypasses a
   revoked credential.
7. Lanternwatch failure never blocks Codex or Claude Code.
8. Normal monitoring stays low-friction; step-up authentication is reserved for
   sensitive operations defined by policy.
9. Deletion removes active data and access immediately, and documented backup
   handling prevents deleted access from being revived.
10. Operator access is least-privilege, attributable, MFA-protected, and
    audited without recording prohibited agent content.

## Assets and actors

### Protected assets

- account identities, sessions, passkeys, MFA enrollment, recovery material;
- invitation and enrollment authority;
- device ingestion credentials and signing/verifier material;
- workspace, organization, membership, role, and ownership state;
- project aliases, lifecycle metadata, audit records, and deletion state;
- PostgreSQL data, encrypted offline queues, backups, and production secrets;
- availability and integrity of ingestion and dashboard views.

### Actors

- invited user acting in a personal workspace;
- organization owner, admin, member, or viewer;
- enrolled local connector;
- unauthenticated internet client;
- malicious or compromised member/device/session;
- former member or revoked device with stale local state;
- platform operator and compromised operator account;
- third-party authentication, hosting, database, email, and monitoring
  providers.

No provider is trusted to make Lanternwatch's tenant-authorization decision on
the basis of a client-selected identifier.

## Trust boundaries and data flow

```text
Codex / Claude Code host event                         [untrusted, may be private]
        |
        v
Local connector allowlist + alias mapping             [privacy boundary]
        |
        +--> bounded encrypted offline queue           [restricted local store]
        |
        v
HTTPS + device authentication + replay proof          [public network]
        |
        v
Hosted ingestion edge                                 [authentication boundary]
        |
        v
Credential-derived tenant + strict schema             [authorization boundary]
        |
        v
Tenant-aware PostgreSQL transaction                   [persistence boundary]
        |
        v
Authenticated dashboard/API                           [user authorization boundary]
        |
        +--> step-up protected export/admin actions
        +--> safe audit and operational signals        [operator boundary]
```

Enrollment is a separate flow: an authenticated user creates a short-lived,
single-use enrollment token; the installer presents it to an exchange endpoint;
the browser confirms the device and destination; the exchange returns a new
ingestion-only credential. The enrollment token cannot read dashboard data or
ingest permanently, and the device credential cannot call user, membership,
export, or credential-management APIs.

## Threats and required controls

| Boundary | Threat | Required controls | Evidence required before beta |
| --- | --- | --- | --- |
| Host event to connector | Sensitive host fields are copied into an event | Construct from an allowlist; local alias mapping; closed enums; bounded fields; credential-pattern defense; no arbitrary metadata | Fixtures containing prompts, commands, code, paths, secrets, and unknown nested fields never reach serializer or queue |
| Connector configuration | Installer overwrites existing hooks or leaks a token | Merge rather than replace; backup first; enrollment token only; redact command output; store the permanent credential in OS secure storage where available with a documented least-privilege encrypted fallback; clean uninstall | Windows/macOS/Linux install, credential-storage, rollback, coexistence, and uninstall tests |
| Offline queue | Local theft, unbounded growth, or delivery after revocation | OS-backed encryption where available; strict byte/count/age bounds; expiry; no prohibited fields; original timestamp; device revocation enforced by server | Queue encryption/permissions inspection, bound/expiry tests, revoked-device rejection |
| Enrollment | Stolen, replayed, or misdirected one-time command | Hashed token verifier; about ten-minute expiry; single use; account/workspace binding; browser confirmation; atomic exchange; rate limit | Concurrent exchange test yields one credential; expired/revoked/wrong-workspace cases fail |
| Network | Credential theft, replay, tampering, or clock manipulation | TLS; Authorization header or versioned request signature; short validity window; nonce; clock-skew policy; credential rotation | Replayed/expired/future/tampered requests fail; secrets absent from URLs and logs |
| Ingestion parsing | Oversized, ambiguous, or smuggled payload reaches application code | Edge and application body-size limit; exact content type; strict JSON/schema; reject duplicate/unknown keys where parser permits; safe errors | Boundary-size, malformed JSON, content-type, unknown-field, and parser differential tests |
| Device authorization | Body IDs inject data across tenants/projects | Resolve device and tenant from credential; project alias must belong to that tenant; repositories require tenant context | Changed tenant/project/device IDs and identifier-guessing tests fail closed |
| Idempotency | Retries duplicate state or attacker suppresses another event | Idempotency scoped to credential/tenant; transactional event + key insertion; request digest conflict handling; bounded retention | Same request acknowledges once; same key with different digest rejects; cross-tenant keys do not collide |
| Rate limiting | One device or tenant exhausts ingestion/database capacity | Per-IP pre-auth limit; per-device and per-tenant post-auth limits; payload and concurrency caps; safe backpressure | Independent device/tenant limit tests; connector backs off without blocking agents |
| User session | Session theft, fixation, CSRF, brute force, or weak recovery | Secure HttpOnly same-site cookies; rotation; CSRF protections appropriate to framework; verified email; MFA; recovery controls; session list/revocation; new-device notice; credential-stuffing controls | Auth-provider contract tests and E2E flows for sign-in, recovery, revocation, CSRF, and lock/rate controls |
| Organizations | Viewer/member/admin escalates role or former member retains access | Central authorization policy; owner-only actions; last-owner invariant; immediate membership invalidation; step-up for privileged changes | Full role matrix, stale-session/member removal, ownership transfer, and personal-workspace isolation tests |
| Dashboard queries | Missing/unknown filter broadens to global data | Authentication first; explicit tenant repository constructor; unknown resource is 404/403; no global fallback | Cross-user/org/read/export tests and invalid-scope regression tests |
| Browser rendering | Stored display name/error becomes XSS or unsafe navigation | Bounded text fields; contextual output escaping; no stored HTML; CSP and secure headers; safe link allowlist | Stored-XSS fixtures and security-header checks |
| Logs/telemetry | Bodies, tokens, project metadata, paths, cookies, email/password values, or stack traces leak | Structured safe-event allowlist; correlation IDs; central redaction; no advertising trackers, cross-site marketing analytics, session replay, dashboard recording, or unreviewed third-party telemetry; short IP retention | Automated log-capture tests assert absence across success/failure paths and deployment configuration review proves banned telemetry is absent |
| PostgreSQL | Query omits tenant filter or migration weakens isolation | Tenant context required by repository API; constraints/FKs; least-privilege app role; transaction boundaries; optional defense-in-depth RLS only with tested policy/session context | Clean/existing migrations; direct cross-tenant repository tests; RLS tests if enabled |
| Secrets | Production keys enter source, preview logs, or broad environments | Managed secret store; separate local/preview/prod values; scoped credentials; application encryption where retrieval is required; rotation procedure | Secret scan; environment audit; rotation drill; no real secrets in fixtures |
| Deletion/backups | Active data remains or restoration revives deleted access | Tenant-scoped cascading deletion; immediate credential/session revocation; tombstone/deletion ledger designed not to contain product content; backup retention and restore reconciliation | Active deletion E2E, retention job tests, restore exercise proving deleted access is not reactivated |
| Operators/providers | Excessive human/provider access or unaudited production action | Named accounts, mandatory MFA, least privilege, separate migration/app roles, access review, safe operator audit events, incident process | Access matrix, audit sampling, provider configuration review, restoration drill |
| Availability | Hosted outage blocks coding or loses ordering | Non-blocking hooks; bounded queue; exponential backoff with jitter; health/version reporting; original occurrence time; compatibility policy | Outage simulation, recovery ordering, queue exhaustion behavior, old connector policy tests |

## Credential separation

| Credential | Accepted by | Authority | Explicitly rejected by |
| --- | --- | --- | --- |
| User session | Dashboard and user APIs | User actions allowed by current membership/role | Ingestion endpoint as a substitute for a device |
| Enrollment token | Enrollment exchange only | One device enrollment for one intended workspace, before expiry | Dashboard reads, permanent ingestion, account/membership APIs |
| Device credential | Versioned ingestion endpoint | Submit allowed events for one enrolled device and credential-derived workspace | Dashboard, exports, invitations, membership, other devices, credential management |

Credential lookup records use opaque identifiers plus strong secret verifiers;
raw bearer values are displayed only when issued and are never written to logs.
If asymmetric request signing is selected later, private signing material remains
on the connector and server records still cannot authorize any user API.

## Authorization invariants

- Repositories for hosted tenant data are constructed with a verified tenant
  context; tenant filtering is not an optional method argument.
- Authorization evaluates the current database membership for sensitive
  operations. A stale session claim alone cannot preserve a removed role.
- Personal workspaces have no organization membership path.
- Sharing or transferring a private project lists the newly authorized
  audience, requires explicit confirmation and recent authentication, and
  creates a permanent safe audit event.
- Safe audit events cover invitation creation/acceptance/revocation/expiry,
  membership and role changes, project sharing/transfer, device enrollment and
  revocation, credential rotation, MFA/password/recovery changes, export,
  project/account/organization deletion, ownership transfer, and operator
  production-data access. They never contain prohibited agent content.
- Owner/admin MFA is an application invariant even if the authentication
  provider can enforce MFA only globally. An owner/admin who has not satisfied
  the required factor cannot exercise privileged authority.
- Last-owner removal, organization deletion, ownership transfer, exports,
  credential rotation/revocation, and destructive account/project actions are
  server-authorized and step-up protected.

## Abuse cases that must fail closed

1. An event names another organization's ID while using a valid device token.
2. A connector retries an event after its device is revoked.
3. Two requests exchange the same enrollment token concurrently.
4. A viewer calls a member write endpoint; a member calls an admin endpoint;
   an admin attempts an owner-only transfer or deletion.
5. A removed member reuses an active browser session.
6. An unknown project filter is supplied to a dashboard or export request.
7. A duplicate idempotency key is reused with different content.
8. A lifecycle payload includes `prompt`, `cwd`, `command`, `stack`, a nested
   unknown object, or an overlong string.
9. An attacker sends a valid body with an expired timestamp or reused nonce.
10. A backup is restored after an account and its credentials were deleted.

## Current local-only gaps

The existing local runtime is useful evidence, not hosted infrastructure:

- [`app/api/guild/events/route.ts`](../../app/api/guild/events/route.ts#L7)
  parses an unauthenticated body and passes it to the local store without a
  strict rejection schema.
- [`lib/guild-contract.ts`](../../lib/guild-contract.ts#L100) permits raw
  project paths and free-form message, quest, and origin fields.
- [`lib/server/guild-store.ts`](../../lib/server/guild-store.ts#L109) defines
  only path-bearing projects, runs, and events with no tenant ownership columns.
  Its SQLite handle is process-cached
  ([database initialization](../../lib/server/guild-store.ts#L169)), and the
  event writer resolves and inserts path-derived project identity
  ([write flow](../../lib/server/guild-store.ts#L319)).
- [`app/api/guild/dashboard/route.ts`](../../app/api/guild/dashboard/route.ts#L7)
  and the repository query path allow global local views; invalid project scope
  currently widens rather than fails closed
  ([query behavior](../../lib/server/guild-store.ts#L380)).
- [`scripts/guild-report.mjs`](../../scripts/guild-report.mjs#L210) uses short
  retries and local SQLite fallback, not a credentialed, encrypted offline
  hosted queue.

Hosted development must use new modules and routes so local compatibility does
not silently inherit a public trust model. Proposed collision-free seams are
`lib/hosted/`, `lib/server/hosted/`, `app/api/hosted/ingest/v1/`, and a separate
connector package or `scripts/connector/` boundary.

## Decision gates before runtime implementation

The following choices require recorded, versioned decisions before adding
production dependencies or accounts:

- authentication provider/framework and exact support for all required login,
  passkey, MFA, recovery, session, organization, invitation, and step-up flows;
- primary deployment and PostgreSQL regions, data-processing locations, and
  acceptable latency from target testers;
- credential design: high-entropy bearer verifier versus asymmetric request
  signing, including rotation and replay state;
- application-level tenant enforcement pattern and whether PostgreSQL row-level
  security is added as defense in depth;
- encrypted offline queue/key-storage behavior on each supported OS;
- audit, IP-address, backup, tombstone, and security-exception retention;
- email delivery, abuse controls, monitoring, and incident notification without
  body/session capture.

No provider's free tier is a security property. Cost and plan limits must be
verified against the exact private-beta design before deployment.

## Phase gates

### Phase 1: security specification

- This threat model and the data-classification allowlist are reviewed.
- Every security objective is mapped to a later automated or operational test.
- Current local endpoints are explicitly classified as non-hostable.

### Phase 2: tenant-aware data foundation

- Additive PostgreSQL migrations work on clean and existing hosted databases.
- Tenant ownership is non-null and enforced for every tenant-owned record.
- Cross-tenant repository tests fail closed before any dashboard migration.

### Phase 3: identity, enrollment, and ingestion

- Credential classes are implemented as separate verifiers and routes.
- Strict connector and server schemas make prohibited fields unrepresentable or
  reject them before storage.
- Replay, idempotency, revocation, rate-limit, and offline-delivery tests pass.

### Phase 4: dashboard and private beta

- Role and personal-workspace isolation matrices pass in browser and API tests.
- Logs, exports, deletion, retention, backup restoration, accessibility,
  production builds, dependency/secret scans, and incident exercises pass.
- An independent authorized security review is complete before expansion.

## Review triggers

Re-review this model when adding a data field, auth method, organization role,
provider, region, telemetry product, export, connector platform, public signup,
retention exception, remote-control feature, or any endpoint that changes a
credential's authority.
