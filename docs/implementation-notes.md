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
- [§7 malformed JSON envelope] — malformed JSON syntax and invalid root, `type`,
  or `properties` shapes retain the conservative empty canonical fallback and
  now surface explicit `ParsedMicropub.issues`. This keeps the canonical contract
  type-safe while ensuring validators can distinguish malformed input from a
  valid empty value; `raw` remains the source for exact protocol error details.
- [§7 inline multipart file allowlist] — only `photo`, `video`, and `audio` file
  parts reach `ParsedMicropub.files`, matching the spec's supported inline media
  properties. Unsupported and reserved file fields are never handed to R2.
- [§7 form field arity] — RESOLVES the earlier "§7 form scalar-vs-array"
  deviation. `ParsedMicropub.fieldArity` (`Record<name, 'array' | 'scalar'>`,
  form/multipart only) records how each field arrived on the wire, so the §8
  validators can port `case 100` (`is_string($params['content'])`), `case 101`
  (`is_array($params['category'])`) and `case 104` (`is_string($params[$prop])`)
  without re-parsing `raw` — which was never viable for multipart. `canonical`
  is unchanged: everything is still coerced to arrays per Micropub §3.3.1. A key
  sent both ways (`photo=a&photo[]=b`) is `array`, matching `parse_str`. A
  repeated bare key (`content=a&content=b`) is `scalar` with both values kept;
  PHP would keep only the last, so a validator emulating it reads the last one.
- [§7 form field arity, mixed spellings] — CORRECTS the previous entry. A key
  sent both ways is NOT always `array`: `parse_str` lets the *last* occurrence
  decide (`photo=a&photo[]=b` → array, `category[]=foo&category=bar` → string),
  so arity is now decided in `collectFields` while entries are still in wire
  order — the grouped `Map` had lost the interleaving. Values from both
  spellings are still merged into `canonical`.
- [§7 access_token presence] — `access_token` stays stripped from `canonical`
  (it is auth, never content), but `ParsedMicropub.accessTokenInBody` records
  that the body carried one. `case 106`/`case 301` fail a client that sends the
  token in both the body and the `Authorization` header, and cannot see it
  otherwise. The value is never surfaced — presence is all the tests read.
- [§7 JSON update payload] — `canonical.update` carries the top-level
  `replace`/`add`/`delete` of a JSON update request verbatim (values stay
  `unknown`; `delete` is an object in `case 402` and an array in `case 403`).
  Previously these were dropped, leaving `raw` as the only source for the four
  update validators (`case 400`–`403`), each of which reports on the exact
  malformed shape the client sent.
- [§7 JSON content-type detection] — the original matches `application/json`
  with `==` (exact), so a client sending `application/json; charset=utf-8` is
  parsed as `form` and fails `_requireJSONEncoded`. We match leniently. Charset
  parameters are legal and common, and treating them as form-encoded is a bug in
  the original, not a behavior worth porting.
- [§4 SSE dead-subscriber reaping] — spec sketch says "drop writers that
  throw"; nothing throws (see Discovered unknowns), so `push()` races each
  write against a 10s timeout and drops the writer on timeout OR error.
  `request.signal` abort + `writer.closed` are wired as best-effort fast paths
  (immediate reap if they ever fire in production).
- [SSE keep-alive / reconnect] — spec silent: 15s `: keep-alive` comment frames
  so intermediaries don't reap an idle stream, and a `retry: 2000` frame at
  subscribe so a dropped `EventSource` reconnects in 2s.
- [SSE timers] — heartbeat and the slice-2 scaffold publisher start on the
  first subscriber and stop when the last one is dropped: no subscribers, no
  work, so an idle session doesn't hold the DO open.
- [§5 `/streaming/sub` channel id] — the query `id` is validated against
  `^(?:client|endpoint)-[A-Za-z0-9]{1,128}$` and used verbatim as the DO name.
  Channel name = DO name keeps the route generic for Appendix B's
  `endpoint-<id>` half instead of re-deriving `client-<token>` in the Worker.
