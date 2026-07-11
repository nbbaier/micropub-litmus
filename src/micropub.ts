/**
 * parseMicropub — the pure normalization workhorse (spec §7, build slice 3).
 *
 * Inbound Micropub create requests arrive in three wire formats. This function
 * folds all three into one canonical Microformats-2 shape so every downstream
 * validator (spec §8) reasons about a single structure instead of three.
 *
 * The three formats and how they map:
 *
 * - `application/json` — already canonical-ish mf2 JSON. Property values are
 *   preserved verbatim (including `photo` alt-text objects); malformed envelope
 *   fields produce explicit `issues` for validators. mp-* commands, `action`,
 *   and `url` sit at the top level as siblings of `properties`.
 * - `application/x-www-form-urlencoded` — the Micropub form→JSON algorithm
 *   (Micropub spec §3.3.1): `h=entry` → `type: ['h-entry']`; scalar fields →
 *   single-element arrays; `key[]` → arrays; `mp-*` / `access_token` / `action`
 *   / `url` are reserved and handled specially (never folded into properties).
 * - `multipart/form-data` — identical to form for text fields. File parts
 *   (`photo`/`video`/`audio` uploads) are kept out of `properties` and surfaced
 *   on `files` instead, so the media slice can write them to R2 and swap in URLs
 *   (spec §7). The parser does no R2 work itself.
 *
 * Ported against `aaronpk/micropub.rocks` (`app/ClientTests.php::micropub`) for
 * the fiddly edges the spec flags as least-trustworthy sight-unseen: content-type
 * detection (lines ~471–540) and the reserved-key handling. The original never
 * builds a single canonical object — it validates raw params inline — so the
 * canonical `{ type, properties }` shape itself follows Micropub spec §3.3.1.
 */

export type MicropubFormat = "form" | "json" | "multipart";

export type MicropubNormalizationIssue =
  | "invalid-json"
  | "invalid-json-properties"
  | "invalid-json-root"
  | "invalid-json-type";

export type MicropubMediaProperty = "audio" | "photo" | "video";

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

/** An inline multipart file upload part, carried through to media handling. */
export interface MicropubFilePart {
  file: File;
  /**
   * The mf2 property the file belongs to (`photo`/`video`/`audio`), with any
   * trailing `[]` stripped. The media slice (spec §7) uploads the file to R2 and
   * appends the resulting URL to `canonical.properties[property]`.
   */
  property: MicropubMediaProperty;
}

export interface ParsedMicropub {
  canonical: CanonicalMicropub;
  /**
   * Inline multipart file parts (`photo`/`video`/`audio` uploads). Surfaced —
   * NOT dropped — so the media slice can write them to R2 and replace them with
   * URLs (spec §7); the parser itself stays pure and does no R2 work. Omitted
   * when the request carried no file parts.
   */
  files?: MicropubFilePart[];
  format: MicropubFormat;
  /** Malformed JSON envelope fields retained as explicit validator input. */
  issues?: MicropubNormalizationIssue[];
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
    return { ...formToCanonical(form), format: "multipart", raw };
  }

  if (JSON_CONTENT_TYPE.test(contentType)) {
    return { ...jsonToCanonical(raw), format: "json", raw };
  }

  // Default branch: x-www-form-urlencoded and anything unrecognized. Parse the
  // urlencoded body straight from `raw` — no second stream read needed.
  return { ...formToCanonical(new URLSearchParams(raw)), format: "form", raw };
}

/**
 * Split a form/query source into text fields (`key → string[]`) and file parts.
 * File parts are `File` objects (multipart uploads); rather than dropping them,
 * they are collected separately so the media slice can handle them (spec §7).
 * A `URLSearchParams` source never yields files, so `files` is empty there.
 */
function collectFields(source: URLSearchParams | FormData): {
  fields: Map<string, string[]>;
  files: MicropubFilePart[];
} {
  const fields = new Map<string, string[]>();
  const files: MicropubFilePart[] = [];
  for (const [key, value] of source.entries()) {
    if (typeof value === "string") {
      const existing = fields.get(key);
      if (existing) {
        existing.push(value);
      } else {
        fields.set(key, [value]);
      }
    } else {
      // File part: kept out of `properties` (which stays pure text mf2) and
      // handed to the caller for media handling only for Micropub's supported
      // inline media properties. Unsupported and reserved file fields must not
      // reach the R2 upload handoff.
      const property = key.replace(ARRAY_KEY_SUFFIX, "");
      if (isMediaProperty(property)) {
        files.push({ file: value, property });
      }
    }
  }
  return { fields, files };
}

