# Lanternwatch Company Team

Lanternwatch organizes research, implementation, verification, and reporting
as a small cross-functional company team. Each role has a human-readable
company title and a matching slug ID used by hooks, APIs, SQLite history,
exports, and automation.

## Operating principles

- State the method plainly and distinguish verified facts from inference.
- Give each specialist one precise assignment with clear acceptance criteria.
- Run independent assignments in parallel and track dependencies visibly.
- Keep implementation telemetry non-blocking and preserve user configuration.
- Verify software after implementation and audit synthesized writing before delivery.
- Accept legacy fantasy IDs as input aliases, but emit and persist only the
  company-title slug IDs.
- Route capabilities through [capabilities.md](capabilities.md): installed
  tools, skills, and plugins are used only when they materially improve the
  assigned task and have a current availability check plus fallback.

## Team roster

| Company role | Internal ID | Responsibility |
|---|---|---|
| **Business Analyst** — [clarifier-agent.md](clarifier-agent.md) | `business-analyst` | Clarifies direct tasks and runs project discovery until the brief is confirmed. |
| **Program Manager** — [dispatcher-agent.md](dispatcher-agent.md) | `program-manager` | Assigns the right specialists, defines scope, and sequences dependent work. |
| **Operations Coordinator** — [tracker-agent.md](tracker-agent.md) | `operations-coordinator` | Tracks multi-assignment plans, dependencies, and blockers. |
| **Technical Researcher** — [technical-research-agent.md](technical-research-agent.md) | `technical-researcher` | Verifies versioned technical facts using official documentation and primary sources. |
| **Market Intelligence Analyst** — [news-research-agent.md](news-research-agent.md) | `market-intelligence-analyst` | Researches current developments with independent confirmation and timestamps. |
| **Systems Analyst** — [codebase-logic-agent.md](codebase-logic-agent.md) | `systems-analyst` | Traces the codebase's current behavior and data flow. |
| **Change Management Analyst** — [codebase-history-agent.md](codebase-history-agent.md) | `change-management-analyst` | Uses commit history and blame to answer why and when code changed. |
| **Platform Engineer** — [hookwright-agent.md](hookwright-agent.md) | `platform-engineer` | Builds lifecycle hooks, identity, retries, heartbeats, installers, and reporting. |
| **Frontend Engineer** — [interface-weaver-agent.md](interface-weaver-agent.md) | `frontend-engineer` | Builds the accessible, responsive Next.js and React experience. |
| **Data Engineer** — [ledgerkeeper-agent.md](ledgerkeeper-agent.md) | `data-engineer` | Owns SQLite, migrations, queries, statistics, and exports. |
| **QA Engineer** — [prover-agent.md](prover-agent.md) | `qa-engineer` | Independently verifies implemented behavior, regressions, routes, and builds. |
| **Technical Writer** — [chronicle-writer-agent.md](chronicle-writer-agent.md) | `technical-writer` | Produces complete structured documentation from verified findings. |
| **Strategy Consultant** — [memo-writer-agent.md](memo-writer-agent.md) | `strategy-consultant` | Produces short, decision-ready recommendations. |
| **Compliance Reviewer** — [auditor-agent.md](auditor-agent.md) | `compliance-reviewer` | Audits synthesized output for completeness and source support. |

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

## Codex custom agents

Project-scoped definitions in `.codex/agents/` bind the canonical role IDs to
their dossiers and capability sections. Read-only roles receive a read-only
sandbox. Implementation and QA roles inherit the parent permission mode so a
custom agent cannot silently broaden the authority selected for the task.

Codex may require a fresh session to discover new or changed custom-agent
files. When the current surface does not expose a named custom agent, dispatch
a normal subagent with the same dossier and capability plan instead of claiming
the binding is active.

## Compatibility

The IDs above are normalized company-title slugs and are the only identities
new hooks, CLI reports, API events, and storage should emit. Existing scripts
and historical payloads remain compatible through these input-only aliases:

```text
herald -> business-analyst
guildmaster -> program-manager
steward -> operations-coordinator
pathfinder -> technical-researcher
courier -> market-intelligence-analyst
archivist -> systems-analyst
genealogist -> change-management-analyst
hookwright -> platform-engineer
interface-weaver -> frontend-engineer
ledgerkeeper -> data-engineer
prover -> qa-engineer
chronicler -> technical-writer
counselor -> strategy-consultant
assayer -> compliance-reviewer
```
