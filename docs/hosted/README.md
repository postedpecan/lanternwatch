# Lanternwatch hosted implementation

The hosted product is being built as a new security boundary beside the
existing local-only Lanternwatch runtime. The local `/api/guild/*` routes,
SQLite store, and path-bearing event contract are not a hosted foundation and
must not be exposed publicly.

## Normative phase-one documents

- [Threat model](threat-model.md) defines assets, trust boundaries, abuse
  cases, required controls, and evidence gates.
- [Data classification](data-classification.md) defines the closed hosted
  event allowlist and the handling rules for account, credential, tenant,
  audit, log, retention, deletion, and backup data.
- [ADR 0001: provisional hosted foundation](decisions/0001-hosted-foundation.md)
  records the researched runtime, database, and authentication direction plus
  the unresolved gates that prevent treating it as production-approved.

## Delivery order

1. Review and approve the threat model and data classification.
2. Implement tenant-aware PostgreSQL migrations and repository boundaries.
3. Implement identity, invitation, organization, and authorization foundations.
4. Implement one-time enrollment and the versioned secure ingestion protocol.
5. Build the cross-platform connector sanitization, credential storage, and
   bounded encrypted offline queue.
6. Migrate dashboard reads to authenticated, tenant-scoped endpoints.
7. Add device/membership management, retention, deletion, and audit systems.
8. Complete automated security tests, deployment, restore testing, independent
   security review, and limited beta validation.

Each later phase must satisfy the phase gates in the threat model before the
next public trust boundary is enabled.
