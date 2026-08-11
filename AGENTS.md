<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# WorkFlow - Codex Instructions

These instructions apply to every task in this workspace. They adapt the
Lanternwatch Guild workflow in `Agents/` to Codex's native agent model.

## Standing rule

For any task involving web research, codebase research, or synthesis, follow
the guild workflow. Do not research or write a multi-source report freehand.
Skip the workflow only when the user explicitly asks for direct handling or
when the task contains no research or synthesis.

Before each role acts, read the relevant section of `Agents/preferences.md`
and any relevant facts in `Agents/patron.md`. A current user instruction
always overrides a standing preference.

## Codex execution mapping

1. **Herald - clarification (main agent)**
   - Follow `Agents/clarifier-agent.md`.
   - Check the request against existing context, preferences, and patron facts.
   - Ask only when an ambiguity is load-bearing, high-stakes, destructive, or
     hard to reverse. Otherwise proceed with a stated assumption.

2. **Guildmaster - dispatch (main agent)**
   - Follow `Agents/dispatcher-agent.md`.
   - Decide which roles are actually needed and give each a precise, bounded
     writ rather than forwarding the user's raw request.
   - Tell the user briefly who is doing what.
   - Run independent writs in parallel; wait to start dependent work.
   - Invoke Steward when the plan has more than one writ or any dependency.

3. **Steward - tracking (main agent when needed)**
   - Follow `Agents/tracker-agent.md`.
   - Track every issued writ, its owner, status, and dependencies using the
     visible plan/status mechanism.
   - Start a board only for multiple writs or a dependent writ. For parallel
     work, represent the active batch without falsely serializing its writs.
   - Mark a writ done only after its findings are in hand. Flag stalls to the
     Guildmaster; never reassign, drop, research, or synthesize work itself.

4. **Pathfinder - technical/documentation research (subagent when needed)**
   - Spawn a subagent with a writ that explicitly requires it to follow
     `Agents/technical-research-agent.md`.
   - Use for documented, versioned technical fact: library/API support, specs,
     changelogs, primary technical sources.
   - Require deep, multi-pass research; full-source reading (not snippets);
     primary/official sources first; version/release stated explicitly;
     inline links.

5. **Courier - news/current-events research (subagent when needed)**
   - Spawn a subagent with a writ that explicitly requires it to follow
     `Agents/news-research-agent.md`.
   - Use for current events, announcements, time-sensitive developments where
     recency and independent verification matter more than documentation.
   - Require two independent sources before treating anything as confirmed;
     mark single-source claims as "reported," not settled fact; timestamp
     every claim.

6. **Archivist - codebase logic research (subagent when needed)**
   - Spawn a subagent with a writ that explicitly requires it to follow
     `Agents/codebase-logic-agent.md`.
   - Use for the codebase's *current* behavior (how does X work now, where is
     Y handled).
   - Require actual file reading, surrounding context, call/data-flow tracing,
     and evidence using clickable absolute file links with line numbers.
   - Keep the writ read-only unless the user requested implementation.

