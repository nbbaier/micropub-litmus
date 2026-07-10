/**
 * parseMicropub — the pure normalization workhorse (spec §7, build slice 3).
 *
 * Inbound Micropub create requests arrive in three wire formats. This function
 * folds all three into one canonical Microformats-2 shape so every downstream
 * validator (spec §8) reasons about a single structure instead of three.
 *
 * The three formats and how they map:
 *
 * - `application/json` — already canonical-ish mf2 JSON. Preserved verbatim
 *   (including the `photo` alt-text object form `[{ value, alt }]`); shape
 *   validation is the validators' job, not this function's. mp-* commands,
 *   `action`, and `url` sit at the top level as siblings of `properties`.
 * - `application/x-www-form-urlencoded` — the Micropub form→JSON algorithm
 *   (Micropub spec §3.3.1): `h=entry` → `type: ['h-entry']`; scalar fields →
 *   single-element arrays; `key[]` → arrays; `mp-*` / `access_token` / `action`
 *   / `url` are reserved and handled specially (never folded into properties).
 * - `multipart/form-data` — identical to form for text fields. File parts
 *   (`photo`/`video`/`audio` uploads) are deferred to media handling (spec §7),
 *   so non-string parts are skipped here.
 *
 * Ported against `aaronpk/micropub.rocks` (`app/ClientTests.php::micropub`) for
 * the fiddly edges the spec flags as least-trustworthy sight-unseen: content-type
 * detection (lines ~471–540) and the reserved-key handling. The original never
 * builds a single canonical object — it validates raw params inline — so the
 * canonical `{ type, properties }` shape itself follows Micropub spec §3.3.1.
 */

export type MicropubFormat = "form" | "json" | "multipart";

/** Canonical mf2 view of a create request. Superset of spec §8's `{type, properties}`. */
export interface CanonicalMicropub {
  /** Non-create action (`update`/`delete`/`undelete`). Omitted for creates. */
  action?: string;
  /** Reserved `mp-*` server commands, extracted out of `properties`. Omitted when none. */
  commands?: Record<string, unknown>;
  /**
   * mf2 properties. For form/multipart every value is an array (form→JSON
   * coercion). For JSON, values are preserved exactly as sent — including
   * non-arrays — so validators can flag malformed input.
   */
  properties: Record<string, unknown>;
  /** mf2 types, e.g. `['h-entry']`. Empty when the request declared none. */
  type: string[];
  /** Target post URL for an `action`. Omitted when absent. */
  url?: string;
}

export interface ParsedMicropub {
  canonical: CanonicalMicropub;
  format: MicropubFormat;
  /** The raw request body, preserved verbatim for the debug dump (spec §8/§4). */
  raw: string;
}

// Content-type detection mirrors the PHP branch order: multipart is matched by
// its own pattern, JSON leniently (real clients append `; charset=utf-8`), and
// everything else — including x-www-form-urlencoded — falls through to `form`,
// exactly as the original's `else` branch does.
const MULTIPART_CONTENT_TYPE = /multipart\/form-data/i;
const JSON_CONTENT_TYPE = /application\/json/i;
/** Trailing `[]` on a form key (`category[]`), stripped to the property name. */
const ARRAY_KEY_SUFFIX = /\[\]$/;

const RESERVED_H = "h";
const RESERVED_ACCESS_TOKEN = "access_token";
const RESERVED_ACTION = "action";
const RESERVED_URL = "url";
const MP_COMMAND_PREFIX = "mp-";
const PROPERTIES_KEY = "properties";
const TYPE_KEY = "type";

export async function parseMicropub(request: Request): Promise<ParsedMicropub> {
  const contentType = request.headers.get("content-type") ?? "";
  // Clone so the raw body survives for the debug dump regardless of how the
  // original request stream is later consumed (multipart needs formData()).
  const raw = await request.clone().text();

  if (MULTIPART_CONTENT_TYPE.test(contentType)) {
    const form = await request.formData();
    return { canonical: formToCanonical(form), format: "multipart", raw };
  }

  if (JSON_CONTENT_TYPE.test(contentType)) {
    return { canonical: jsonToCanonical(raw), format: "json", raw };
  }

  // Default branch: x-www-form-urlencoded and anything unrecognized. Parse the
  // urlencoded body straight from `raw` — no second stream read needed.
  return {
    canonical: formToCanonical(new URLSearchParams(raw)),
    format: "form",
    raw,
  };
}

