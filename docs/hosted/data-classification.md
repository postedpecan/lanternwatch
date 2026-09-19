# Hosted data classification

Status: normative security baseline for the private beta

Last reviewed: 2026-08-16

This document defines which data the hosted Lanternwatch product may process.
The default is deny: a field that is not explicitly allowed here must not cross
the connector-to-host boundary until this document, the versioned event schema,
and the related tests are deliberately updated.

The existing local-only pipeline is not covered by this allowlist. It currently
uses path-bearing and free-form fields in `lib/guild-contract.ts` and must remain
a separately named compatibility mode. Hosted code must not reuse that input
contract.

## Classification levels

| Level | Meaning | Examples | Required handling |
| --- | --- | --- | --- |
| Public | Safe for intentional public release | Product documentation, published connector versions | Integrity controls; normal operational access |
| Internal | Non-user operational data | Deployment version, aggregate service health, schema version | Staff need-to-know; never expose privileged diagnostics to ordinary sessions |
| Confidential | Tenant or account data whose disclosure would affect privacy | Verified email, membership, device name, project display name, lifecycle metadata | Tenant authorization, encryption in transit and at rest, access audit where sensitive |
| Restricted | Authentication, recovery, or security-control data | Session token, enrollment token, device credential, MFA secret, recovery code, password hash | Least privilege, dedicated secret storage or application encryption, rotation/revocation, never log or export |
| Prohibited | Data Lanternwatch must not collect in hosted lifecycle events | Prompts, responses, code, file contents, commands, tool I/O, secrets, raw paths | Drop locally; reject server-side; never log, store, export, or place in a dead-letter queue |

Classification follows the most sensitive component. Encryption, hashing, or
pseudonymization does not turn prohibited content into allowed content.

## Hosted lifecycle-event allowlist

Only the following fields may appear in the versioned hosted ingestion body.
Names are conceptual until the strict DTO is implemented; the DTO must be at
least as restrictive as this table.

| Field | Class | Purpose | Validation and retention |
| --- | --- | --- | --- |
| `eventId` | Confidential | Idempotency | Connector-generated random identifier; exact format and length allowlist; retain with the event for 90 days |
| `deviceId` | Confidential | Attribute an event to an enrolled connector | The authenticated credential remains authoritative; a body value must match or be ignored/rejected |
| `connectorVersion` | Internal | Compatibility and health | Semantic-version-shaped bounded string |
| `projectAliasId` | Confidential | Resolve a user-selected display name without sending a path | Opaque identifier already assigned to the credential's workspace |
| `agentPlatform` | Confidential | Distinguish Codex from Claude Code | Closed enum only |
| `agentRole` | Confidential | Display the selected agent type | Closed, versioned enum; no free-form role text |
| `agentInstanceId` | Confidential | Correlate one active agent without local identity | Random pseudonymous identifier; no username, process command, or hostname derivation |
| `status` | Confidential | Show lifecycle state | Closed enum: working, completed, interrupted, failed, stalled |
| `occurredAt` | Confidential | Preserve original ordering and offline-delivery time | UTC timestamp; enforce documented past/future clock-skew bounds |
| `antiReplay` | Restricted while valid | Prevent request reuse | Random nonce or signed-request component; short retention sufficient for the replay window |
| `errorCategory` | Confidential | Explain coarse failures | Optional closed enum; never a raw exception, stack trace, or message |

Workspace, organization, account, membership, user, and tenant identifiers are
not selectable security boundaries in the body. The server derives the tenant
and allowed project aliases from the authenticated device credential.

Unknown keys, nested extension bags, and free-form metadata are rejected. They
are not silently retained for forward compatibility.

## Prohibited lifecycle data

The connector must remove or reject all of the following before serialization,
and the ingestion service must independently reject them by field name, shape,
and payload policy:

- prompts, model responses, reasoning, transcripts, and conversation titles;
- source code, repository contents, diffs, file contents, and clipboard data;
- commands, arguments, tool names paired with inputs, and tool outputs;
- environment variables, cookies, credentials, secrets, tokens, and keys;
- raw or relative filesystem paths, working directories, local usernames, and
  hostnames;
- Git remote URLs, repository URLs, branch names when user-identifying, and
  commit contents;
- raw exceptions, stack traces, stderr/stdout, crash dumps, and arbitrary
  diagnostic text;
- unreviewed host payload fields or arbitrary JSON metadata.

Prohibited content must not enter retries, telemetry, rejected-request logs,
quarantine storage, analytics, traces, support tickets, or security audit
records. A rejection records only a safe reason code, correlation identifier,
schema version, timestamp, and the authenticated principal needed to enforce
abuse controls.

## Non-event product data