function isMediaProperty(value: string): value is MicropubMediaProperty {
  return value === "audio" || value === "photo" || value === "video";
}

/** Apply the Micropub form→JSON algorithm to a form/multipart field source. */
function formToCanonical(source: URLSearchParams | FormData): {
  canonical: CanonicalMicropub;
  files?: MicropubFilePart[];
} {
  const { fields, files } = collectFields(source);
  const acc: FormAccumulator = { commands: {}, properties: {}, type: [] };
  for (const [rawKey, values] of fields) {
    applyFormField(acc, rawKey, values);
  }
  const canonical = buildCanonical(acc);
  return files.length > 0 ? { canonical, files } : { canonical };
}

/** Mutable accumulator threaded through the form→JSON field loop. */
interface FormAccumulator {
  action?: string;
  commands: Record<string, unknown>;
  properties: Record<string, unknown>;
  type: string[];
  url?: string;
}

/** Route one text field into the accumulator per the form→JSON algorithm. */
function applyFormField(
  acc: FormAccumulator,
  rawKey: string,
  values: string[]
): void {
  if (rawKey === RESERVED_ACCESS_TOKEN) {
    // Auth credential, never a property (spec §6). Handled by the auth path.
    return;
  }
  const [firstValue] = values;
  if (rawKey === RESERVED_H) {
    if (firstValue) {
      acc.type.push(`h-${firstValue}`);
    }
    return;
  }
  if (rawKey === RESERVED_ACTION) {
    acc.action = firstValue;
    return;
  }
  if (rawKey === RESERVED_URL) {
    acc.url = firstValue;
    return;
  }

  // `category[]` and `category` both normalize to the `category` property.
  const key = rawKey.replace(ARRAY_KEY_SUFFIX, "");
  const bucket = key.startsWith(MP_COMMAND_PREFIX)
    ? acc.commands
    : acc.properties;
  const existing = bucket[key] as string[] | undefined;
  if (existing) {
    for (const value of values) {
      existing.push(value);
    }
  } else {
    bucket[key] = values;
  }
}

interface JsonNormalizationResult {
  canonical: CanonicalMicropub;
  issues?: MicropubNormalizationIssue[];
}

/** Structure an already-mf2 JSON body, preserving property values verbatim. */
function jsonToCanonical(raw: string): JsonNormalizationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      canonical: { properties: {}, type: [] },
      issues: ["invalid-json"],
    };
  }

  if (!isRecord(parsed)) {
    return {
      canonical: { properties: {}, type: [] },
      issues: ["invalid-json-root"],
    };
  }
  const obj = parsed;
  const issues: MicropubNormalizationIssue[] = [];

  const rawType = obj[TYPE_KEY];
  const type = isStringArray(rawType) ? rawType : [];
  if (!isStringArray(rawType)) {
    issues.push("invalid-json-type");
  }

  const rawProperties = obj[PROPERTIES_KEY];
  const properties = isRecord(rawProperties) ? { ...rawProperties } : {};
  if (!isRecord(rawProperties)) {
    issues.push("invalid-json-properties");
  }

  // In JSON, mp-* commands are top-level siblings of `properties`, not nested.
  const commands: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith(MP_COMMAND_PREFIX)) {
      commands[key] = value;
    }
  }

  const action =
    typeof obj[RESERVED_ACTION] === "string" ? obj[RESERVED_ACTION] : undefined;
  const url =
    typeof obj[RESERVED_URL] === "string" ? obj[RESERVED_URL] : undefined;

  const canonical = buildCanonical({ action, commands, properties, type, url });
  return issues.length > 0 ? { canonical, issues } : { canonical };
}

/** Assemble the canonical object, omitting optional fields that carry nothing. */
function buildCanonical({
  action,
  commands,
  properties,
  type,
  url,
}: FormAccumulator): CanonicalMicropub {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}