/**
 * Collect a form/query source into `key → string[]`, dropping non-string parts.
 * File parts (multipart uploads) are `File` objects here and are deferred to the
 * media endpoint (spec §7), so they never reach the canonical properties.
 */
function collectFields(
  source: URLSearchParams | FormData
): Map<string, string[]> {
  const fields = new Map<string, string[]>();
  for (const [key, value] of source.entries()) {
    if (typeof value !== "string") {
      continue;
    }
    const existing = fields.get(key);
    if (existing) {
      existing.push(value);
    } else {
      fields.set(key, [value]);
    }
  }
  return fields;
}

/** Apply the Micropub form→JSON algorithm to a form/multipart field source. */
function formToCanonical(
  source: URLSearchParams | FormData
): CanonicalMicropub {
  const type: string[] = [];
  const properties: Record<string, unknown> = {};
  const commands: Record<string, unknown> = {};
  let action: string | undefined;
  let url: string | undefined;

  for (const [rawKey, values] of collectFields(source)) {
    if (rawKey === RESERVED_ACCESS_TOKEN) {
      // Auth credential, never a property (spec §6). Handled by the auth path.
      continue;
    }
    const [firstValue] = values;
    if (rawKey === RESERVED_H) {
      if (firstValue) {
        type.push(`h-${firstValue}`);
      }
      continue;
    }
    if (rawKey === RESERVED_ACTION) {
      action = firstValue;
      continue;
    }
    if (rawKey === RESERVED_URL) {
      url = firstValue;
      continue;
    }

    // `category[]` and `category` both normalize to the `category` property.
    const key = rawKey.replace(ARRAY_KEY_SUFFIX, "");
    const bucket = key.startsWith(MP_COMMAND_PREFIX) ? commands : properties;
    const existing = bucket[key] as string[] | undefined;
    if (existing) {
      for (const value of values) {
        existing.push(value);
      }
    } else {
      bucket[key] = values;
    }
  }

  return buildCanonical(type, properties, commands, action, url);
}

/** Structure an already-mf2 JSON body, preserving property values verbatim. */
function jsonToCanonical(raw: string): CanonicalMicropub {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { properties: {}, type: [] };
  }
  const obj = parsed as Record<string, unknown>;

  // Preserve `type` exactly: a non-array `type` (e.g. the string "h-entry") is
  // malformed and must stay non-conformant so validators can reject it — do NOT
  // coerce it into an array here (that would silently "fix" a failing request).
  const type = Array.isArray(obj[TYPE_KEY]) ? (obj[TYPE_KEY] as string[]) : [];

  const rawProperties = obj[PROPERTIES_KEY];
  const properties: Record<string, unknown> =
    rawProperties &&
    typeof rawProperties === "object" &&
    !Array.isArray(rawProperties)
      ? { ...(rawProperties as Record<string, unknown>) }
      : {};

  // In JSON, mp-* commands are top-level siblings of `properties`, not nested.
  const commands: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith(MP_COMMAND_PREFIX)) {
      commands[key] = value;
    }
  }

  const action =
    typeof obj[RESERVED_ACTION] === "string"
      ? (obj[RESERVED_ACTION] as string)
      : undefined;
  const url =
    typeof obj[RESERVED_URL] === "string"
      ? (obj[RESERVED_URL] as string)
      : undefined;

  return buildCanonical(type, properties, commands, action, url);
}

/** Assemble the canonical object, omitting optional fields that carry nothing. */
function buildCanonical(
  type: string[],
  properties: Record<string, unknown>,
  commands: Record<string, unknown>,
  action: string | undefined,
  url: string | undefined
): CanonicalMicropub {
  const canonical: CanonicalMicropub = { properties, type };
  if (Object.keys(commands).length > 0) {
    canonical.commands = commands;
  }
  if (action !== undefined) {
    canonical.action = action;
  }
  if (url !== undefined) {
    canonical.url = url;
  }
  return canonical;
}
