# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People supervising local Codex agent activity while working in a project. They need to scan current work, inspect truthful run history, and manage their own agent definitions without losing source context.

## Product Purpose

LanternWatch is a local-first dashboard for recorded agent lifecycle activity. It makes current occupancy, run status, and agent configuration legible without presenting unobserved or inferred telemetry as fact.

## Positioning

The dashboard joins lifecycle-derived operational context with user-owned agent catalog snapshots, retaining explicit source paths, scope, and read-only boundaries.

## Operating Context

Users work in the browser while their agent tools run elsewhere. Project scope may change, and discovery is always manual or an explicit one-time scan; it never becomes a background watcher.

## Capabilities and Constraints

- The Agents view can show workload derived from recorded active windows, run-status context, and a current occupancy snapshot.
- It must not claim time-series history, forecasts, per-agent success rates, queue times, or historical concurrency without supporting telemetry.
- Workspace agent sources are imported as replaceable, read-only snapshots; removal affects LanternWatch-managed data only.
- Runtime messages remain source data. Static product copy belongs in a source-owned module.

## Brand Commitments

The approved direction is a dark amber liquid-glass operational interface: charcoal-brown surfaces, warm off-white text, restrained amber selection and focus, and distinct semantic success, warning, and danger colors. Glass is reserved for major surfaces while dense controls remain opaque; the accepted warm-paper light-theme baseline is preserved. It takes compositional inspiration from Haulix and Call Monitoring references without copying their artwork or text. No generated imagery, image-embedded text, or visuals that imply unrecorded telemetry are used.

## Evidence on Hand

- Existing run, activity, catalog, and project-filter contracts in this repository.
- No approved image assets or claims of telemetry beyond stored lifecycle data.

## Product Principles

- Show recorded facts, and label current snapshots as current.
- Keep a dense operational scan path without hiding source scope.
- Let user-owned sources remain user-owned and reversible.
- Make empty and incomplete data states as honest as populated states.

## Accessibility & Inclusion

The interface must support keyboard navigation, persistent theme choice, readable contrast, long names and paths, wrapping at narrow widths, and 200% zoom without overlapping visible text.