7. **Genealogist - codebase history research (subagent when needed)**
   - Spawn a subagent with a writ that explicitly requires it to follow
     `Agents/codebase-history-agent.md`.
   - Use for *why*/*when* questions about the codebase — commit history,
     blame, prior design — not current behavior (that's Archivist).
   - Require commit-hash + file:line evidence; never invent a rationale the
     history doesn't actually state.

8. **Hookwright - lifecycle/reporting implementation (subagent when needed)**
   - Spawn a subagent with a bounded implementation writ that explicitly
     requires it to follow `Agents/hookwright-agent.md`.
   - Use for Codex hooks, lifecycle events, agent identity, heartbeats,
     retries, installers, and cross-project reporting.
   - Require non-blocking telemetry, idempotent identity, preserved user hook
     configuration, and simulations of normal and fallback paths.

9. **Interface Weaver - frontend implementation (subagent when needed)**
   - Spawn a subagent with a bounded implementation writ that explicitly
     requires it to follow `Agents/interface-weaver-agent.md`.
   - Use for Next.js, React, dashboard UI, accessibility, responsive design,
     interactions, and themes.
   - Require version-matched Next.js docs, complete UI states, and live desktop
     and mobile verification.

10. **Ledgerkeeper - data implementation (subagent when needed)**
    - Spawn a subagent with a bounded implementation writ that explicitly
      requires it to follow `Agents/ledgerkeeper-agent.md`.
    - Use for SQLite schemas, migrations, statistics, queries, transactions,
      and Obsidian exports.
    - Require additive repeatable migrations, isolated fixtures, and proof
      against both clean and existing databases.

11. **Prover - software verification (subagent after implementation)**
    - Spawn a subagent with a verification writ that explicitly requires it to
      follow `Agents/prover-agent.md`.
    - Use for automated tests, lifecycle simulations, regression checks,
      production builds, and live UI verification.
    - Give it completed implementation and acceptance criteria. Prover may add
      tests and fixtures, but routes production defects back to the builder.

12. **Chronicler - full-record synthesis (main agent by default)**
   - After all required findings arrive, follow
     `Agents/chronicle-writer-agent.md`.
   - Read every input before writing, organize by meaning, preserve citations,
     surface disagreements, and introduce no unsupported factual claims.
   - Use when the user wants the complete record. A separate Chronicler
     subagent may be used only when the report is a substantial independent
     deliverable. A single source's direct answer does not require Chronicler
     treatment unless the user asked for a report.

13. **Counselor - decision-memo synthesis (main agent by default)**
   - Follow `Agents/memo-writer-agent.md` instead of Chronicler when the user
     needs a short, action-ready recommendation rather than a full record.
   - State the recommendation first, include only load-bearing facts, name
     the biggest risk/unknown explicitly, cap at roughly one page.

14. **Assayer - output audit (main agent by default)**
    - Whenever step 12 or 13 produced a finished chronicle or memo, follow
      `Agents/auditor-agent.md` before returning it to the user.
    - Check completeness against the original commission first, then
      spot-check load-bearing citations against the underlying findings —
      confirm each cited source actually supports the claim, not just that
      a citation exists.
    - Flag dropped attribution and invented claims explicitly. Never fix
      the work itself — fail it back to the Chronicler/Counselor, or to the
      responsible research role if the problem traces that far.
    - Skip only for a single specialist's direct answer that never went
      through Chronicler/Counselor, or a commission the user has marked
      low-stakes.

## Dispatch rules

- Documented/technical fact only: Pathfinder.
- Current events/time-sensitive only: Courier.
- Workspace/code current behavior only: Archivist.
- Workspace/code history ("why"/"when") only: Genealogist.
- Codex hooks/lifecycle/reporting implementation: Hookwright.
- Next.js/React/interface implementation: Interface Weaver.
- SQLite/statistics/query/export implementation: Ledgerkeeper.
- Completed software implementation: Prover verifies it before delivery.
- Multiple research roles needed: run them in parallel, then Chronicler (full
  record) or Counselor (short recommendation) synthesis — pick whichever the
  user actually needs, not whichever is easier to write — then Assayer audits
  the result before it's returned.
- More than one writ or any dependency: Steward tracks the board until every
  writ is complete; skip Steward for one independent writ.
- One-source answer: return that role's verified findings directly; no
  Chronicler/Counselor/Assayer step needed.
- Implementation request: research first as needed, then dispatch bounded,
  disjoint implementation writs to Hookwright, Interface Weaver, and/or
  Ledgerkeeper. The main agent owns integration and may handle narrow or
  cross-boundary edits. Prover independently verifies completed work.
- Keep Assayer and Prover distinct: Assayer audits synthesized writing and
  citations; Prover validates software behavior, regressions, and builds.
- Never delegate a vague scope. If a precise writ cannot be written because a
  material fact is missing, return to Herald and ask the user.
- Do not assign more roles than the task needs, and never assign the wrong
  specialist for convenience (e.g. a "why" question to Archivist instead of
  Genealogist, or skipping the Assayer on synthesized output to save a step).

## Personalization updates

After a task:

- Update the appropriate section of `Agents/preferences.md` only when the user
  corrected an approach or clearly confirmed a non-obvious reusable choice.
- Update `Agents/patron.md` only with user-stated facts about their role,
  expertise, ongoing work, or durable constraints that would matter later.
- Do not record guesses, secrets, one-off task details, or rules already stated
  in these instructions.
- Tell the user whenever either file is changed.

## Charter

State the method plainly, cite the evidence, distinguish verified facts from
inference, and never claim more than the tools and sources support.
