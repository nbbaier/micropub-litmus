# Implementation Notes

Append-only build log (spec "Working conventions"). Terse entries, newest at the
bottom of each section. Re-read Deviations before starting each new slice.

## Deviations

<!-- Spec said X, did Y instead. Format: [spec section] — what changed — why -->

## Spec gaps

<!-- Spec was silent, made a call. Format: [area] — decision — rationale -->

- [DO storage backend] — used `new_sqlite_classes` (SQLite backend) for
  `TestSession` rather than the classic KV-only backend — spec §4 says "KV is
  enough for v1" but SQLite is now required for new DO classes and the KV
  storage API (`ctx.storage.get/put`) runs unchanged on it. Keeps the §4 schema
  code identical while satisfying the platform.
- [token format] — session token = `crypto.randomUUID()` with hyphens stripped
  (32 hex chars) — spec leaves v1 token format unspecified; opaque + URL-safe.
- [package manager / runner] — Bun for install, `wrangler dev` for the local
  runtime. Alchemy IaC is deferred to the deploy slice (#10) per §12.9.

## Discovered unknowns

- [DO lifecycle] — DOs are lazy: a stub obtained via `idFromName` does not
  instantiate until its first `fetch`. "Creating the DO" on `GET /` therefore
  means an explicit `stub.fetch('/init')` that writes `meta`. A session route
  hitting a never-initialized token reaches a live-but-empty DO (no `meta`),
  which is how the Worker distinguishes real from bogus tokens (→ 404).

---

## Build slices completed

- **Slice 1 (spec §12.1, ticket #2)** — Worker + Hono skeleton, token minting on
  `GET /`, empty `TestSession` DO stub wired via `idFromName('client-'+token)`.
  Verified with `wrangler dev`: `GET /` mints distinct tokens and materializes
  the DO; `GET /client/:token` forwards to the DO and reads its `meta` (real
  token → 200, bogus → 404); `tsc --noEmit` clean. Files: `src/index.ts`,
  `src/session.ts`, `src/types.ts`, `wrangler.jsonc`, `tsconfig.json`,
  `package.json`.
