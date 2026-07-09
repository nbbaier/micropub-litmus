# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This is a **single-context** repo: one `CONTEXT.md` + `docs/adr/` at the repo root. Alongside those durable docs, the build keeps an append-only `docs/implementation-notes.md` running log — see "The running log vs. ADRs" below for how the two blend.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root (the glossary / ubiquitous language), if it exists.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.
- **`docs/implementation-notes.md`** — the in-flight build log. Skim the **Deviations** and **Spec gaps** sections before working in an area; they record where the code intentionally diverges from `docs/spec.md`.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates `CONTEXT.md` and ADRs lazily when terms or decisions actually get resolved.

## File structure

```
/
├── CONTEXT.md                     ← domain glossary (created lazily)
├── docs/
│   ├── spec.md                    ← the build spec (source of intended behavior)
│   ├── implementation-notes.md    ← append-only build log (Deviations / Spec gaps / Discovered unknowns)
│   └── adr/                       ← durable architectural decisions
│       ├── 0001-....md
│       └── 0002-....md
└── src/
```

## The running log vs. ADRs

`docs/implementation-notes.md` and `docs/adr/` sit on a spectrum from **raw notes** to **durable decisions**. They are not redundant — know which one a given fact belongs in.

- **`docs/implementation-notes.md`** — an append-only, in-the-moment log. Terse entries, newest at the bottom of each section, three sections:
  - **Deviations** — spec said X, did Y instead (with the reason).
  - **Spec gaps** — spec was silent, a call was made.
  - **Discovered unknowns** — platform quirks, surprising costs, things harder/easier than assumed (fodder for v2).

  It is a log, **not documentation**. Don't polish it; append to it. Per the spec's working conventions: on any deviation, pick the more conservative option, log it here, and continue — only stop if the deviation invalidates a locked scope decision.

- **`docs/adr/`** — the curated, permanent record. An ADR captures a *considered* architectural decision: the context, the alternatives weighed, the choice, and its consequences. One decision per file, immutable once accepted (supersede rather than edit).

### How they blend — when a note graduates to an ADR

The seam between the two: **a log entry that turns out to be a real, load-bearing architectural decision should graduate into an ADR.**

- A **Deviation** or **Spec gap** that changes the system's architecture (a transport swap, a persistence boundary, an auth model) — promote it: write the ADR, then leave the log entry in place with a pointer (`→ ADR-0003`). The log keeps the timeline; the ADR carries the durable rationale.
- A **Discovered unknown** that is just a platform quirk, a cost observation, or a "revisit in v2" note — **keep it in the log**. It isn't a decision, so it doesn't earn an ADR.
- Rule of thumb: if a future contributor would need to understand *why the architecture is this way*, it's an ADR. If they'd only want to know *what surprised us during the build*, it stays a note.

At each milestone, re-read the **Deviations** section before starting the next slice; if a deviation contradicts a later part of the spec, resolve it then — and if that resolution is architectural, that's exactly the moment to cut an ADR.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0002 (ephemeral-only persistence) — but worth reopening because…_