| Data family | Class | Storage rule | Access rule | Initial lifecycle |
| --- | --- | --- | --- | --- |
| Account identities and verified email | Confidential | Managed auth store or tenant-aware application tables | User and narrowly authorized operators | Until account deletion, subject to documented operational retention |
| Password hashes | Restricted | Password-specific hashing by the selected auth system | Authentication service only | Follow account deletion and abuse-prevention requirements |
| MFA secrets and recovery codes | Restricted | Encrypted secrets; recovery codes stored one-way where supported | Authentication service only | Rotate/revoke on regeneration or account deletion |
| User sessions | Restricted | Server-side revocable session records | Session owner and authentication service | Bounded lifetime; revoke immediately on user action |
| Invitation codes/tokens | Restricted | Store a one-way verifier, not the bearer value | Invitation service and authorized owner/admin | Expiry, usage exhaustion, or revocation plus short audit retention |
| Enrollment tokens | Restricted | One-way verifier; single-use and about ten minutes | Enrollment exchange only | Delete/invalidate immediately after exchange or expiry |
| Device credentials | Restricted | One-way verifier when bearer authentication is sufficient; otherwise application-encrypted key material | Ingestion verifier and credential-management service only | Rotate and revoke; never recover through dashboard APIs |
| Organization and membership records | Confidential | Tenant-aware PostgreSQL | Authorized members by role | Until membership/org deletion, with minimal security audit facts retained per policy |
| Device name and project display name | Confidential | Server-readable for intended filtering and sharing | Credential-bound workspace and authorized dashboard members | Until the device/project or owning account/workspace is deleted; this is configuration data, not 90-day activity metadata |
| Runs and lifecycle events | Confidential | Tenant-aware PostgreSQL | Credential-bound workspace and authorized dashboard members | 90 days initially, enforced automatically |
| Security audit records | Confidential; Restricted if they reference credentials | Append-oriented records with safe structured details only | Subject, authorized org owner, and attributable operators as defined | A separate documented retention period must be approved before beta |
| Correlation IDs and safe error categories | Internal or Confidential | Structured logs without request bodies | On-call/security need-to-know | Short documented operational retention |
| Source IP address | Confidential | Temporary security-control store, not product tables | Automated abuse controls and authorized investigators | Short documented retention; never permanent product data |
| Encrypted backups | Same as source | Managed encrypted backups with restoration controls | Individually attributable production operators with MFA | Published backup retention; deletion propagation must be tested |

## Processing rules

### Connector

1. Build the outgoing object from a closed allowlist, not by deleting known bad
   keys from a host event.
2. Resolve a working directory to a user-approved alias locally. No path value
   may be serialized, logged during delivery, or placed in the offline queue.
3. Convert failures to a closed safe category before queueing.
4. Scan bounded string fields for credential-like material as defense in depth;
   a match rejects the event rather than returning the matched value.
5. Encrypt the bounded offline queue using an OS-backed key when available.
   Connector work remains non-blocking if storage or delivery fails.
6. Store the permanent device credential in operating-system secure storage
   where available. A documented least-privilege encrypted fallback is required
   per supported OS; plaintext configuration files are not an acceptable
   fallback.

### Ingestion

1. Enforce a content type and body-size limit before parsing.
2. Authenticate the device before resolving tenant context.
3. Validate an exact versioned schema and reject unknown fields.
4. Require the body device/project references to belong to the credential-bound
   workspace; a client value never chooses a tenant.
5. Apply replay, clock-skew, idempotency, and device/tenant rate-limit checks.
6. Insert accepted event and idempotency state transactionally.
7. Return safe errors and duplicate acknowledgements without echoing input.

### Dashboard, exports, and operators

- Every query requires explicit tenant context. Missing, unknown, stale, or
  unauthorized scope fails closed and never widens to a global query.
- Organization roles do not grant access to members' personal workspaces.
- Exports require recent authentication and contain only the requesting
  principal's authorized, non-prohibited product data.
- Product and infrastructure logs exclude request/response bodies, cookies,
  credentials, project metadata, paths, email/password values, and unfiltered
  exceptions.
- The private beta uses no advertising trackers, cross-site marketing
  analytics, session replay, dashboard-content recording, or unreviewed
  third-party telemetry.
- Production access uses named operator identities with MFA and produces a safe
  audit event.

### Required security audit events

Safe structured audit records are required for:

- invitation creation, acceptance, revocation, and expiry;
- member addition/removal and every role change;
- project sharing/transfer and ownership transfer;
- device enrollment/revocation and credential rotation;
- MFA change, password change, and recovery use;
- data export;
- project, account, and organization deletion; and
- operator access to production data.

Audit details identify the action, actor, affected tenant/resource, outcome,
and time without containing prompts, responses, code, commands, raw paths,
tokens, credential material, or arbitrary agent metadata.

## Retention and deletion

- Lifecycle activity has an initial 90-day retention period enforced by a
  scheduled server-side job, not only hidden in the UI.
- Project, workspace, organization, and account deletion removes active product
  data immediately through tenant-scoped transactions and revokes related
  credentials and sessions.
- Backup retention, deletion propagation, restoration access, and safeguards
  against reviving deleted access must be documented and tested before beta.
- Security and abuse-prevention exceptions require a separately approved,
  purpose-limited retention rule; they must never retain prohibited content.

## Schema and logging review gate

Any pull request that adds an ingested or logged field must answer all of these:

1. Is the field explicitly present in this allowlist and versioned DTO?
2. Can it be derived without prompts, code, commands, paths, or other prohibited
   host data?
3. What tenant authorization protects it at write, read, export, and deletion?
4. What is its maximum size, enum/format rule, and retention period?
5. Can it appear in application, platform, database, analytics, or support logs?
6. Do negative tests prove prohibited and unknown fields fail before storage?

If any answer is missing, the field does not ship.
