---
name: "Lanternwatch"
description: "A compact, truthful agent-runtime console in dark amber liquid glass."
colors:
  dark-surface: "#18130E"
  dark-text: "#F8F2E7"
  dark-accent: "#FFC857"
  dark-success: "#78D39C"
  dark-warning: "#FF9F43"
  dark-danger: "#FF7A6E"
  light-surface: "#f4f1e8"
  light-text: "#1b211c"
  light-accent: "#4a6b16"
  light-success: "#2f6d44"
  light-warning: "#855f09"
  light-danger: "#a84237"
typography:
  display:
    fontFamily: '"FiraCode Nerd Font", ui-monospace, SFMono-Regular, "Cascadia Code", Consolas, "Liberation Mono", monospace'
    fontSize: "clamp(22px, 2.2vw, 28px)"
    fontWeight: 600
    lineHeight: 1.16
    letterSpacing: "-0.02em"
  title:
    fontFamily: '"FiraCode Nerd Font", ui-monospace, SFMono-Regular, "Cascadia Code", Consolas, "Liberation Mono", monospace'
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: '"FiraCode Nerd Font", ui-monospace, SFMono-Regular, "Cascadia Code", Consolas, "Liberation Mono", monospace'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: '"FiraCode Nerd Font", ui-monospace, SFMono-Regular, "Cascadia Code", Consolas, "Liberation Mono", monospace'
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.2
  mono:
    fontFamily: '"FiraCode Nerd Font Mono", ui-monospace, SFMono-Regular, "Cascadia Code", Consolas, "Liberation Mono", monospace'
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  compact: "4px"
  control: "6px"
  light-major: "8px"
  dark-secondary: "12px"
  dark-major: "14px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  page: "20px"
  section: "24px"
components:
  button-primary:
    backgroundColor: "{colors.dark-success}"
    textColor: "{colors.dark-surface}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  button-accent:
    backgroundColor: "{colors.dark-accent}"
    textColor: "{colors.dark-surface}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "6px 8px"
  status-chip:
    textColor: "{colors.dark-success}"
    typography: "{typography.mono}"
    rounded: "{rounded.pill}"
    padding: "3px 7px"
  navigation-active:
    textColor: "{colors.dark-accent}"
    typography: "{typography.title}"
    padding: "9px 10px 8px"
  input-field:
    textColor: "{colors.dark-text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "6px 8px"
  glass-card:
    textColor: "{colors.dark-text}"
    rounded: "{rounded.dark-major}"
    padding: "12px"
  glass-dialog:
    textColor: "{colors.dark-text}"
    rounded: "{rounded.dark-major}"
---

# Design System: Lanternwatch

## Overview

**Creative North Star: "The Amber Field Report"**

Lanternwatch is a dark amber liquid-glass operational console. It should feel like a precise field report: compact, layered, and candid about what the runtime actually recorded. Warm off-white text carries the hierarchy over a charcoal-brown field; amber marks focus and selection without becoming a decorative wash.

Glass is a material for the outer structure, not every object. The sticky header, navigation, major cards, popovers, and dialogs receive translucent depth. Dense controls, rows, tables, and nested data regions stay opaque enough to scan. The light theme remains the accepted warm-paper baseline rather than imitating the dark glass treatment.

**Key Characteristics:**

- Dark-first charcoal-brown field with restrained amber light.
- Translucent glass only on major surfaces; dense data stays opaque.
- Compact operational density with truthful semantic status colors.
- Visible keyboard focus, responsive stacking, and explicit low-transparency fallbacks.

## Colors

The default theme combines warm charcoal and parchment with one amber accent; semantic green, orange, and coral remain distinct so status never depends on decoration alone. The light theme uses the same semantic roles on a warm-paper baseline. The frontmatter values are the normative defaults; valid saved appearance-v2 palettes may override them at runtime after contrast normalization.

### Primary

- **Lantern Amber:** Selection, active navigation, links, estimates, and focus visibility.

### Secondary

- **Signal Green:** Complete, connected, and live states, plus the standard primary action.
- **Working Orange:** Working and queued states.
- **Failure Coral:** Interrupted, stalled, offline, invalid, and error states.

### Neutral

- **Charcoal Brown:** Default dark canvas and the base mixed into dark derived surfaces.
- **Warm Parchment:** Default dark-theme text and highlight source.
- **Warm Paper:** Accepted light-theme canvas.
- **Ink Green:** Accepted light-theme text.

### Named Rules

**The Semantic Signal Rule.** Accent indicates selection and focus; success, warning, and danger retain their own roles and must not be collapsed into amber.

**The Recorded-Fact Rule.** Color may clarify stored lifecycle data, but it must not imply forecasts, success rates, historical concurrency, or other unrecorded telemetry.

## Typography

**UI Font:** FiraCode Nerd Font (self-hosted; 400, 500, 600, and 700), with a metric-compatible system monospace fallback stack.

**Runtime Font:** FiraCode Nerd Font Mono (self-hosted; 400 and 600), with the same metric-compatible system monospace fallback stack.

**Character:** FiraCode provides the consistent product voice across headings, copy, labels, and controls. The separate Mono face is reserved for identifiers, paths, counts, timestamps, and tabular runtime facts.

### Hierarchy

- **Display** (600, `clamp(22px, 2.2vw, 28px)`, 1.16): Page-level operational headings, balanced and capped near 18 characters per line.
- **Title** (600, 13-16px, approximately 1.5): Panel, card, dialog, and roster headings.
- **Body** (400, 14px, 1.5): Default product text; explanatory copy narrows to roughly 58 characters.
- **Label** (600, 9-12px, compact line height): Controls, metadata, section labels, and state annotations.
- **Mono** (400-600, 9-12px, 1.2-1.4): Runtime durations, source paths, IDs, counters, and numeric facts.

