# Lanternwatch Company Team

Lanternwatch organizes research, implementation, verification, and reporting
as a small cross-functional company team. Each role has a human-readable
company title and a stable internal ID used by hooks, APIs, SQLite history,
exports, and existing automation.

## Operating principles

- State the method plainly and distinguish verified facts from inference.
- Give each specialist one precise assignment with clear acceptance criteria.
- Run independent assignments in parallel and track dependencies visibly.
- Keep implementation telemetry non-blocking and preserve user configuration.
- Verify software after implementation and audit synthesized writing before delivery.
- Keep legacy internal IDs stable so saved history remains compatible.

## Team roster

| Company role | Internal ID | Responsibility |
|---|---|---|
| **Business Analyst** — [clarifier-agent.md](clarifier-agent.md) | `herald` | Clarifies direct tasks and runs project discovery until the brief is confirmed. |
| **Program Manager** — [dispatcher-agent.md](dispatcher-agent.md) | `guildmaster` | Assigns the right specialists, defines scope, and sequences dependent work. |
| **Operations Coordinator** — [tracker-agent.md](tracker-agent.md) | `steward` | Tracks multi-assignment plans, dependencies, and blockers. |
| **Technical Researcher** — [technical-research-agent.md](technical-research-agent.md) | `pathfinder` | Verifies versioned technical facts using official documentation and primary sources. |
| **Market Intelligence Analyst** — [news-research-agent.md](news-research-agent.md) | `courier` | Researches current developments with independent confirmation and timestamps. |
| **Systems Analyst** — [codebase-logic-agent.md](codebase-logic-agent.md) | `archivist` | Traces the codebase's current behavior and data flow. |
| **Change Management Analyst** — [codebase-history-agent.md](codebase-history-agent.md) | `genealogist` | Uses commit history and blame to answer why and when code changed. |
| **Platform Engineer** — [hookwright-agent.md](hookwright-agent.md) | `hookwright` | Builds lifecycle hooks, identity, retries, heartbeats, installers, and reporting. |
| **Frontend Engineer** — [interface-weaver-agent.md](interface-weaver-agent.md) | `interface-weaver` | Builds the accessible, responsive Next.js and React experience. |
| **Data Engineer** — [ledgerkeeper-agent.md](ledgerkeeper-agent.md) | `ledgerkeeper` | Owns SQLite, migrations, queries, statistics, and exports. |
| **QA Engineer** — [prover-agent.md](prover-agent.md) | `prover` | Independently verifies implemented behavior, regressions, routes, and builds. |
| **Technical Writer** — [chronicle-writer-agent.md](chronicle-writer-agent.md) | `chronicler` | Produces complete structured documentation from verified findings. |
| **Strategy Consultant** — [memo-writer-agent.md](memo-writer-agent.md) | `counselor` | Produces short, decision-ready recommendations. |
| **Compliance Reviewer** — [auditor-agent.md](auditor-agent.md) | `assayer` | Audits synthesized output for completeness and source support. |

## Typical workflow

```text
Business Analyst -> Program Manager -> research -> Technical Researcher / Market Intelligence Analyst
                                     |           -> Systems Analyst / Change Management Analyst
                                     -> build -> Platform Engineer / Frontend Engineer / Data Engineer
                                     -> verify -> QA Engineer
                                     -> synthesize -> Technical Writer / Strategy Consultant
                                     -> audit -> Compliance Reviewer
                    Operations Coordinator tracks multi-assignment or dependent work
```

The Business Analyst clears bounded tasks quickly and conducts deeper discovery
for project-level work. The Program Manager creates precise assignments and
selects only the specialists required. The Operations Coordinator is used when
there is more than one assignment or a dependency. The QA Engineer verifies
software after implementation; the Compliance Reviewer separately audits
synthesized writing and citations.

## Personalization

[preferences.md](preferences.md) records confirmed reusable working preferences
under the company-role headings. [patron.md](patron.md) stores only durable,
user-stated context that would matter in future work. Never record guesses,
secrets, one-off task details, or information already defined by the workflow.

## Compatibility

Company titles are presentation names. Do not rename the internal IDs, agent
fields in stored events, CLI `--agent` values, hook receipts, asset keys, or
existing filenames. New aliases may resolve company titles to the stable IDs,
but emitted and persisted identities remain the IDs listed above.