- [§10 frontend] — session page still uses `hono/html` templates, not Hono JSX.
  The live panel is ~20 lines of markup; converting the view layer belongs with
  the test-list slice that actually needs components.

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
- [DO + TransformStream] — awaiting the first write before returning the SSE
  Response DEADLOCKS: a TransformStream write only settles once something reads
  the readable half, and nothing reads it until the Response is returned. The
  opening frame must be fire-and-forget (`.catch()`, not `await`). Symptom is a
  request that hangs with no response headers at all.
- [DO + SSE disconnects are invisible] — when a subscriber goes away, workerd
  (local `wrangler dev`) does NOT abort the DO's request signal, settle
  `writer.closed`, or reject the next `writer.write()`. Verified by counting
  subscribers across sequential connections: 1 → 2 → 3 → 4 with only one client
  ever connected. Writes just queue and hang once the internal queue fills, so
  a stalled write is the only reliable liveness signal — hence the timeout.
  Left writers accumulating, this is what would keep a DO resident forever.
- [drop uses `abort()`, not `close()`] — closing a stalled writer waits on the
  same undrained queue that got it dropped; `abort()` discards it.
- [browser verification] — `chromium --headless --dump-dom
  --virtual-time-budget=N` never terminates on a page holding an open
  `EventSource` (the load never completes). Driving `headless_shell` over CDP
  (`--remote-debugging-port` + `Runtime.evaluate` on a timer) is the way to
  assert on a live-updating panel.

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
  + vitest devDep). Slice 2 (SSE) landed on `main` afterwards; see below.
- **Slice 3, second pass (ticket #4)** — re-read the original against the three
  formats now that `lib/helpers.php` was fetched directly: it holds no
  normalization at all (only `mf2_val`, a display helper that unwraps the
  `photo` alt-text object form), confirming the earlier source-reading note.
  The re-read found three wire-level facts canonicalization was erasing that
  the ported validators need — field arity, `access_token` presence, and the
  JSON update payload — all three now surfaced (see Spec gaps above). 47 vitest
  unit tests; `test`, `typecheck`, `check` clean.
- **Slice 3, review fixes (ticket #4)** — two PR review findings: (1) mixed
  `category[]`/`category` spellings took arity from the grouped map, not wire
  order, so `category[]=foo&category=bar` was `array` where PHP yields a
  string; (2) `access_token[]` was not recognized as reserved and leaked into
  `canonical.properties`. Reserved names are now matched with `[]` stripped,
  and arity is decided in wire order (last spelling wins). 50 vitest unit
  tests; `test`, `typecheck`, `check` clean.
- **Slice 2 (spec §12.2, §4, §9, ticket #3)** — SSE fan-out in the DO. `GET
  /sub` returns a `text/event-stream` backed by a `TransformStream`; writers are
  retained in an instance `Set` across requests; `publish()` frames the §9
  `client-result` contract with a monotonic id and fans out, dropping stalled or
  errored writers. A hardcoded publisher on a 3s timer (scaffold, deleted in
  slice #5) proves the panel updates. Worker adds `GET /streaming/sub?id=` which
  streams the DO Response straight through (headers, incl. `Last-Event-ID`,
  forwarded for slice #9), and `/client/:token` now renders the live panel
  (status line, `#result`, collapsible `#debug`) with the ported EventSource
  wiring. Verified on `wrangler dev`: curl sees `retry:`/`: connected` then
  `id: N` frames; two concurrent subscribers receive identical ids (fan-out);
  sequential connect/disconnect cycles keep `subscribers` at 1 (reaping works);
  bad channel → 400, unknown session → 404; and headless Chromium over CDP shows
  `#result` advancing tick 45 → 48 with the debug pane filled. `bun run test`
  (9 new SSE-framing tests), `typecheck`, `check` clean. Files:
  `src/sse.ts`, `src/sse.test.ts`, `src/session.ts`, `src/index.ts`,
  `src/types.ts`.
- **Merge: `main` (slice 2) into the ticket #4 branch** — slices 2 and 3 now
  coexist; no conflicts in code or in this log. 59 vitest unit tests (50
  `micropub`, 9 `sse`); `test`, `typecheck`, `check` clean.
