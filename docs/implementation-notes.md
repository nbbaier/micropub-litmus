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
- [§7 `parseMicropub` canonical shape] — `canonical` extends §8's
  `{ type, properties }` with optional `commands` (reserved `mp-*`), `action`,
  and `url` — needed to hold the reserved keys OUT of `properties` without
  discarding them (the debug dump + update/delete paths still want them). Fields
  are omitted when empty so a plain create canonical stays `{ type, properties }`.
- [§7 form scalar-vs-array] — form/multipart scalars are coerced to
  single-element arrays per Micropub §3.3.1 (`content=x` → `['x']`). This drops
  the scalar-sent-vs-`[]`-sent distinction the original's test 100/101 detect by
  inspecting raw PHP params; a validator that needs it re-derives from `raw`.
  Logged for slice-4 (validators) to revisit.
- [§7 JSON non-coercion] — JSON `type` and property values are preserved
  verbatim, NOT coerced. A string `type` stays a non-array (→ empty `type`) and a
  non-array property value stays as-is, so validators can reject malformed input
  (ports `_requireJSONHEntry` / `_validateJSONProperties` from `ClientTests.php`).
- [§7 inline multipart file parts] — `parseMicropub` consumes `formData()` and is
  the only place the uploaded `File` objects exist. Rather than dropping them
  (which would strand the media slice — the body is already read and files can't
  be rebuilt from `raw`), file parts are surfaced on `ParsedMicropub.files`
  (`{ property, file }[]`, `[]` stripped from the field name). The parser does no
  R2 work; the media slice (§7 / build order #7) uploads each file and appends the
  URL to `canonical.properties[property]`. Additive/optional field, omitted when
  no files — canonical stays pure text mf2. (Raised in PR #12 review.)

## Discovered unknowns

- [DO lifecycle] — DOs are lazy: a stub obtained via `idFromName` does not
  instantiate until its first `fetch`. "Creating the DO" on `GET /` therefore
  means an explicit `stub.fetch('/init')` that writes `meta`. A session route
  hitting a never-initialized token reaches a live-but-empty DO (no `meta`),
  which is how the Worker distinguishes real from bogus tokens (→ 404).
- [source-reading, slice 3] — micropub.rocks has NO single form→JSON normalizer.
  `app/ClientTests.php::micropub` validates the raw parsed body inline via helpers
  (`_requireFormHEntry`, `_requireJSONHEntry`, `_validateJSONProperties`); the
  canonical `{ type, properties }` shape is our own, sourced from Micropub spec
  §3.3.1. The genuinely portable PHP edges were content-type detection (multipart
  → JSON-lenient → form fallback, lines ~471–540) and reserved-key handling.
- [test runner] — vitest (biome already extends `ultracite/biome/vitest`).
  `parseMicropub` is pure over Web-standard globals (`Request`/`FormData`/
  `URLSearchParams`), so the default node environment suffices — no
  `@cloudflare/vitest-pool-workers` needed for this slice.

---

## Build slices completed

- **Slice 1 (spec §12.1, ticket #2)** — Worker + Hono skeleton, token minting on
  `GET /`, empty `TestSession` DO stub wired via `idFromName('client-'+token)`.
  Verified with `wrangler dev`: `GET /` mints distinct tokens and materializes
  the DO; `GET /client/:token` forwards to the DO and reads its `meta` (real
  token → 200, bogus → 404); `tsc --noEmit` clean. Files: `src/index.ts`,
  `src/session.ts`, `src/types.ts`, `wrangler.jsonc`, `tsconfig.json`,
  `package.json`.
- **Slice 3 (spec §12.3, §7, ticket #4)** — pure `parseMicropub(request):
  { format, canonical, raw }` normalizing all three wire formats into canonical
  mf2 + 25 vitest unit tests. Covers form scalars→arrays, `key[]` coercion,
  `mp-*` reserved commands, `access_token` stripping, `action`/`url` lifting,
  JSON verbatim preservation incl. the `photo` alt-text object form, JSON
  non-coercion (malformed stays non-conformant), multipart text-vs-file parts
  (files deferred to media handling), and content-type detection incl. the
  form fallback. `bun run test` (25 pass), `typecheck`, `check` all clean.
  Files: `src/micropub.ts`, `src/micropub.test.ts`, `package.json` (test script
  + vitest devDep). Note: slice 2 (SSE) not yet in this branch's history.
