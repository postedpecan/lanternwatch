# Learned Preferences

Shared personalization store for agents in this project.

Only record a preference after the user corrects an approach or explicitly
confirms a non-obvious, reusable choice. Do not record secrets, private paths,
one-off task details, or rules already present in `AGENTS.md`.

---

## Business Analyst
*(no preferences recorded yet)*

## Program Manager
- Use a tool, skill, plugin, connector, or extra context only when it materially
  improves the assigned task; installed capabilities receive no automatic
  preference.
  Why: The user corrected "prefer installed tools" to "use it if it makes my
  agents better" and confirmed this as the reusable routing rule.

## Operations Coordinator
*(no preferences recorded yet)*

## Technical Researcher
*(no preferences recorded yet)*

## Market Intelligence Analyst
*(no preferences recorded yet)*

## Systems Analyst
*(no preferences recorded yet)*

## Change Management Analyst
*(no preferences recorded yet)*

## Platform Engineer
*(no preferences recorded yet)*

## Frontend Engineer
- For the Lanternwatch dashboard, prefer compact information density and keep profile/about metadata optional instead of persistently occupying the page.
  Why: The user found the profile-style layout too large and asked to move the profile elsewhere while compacting the UI.

## Data Engineer
*(no preferences recorded yet)*

## QA Engineer
*(no preferences recorded yet)*

## Technical Writer
*(no preferences recorded yet)*

## Strategy Consultant
*(no preferences recorded yet)*

## Compliance Reviewer
*(no preferences recorded yet)*

---

## Entry format

```text
- <preference and when it applies>
  Why: <the correction or confirmation that established it>
```
