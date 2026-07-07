# AGENTS.md

Guidance for AI agents working in this repo.

## Agent skills

### Issue tracker

Issues and PRDs live as **GitHub issues** in `nbbaier/micropub-litmus`, managed via the `gh` CLI. External PRs are **not** a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the **canonical** five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) — label strings equal their role names. See `docs/agents/triage-labels.md`.

### Domain docs

**Single-context**: one `CONTEXT.md` + `docs/adr/` at the repo root. The build also keeps an append-only `implementation-notes.md` running log that feeds ADRs. See `docs/agents/domain.md`.
