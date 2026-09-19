# ADR 0001: Provisional hosted foundation

Status: accepted for local development; blocked for production launch

Decision date: 2026-08-16

## Context

Lanternwatch needs a hosted Next.js service, managed PostgreSQL, and managed or
carefully selected authentication for an invitation-only private beta. The
confirmed product requires Google, GitHub, passkeys, email/password, verified
email, MFA, recovery, session management, personal workspaces, organizations,
four roles, recent-authentication checks, metadata-only device ingestion, and
strong tenant isolation.

The checkout is currently Next.js 16.3.0 and React 19.2.8. Its local-only API,
SQLite store, and event contract are not migrated by this decision.

## Decision

Use this provisional foundation for local schema and integration development:

- Vercel Pro with the Node.js runtime pinned to the tested 24.x line;
- one initial compute region, `sin1` (Singapore);
- Neon Launch in AWS Singapore with PostgreSQL 17 as the initial application
  compatibility baseline;
- a non-owner runtime database role and separate migration role;
- Clerk Pro with `@clerk/nextjs` 7.6.4 as identity and session authority
  ([package metadata](https://www.npmjs.com/package/%40clerk/nextjs));
- Lanternwatch-owned authorization, canonical workspace records, device
  credentials, tenant-aware repositories, deletion, audit, and lifecycle-data
  policy in PostgreSQL.

This is not approval to create production accounts, install dependencies, or
deploy. Those actions wait for the gates below and explicit environment setup.

## Why this direction

- Next.js documents Node server deployments as supporting the full framework
  feature set and requires Node 20.9 or newer for the current release
  ([installation](https://nextjs.org/docs/app/getting-started/installation),
  [deployment](https://nextjs.org/docs/app/getting-started/deploying)).
- Vercel recommends placing functions near their data source, while Neon lists
  an AWS Singapore region; aligning them avoids an avoidable cross-region
  database round trip
  ([Vercel regions](https://vercel.com/docs/functions/configuring-functions/region),
  [Neon regions](https://neon.com/docs/introduction/status)).
- New Vercel PostgreSQL deployments use Marketplace providers, and Neon has a
  native integration
  ([Vercel Postgres](https://vercel.com/docs/postgres),
  [Neon integration](https://vercel.com/marketplace/neon)).
- Neon documents transaction-mode pooled connections and request-scoped
  serverless-driver behavior. Runtime and migration connections must be
  deliberately separated
  ([pooling](https://neon.com/docs/connect/connection-pooling),
  [serverless driver](https://neon.com/docs/serverless/serverless-driver)).
- Neon Launch is the provisional beta tier because its documented recovery
  window is materially longer than the experimental free tier. PostgreSQL 17
  is an application compatibility choice, and its row-security behavior is
  covered by the versioned PostgreSQL manual
  ([Neon pricing](https://neon.com/pricing),
  [PostgreSQL 17 RLS](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)).
- Clerk's documented paid feature set covers the largest portion of the
  required identity surface: passkeys, MFA, backup codes, organizations,
  session revocation, and unfamiliar-device response
  ([authentication options](https://clerk.com/docs/guides/configure/auth-strategies/sign-up-sign-in-options),
  [organization roles](https://clerk.com/docs/guides/organizations/control-access/roles-and-permissions),
  [unauthorized sign-in](https://clerk.com/docs/guides/secure/best-practices/unauthorized-sign-in)).

## Responsibility split

| Concern | Provider responsibility | Lanternwatch responsibility |
| --- | --- | --- |
| OAuth, password, verified email, passkey, MFA factors | Clerk identity and factor verification | Configuration, provider-owned OAuth credentials, acceptance tests, and denying app access until requirements are satisfied |
| Sessions | Session issuance, listing, and revocation | Session-management UI, safe audit events, sensitive-action policy, and current authorization checks |
| Organizations | Provider organization context and available role facilities | Canonical workspace/organization mapping, sole-owner rule, personal-workspace isolation, resource ownership, and database authorization |
| Role-scoped MFA | Factor state supplied by provider | Mandatory owner/admin enrollment and authorization gate; no privileged action without the required factor |
| Recent authentication | Factor/session timestamps if production-supported | Sensitive-operation reauthentication ceremony and server enforcement |
| Invitations | Provider sign-up restriction where useful | Expiring, revocable, usage-limited, email/domain-bound private-beta codes |
| PostgreSQL | Managed compute, storage, encrypted transport, backup/PITR features | Schema, tenant keys, least-privilege roles, migrations, retention, deletion, restore reconciliation, and query isolation |
| Device ingestion | None | Enrollment, credential verifier, tenant derivation, strict schema, replay/idempotency/rate controls, revocation, and audit |

## Required launch gates

1. **Recent authentication:** Clerk's reviewed server-side reverification API is
   marked public beta and not recommended for production. Before beta, use a
   production-supported provider mechanism or implement and independently
   review an explicit reauthentication ceremony
   ([Clerk Auth object](https://clerk.com/docs/reference/backend/types/auth-object)).
2. **Custom-role availability and cost:** verify in a production instance that
   `owner`, `admin`, `member`, and `viewer` can be represented at the expected
   price. If not, keep Clerk as identity/session authority and store the full
   authorization role model in PostgreSQL.
3. **Owner/admin MFA:** prove that incomplete MFA enrollment blocks privileged
   authorization without forcing the same policy on viewers/members.
4. **Runtime:** run all tests and a production build on the exact pinned Node
   24 runtime before configuring deployment.
5. **Region and processing:** confirm the chosen Vercel, Neon, auth, email, and
   monitoring data-processing locations against the beta privacy notice.
6. **Restore:** perform a real point-in-time restoration exercise and prove the
   deletion ledger prevents revoked/deleted access from being reactivated.
7. **Background work:** validate that the selected cron/worker design can meet
   retention, expiry, retry, and alerting requirements; add a durable queue if
   the serverless schedule is insufficient.
8. **Cost:** re-check provider plan gates and actual checkout pricing before
   accounts are upgraded. Current listed Vercel and Clerk plan prices combined
   with Neon's representative Launch usage produce a rough planning estimate
   around USD 55-60/month before domain, email, overages, or enhanced B2B
   features. Neon is usage-based, so this is neither a floor nor a fixed quote
   ([Vercel pricing](https://vercel.com/pricing),
   [Clerk pricing](https://clerk.com/pricing),
   [Neon pricing](https://neon.com/pricing)).

## Security consequences

- Route and Server Action authorization is repeated at each operation; a layout
  or middleware check is not considered sufficient.
- The application runtime never receives a database-owner credential.
- If PostgreSQL row-level security is added as defense in depth, production
  tables use a non-owner runtime role and `FORCE ROW LEVEL SECURITY`; PostgreSQL
  documents that owners and `BYPASSRLS` roles otherwise bypass policies
  ([PostgreSQL 17 RLS](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)).
- Device bearer values use the `Authorization` header over TLS, are shown only
  at issuance, and are stored server-side only as a strong verifier. RFC 6750
  warns against URL-carried bearer tokens because URLs are commonly logged
  ([RFC 6750](https://www.rfc-editor.org/rfc/rfc6750.html)).
- Preview and development environments use separate database branches,
  credentials, auth instances, and synthetic data; production data is never
  copied into preview by default.

## Alternatives considered

- **WorkOS AuthKit:** the strongest documented fallback for stable
  `auth_time`/`max_age` reauthentication. The reviewed official material did
  not establish recovery codes or a Clerk-equivalent unfamiliar-device
  notification and one-click revocation flow, so vendor confirmation and tests
  are required before selection
  ([WorkOS reauthentication](https://workos.com/docs/authkit/reauthentication),
  [authentication model](https://workos.com/docs/authkit/modeling-your-app),
  [organization policies](https://workos.com/docs/authkit/organization-policies)).
- **Self-managed authentication frameworks:** deferred because they would make
  Lanternwatch directly responsible for more of the account-security and
  recovery surface. No specific framework is approved by this decision.
- **Vercel/Neon free plans:** suitable for experiments, not accepted as the
  security or recovery baseline for invited users. The product must not depend
  on a permanently free tier.

## Revisit this decision when

- either Clerk launch gate cannot be closed;
- the beta's primary user region changes;
- measured database latency contradicts the single-region design;
- a requirement needs durable work that the selected runtime cannot schedule;
- plan pricing, retention, restore, auth, or regional support materially
  changes;
- the project moves beyond private beta or adds enterprise SSO/self-hosting.