### Named Rules

**The Runtime-Fact Rule.** Use monospace where alignment or literal identity improves verification, never as the general display voice.

## Layout

The content frame is fluid up to 1440px with 20px desktop page insets and 24px top spacing. Primary work areas use asymmetric grids to keep the current operational focus wider than supporting context; card internals follow a compact 4-12px rhythm, while major sections use 16-24px separation.

At 900px, multi-column workspaces and activity regions collapse to one column. At 760px, page insets tighten and the hero stacks. At 480px, controls and metadata reflow vertically, nonessential labels recede, and primary actions become full width. At 380px, the densest run grids become one column. Long names and paths wrap or stack where needed and must never overlap neighboring content.

## Elevation & Depth

Dark mode uses a hybrid of tonal layering and restrained liquid glass. The page supplies two subtle amber/orange radial lights over the charcoal field. Major surfaces use a translucent dark fill, a thin warm highlight edge, `blur(18px) saturate(138%)`, and one soft inset-plus-offset shadow. Light mode removes glass blur and uses flatter warm-paper surfaces.

### Shadow Vocabulary

- **Major glass:** `inset 0 1px 0 color-mix(in srgb, #ffffff 10%, transparent), 0 18px 42px rgb(5 2 1 / .24)` for primary cards and work regions.
- **Secondary glass:** `inset 0 1px 0 color-mix(in srgb, #ffffff 8%, transparent), 0 12px 30px rgb(5 2 1 / .18)` for compact operational cards.
- **Popover glass:** `inset 0 1px 0 color-mix(in srgb, #ffffff 11%, transparent), 0 16px 38px rgb(5 2 1 / .32)` for temporary floating panels.
- **Dialog glass:** `inset 0 1px 0 color-mix(in srgb, #ffffff 10%, transparent), 0 20px 50px rgb(5 2 1 / .4)` for modal depth over the dark backdrop.

### Named Rules

**The One Glass Layer Rule.** Apply glass to the containing major surface; keep dense nested controls and rows opaque instead of stacking blur on blur.

**The Legible Fallback Rule.** When backdrop filtering is unavailable or reduced transparency is requested, replace translucent fills with 93-98% opaque derived surfaces and remove blur. In forced colors, use system canvas/text colors, borders, and no shadows.

## Shapes

The dark system gives major surfaces compact 12-14px corners, with 14px reserved for primary cards and dialogs and 12px for secondary cards, charts, roster cards, and popovers. Controls stay tighter at 4-6px. Pills and live/status dots are fully rounded. The accepted light baseline flattens the material and reduces major radii to 7-10px.

## Components

Components are restrained, compact, and explicit about state.

### Buttons

- **Shape:** Compact controls use a 6px radius and 6px by 12px padding for the standard action.
- **Primary:** Standard submit actions use Signal Green with Charcoal Brown text; agent-management confirmation actions use Lantern Amber with the same dark text.
- **Hover / Focus:** Hover changes brightness or the neutral surface. Keyboard focus is a 2px accent outline offset by 3px; active controls translate down by 1px. State transitions use 160ms ease.
- **Secondary / Ghost:** Neutral buttons stay opaque on a subtle canvas fill with a semantic border.

### Chips

- **Style:** Status, count, source, and tag chips use compact 3-7px padding, semantic text, an opaque canvas, and a 999px pill radius.
- **State:** Pair semantic color with text, shape, or status copy; never rely on hue alone.

### Cards / Containers

- **Corner Style:** 14px for major dark cards; 12px for secondary dark cards.
- **Background:** Major dark cards use the shared translucent surface token. Nested rows and data modules use the opaque canvas or subtle canvas.
- **Shadow Strategy:** Use the major or secondary vocabulary above, once per containing surface.
- **Border:** One thin glass edge on major surfaces; quiet derived borders divide dense content.
- **Internal Padding:** 8-12px for compact modules, with 16px between major card groups.

### Inputs / Fields

- **Style:** Opaque canvas fill, a derived 1px border, 4-6px radius, and 6-8px internal padding.
- **Focus:** The same 2px accent outline offset by 3px used throughout the product.
- **Error / Disabled:** Error states use Failure Coral plus visible error text. Disabled controls retain their role while reducing opacity and blocking interaction.

### Navigation

The sticky header and tab rail share the outer glass material. Navigation labels are 13px; hover uses a subtle opaque fill, and the active route uses Lantern Amber text plus a 2px underline. At narrow widths icons may recede, but route names and keyboard focus remain available.

### Runtime Status Visuals

Charts, progress rails, contribution cells, dots, and square marks are direct encodings of recorded source data. Working is orange, complete/live is green, interrupted/stalled is coral, and estimates are explicitly styled as estimates. Empty and incomplete states remain honest instead of manufacturing a populated graph.

## Do's and Don'ts

### Do:

- **Do** use liquid glass for the sticky chrome, major cards, popovers, and dialogs.
- **Do** keep dense controls, rows, and nested data regions opaque and scan-friendly.
- **Do** preserve the exact semantic role separation between accent, success, warning, and danger.
- **Do** retain no-blur, reduced-transparency, reduced-motion, and forced-colors behavior.
- **Do** let long paths and names wrap or stack, with accessible full-text labels where truncation remains necessary.

### Don't:

- **Don't** stack multiple translucent layers inside a glass card.
- **Don't** use decorative charts or status marks that imply telemetry the product did not record.
- **Don't** use amber as a substitute for success, warning, or danger.
- **Don't** allow surface polish to weaken focus visibility, text contrast, or readable empty states.
- **Don't** copy reference artwork or text, or introduce generated imagery or image-embedded text.
