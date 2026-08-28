import { describe, expect, it } from "vitest";
import { parseMicropub } from "./micropub";

/** Build a form-urlencoded Micropub request from a raw body string. */
function formRequest(body: string): Request {
  return new Request("https://example.test/mp", {
    body,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
}

/** Build a JSON Micropub request; `contentType` overridable to test detection. */
function jsonRequest(
  payload: unknown,
  contentType = "application/json"
): Request {
  return new Request("https://example.test/mp", {
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
    headers: { "content-type": contentType },
    method: "POST",
  });
}

/** Build a multipart request from a FormData instance (boundary auto-set). */
function multipartRequest(form: FormData): Request {
  return new Request("https://example.test/mp", { body: form, method: "POST" });
}

describe("parseMicropub — form-urlencoded", () => {
  it("normalizes h=entry into type ['h-entry'] and scalars into single-element arrays", async () => {
    const parsed = await parseMicropub(
      formRequest("h=entry&content=hello+world")
    );

    expect(parsed.format).toBe("form");
    expect(parsed.canonical.type).toEqual(["h-entry"]);
    expect(parsed.canonical.properties.content).toEqual(["hello world"]);
  });

  it("coerces key[] notation into an array with every value (spec §7 [] coercion)", async () => {
    const parsed = await parseMicropub(
      formRequest("h=entry&category[]=foo&category[]=bar&category[]=baz")
    );

    expect(parsed.canonical.properties.category).toEqual(["foo", "bar", "baz"]);
  });

  it("keeps a lone key[] value as a one-element array (still array, not scalar)", async () => {
    const parsed = await parseMicropub(formRequest("h=entry&category[]=solo"));

    expect(parsed.canonical.properties.category).toEqual(["solo"]);
  });

  it("carries a photo URL string through as a property (test 104 shape)", async () => {
    const parsed = await parseMicropub(
      formRequest("h=entry&content=x&photo=https%3A%2F%2Fexample.test%2Fa.jpg")
    );

    expect(parsed.canonical.properties.photo).toEqual([
      "https://example.test/a.jpg",
    ]);
  });

  it("routes mp-* keys to commands and never into properties", async () => {
    const parsed = await parseMicropub(
      formRequest(
        "h=entry&content=x&mp-slug=my-post&mp-syndicate-to[]=https%3A%2F%2Ffed.test"
      )
    );

    expect(parsed.canonical.commands).toEqual({
      "mp-slug": ["my-post"],
      "mp-syndicate-to": ["https://fed.test"],
    });
    expect(parsed.canonical.properties).not.toHaveProperty("mp-slug");
    expect(parsed.canonical.properties).not.toHaveProperty("mp-syndicate-to");
  });

  it("strips access_token — it is auth, not a property or command", async () => {
    const parsed = await parseMicropub(
      formRequest("h=entry&content=x&access_token=secret123")
    );

    expect(parsed.canonical.properties).not.toHaveProperty("access_token");
    expect(parsed.canonical.commands).toBeUndefined();
    expect(parsed.raw).toContain("access_token=secret123");
    expect(JSON.stringify(parsed.canonical)).not.toContain("secret123");
  });

  it("flags an access token sent in the body without exposing its value (case 106)", async () => {
    const parsed = await parseMicropub(
      formRequest("h=entry&content=x&access_token=secret123")
    );

    expect(parsed.accessTokenInBody).toBe(true);
    expect(parsed.fieldArity).not.toHaveProperty("access_token");
  });

  it("treats a bracketed access_token[] as a body token too", async () => {
    // PHP exposes `access_token[]=x` as `$_POST['access_token']`, so the
    // credential must be discarded and flagged, never folded into properties.
    const parsed = await parseMicropub(
      formRequest("h=entry&content=x&access_token[]=secret123")
    );

    expect(parsed.accessTokenInBody).toBe(true);
    expect(parsed.canonical.properties).not.toHaveProperty("access_token");
    expect(parsed.canonical.commands).toBeUndefined();
    expect(parsed.fieldArity).not.toHaveProperty("access_token");
  });

  it("omits accessTokenInBody when the token is not in the body", async () => {
    const parsed = await parseMicropub(formRequest("h=entry&content=x"));

    expect(parsed.accessTokenInBody).toBeUndefined();
  });

  it("lifts action and url to the top level for non-create requests", async () => {
    const parsed = await parseMicropub(
      formRequest(
        "action=delete&url=https%3A%2F%2Fexample.test%2Fclient%2Ftok%2F1%2Fabc"
      )
    );

    expect(parsed.canonical.action).toBe("delete");
    expect(parsed.canonical.url).toBe("https://example.test/client/tok/1/abc");
    expect(parsed.canonical.properties).not.toHaveProperty("action");
    expect(parsed.canonical.properties).not.toHaveProperty("url");
  });

  it("yields an empty type array when no h parameter is present", async () => {
    const parsed = await parseMicropub(formRequest("content=orphan"));

    expect(parsed.canonical.type).toEqual([]);
    expect(parsed.canonical.properties.content).toEqual(["orphan"]);
  });

  it("preserves the raw body verbatim", async () => {
    const body = "h=entry&content=raw+check";
    const parsed = await parseMicropub(formRequest(body));

    expect(parsed.raw).toBe(body);
  });

  it("omits commands/action/url/update when the request carries none", async () => {
    const parsed = await parseMicropub(formRequest("h=entry&content=x"));

    expect(parsed.canonical.commands).toBeUndefined();
    expect(parsed.canonical.action).toBeUndefined();
    expect(parsed.canonical.url).toBeUndefined();
    expect(parsed.canonical.update).toBeUndefined();
  });
});

describe("parseMicropub — form field arity (scalar vs [] on the wire)", () => {
  it("records a bare field as scalar and a bracketed one as array (cases 100/101)", async () => {
    const parsed = await parseMicropub(
      formRequest("h=entry&content=hello&category[]=a&category[]=b")
    );

    expect(parsed.fieldArity).toEqual({
      category: "array",
      content: "scalar",
    });
    // Canonical still coerces both to arrays per Micropub §3.3.1.
    expect(parsed.canonical.properties.content).toEqual(["hello"]);
    expect(parsed.canonical.properties.category).toEqual(["a", "b"]);
  });

  it("keeps a single bracketed value as array arity, not scalar (case 101)", async () => {
    const parsed = await parseMicropub(formRequest("h=entry&category[]=solo"));

    expect(parsed.fieldArity?.category).toBe("array");
  });

  it("treats a repeated bare key as scalar arity (PHP parse_str keeps the last)", async () => {
    const parsed = await parseMicropub(
      formRequest("h=entry&content=first&content=second")
    );

    expect(parsed.fieldArity?.content).toBe("scalar");
    expect(parsed.canonical.properties.content).toEqual(["first", "second"]);
  });

  it("lets the last spelling decide arity when bare comes first, [] last", async () => {
    // PHP parse_str: `photo=a&photo[]=b` → ['b'] (the [] assignment replaces
    // the string), so the ported case 104 sees an array.
    const parsed = await parseMicropub(
      formRequest("h=entry&photo=https%3A%2F%2Fa.test%2F1.jpg&photo[]=b")
    );

    expect(parsed.fieldArity?.photo).toBe("array");
    expect(parsed.canonical.properties.photo).toEqual([
      "https://a.test/1.jpg",
      "b",
    ]);
  });

  it("lets the last spelling decide arity when [] comes first, bare last", async () => {
    // PHP parse_str: `category[]=foo&category=bar` → 'bar' (the scalar
    // assignment replaces the array), so the ported case 101 rejects it.
    const parsed = await parseMicropub(
      formRequest("h=entry&category[]=foo&category=bar")
    );

    expect(parsed.fieldArity?.category).toBe("scalar");
    expect(parsed.canonical.properties.category).toEqual(["foo", "bar"]);
  });

  it("uses wire order, not grouped order, across interleaved spellings", async () => {
    const parsed = await parseMicropub(
      formRequest("h=entry&category=a&category[]=b&category=c&category[]=d")
    );

    expect(parsed.fieldArity?.category).toBe("array");
  });

  it("records arity for mp-* commands too (they are form fields as well)", async () => {
    const parsed = await parseMicropub(
      formRequest(
        "h=entry&mp-slug=a-post&mp-syndicate-to[]=https%3A%2F%2Ff.test"
      )
    );

    expect(parsed.fieldArity).toEqual({
      "mp-slug": "scalar",
      "mp-syndicate-to": "array",
    });
  });

  it("does not record arity for reserved h/action/url fields", async () => {
    const parsed = await parseMicropub(
      formRequest("h=entry&action=delete&url=https%3A%2F%2Fa.test%2F1")
    );

    expect(parsed.fieldArity).toBeUndefined();
  });

  it("records arity for multipart text fields, and never for JSON", async () => {
    const form = new FormData();
    form.append("h", "entry");
    form.append("content", "hi");
    form.append("category[]", "a");

    const multipart = await parseMicropub(multipartRequest(form));
    const json = await parseMicropub(
      jsonRequest({ properties: { content: ["hi"] }, type: ["h-entry"] })
    );

    expect(multipart.fieldArity).toEqual({
      category: "array",
      content: "scalar",
    });
    expect(json.fieldArity).toBeUndefined();
  });
});

describe("parseMicropub — JSON", () => {
  it("preserves an already-canonical h-entry verbatim", async () => {
    const parsed = await parseMicropub(
      jsonRequest({ properties: { content: ["hello"] }, type: ["h-entry"] })
    );

    expect(parsed.format).toBe("json");
    expect(parsed.canonical.type).toEqual(["h-entry"]);
    expect(parsed.canonical.properties.content).toEqual(["hello"]);
  });

  it("preserves the photo alt-text object form untouched", async () => {
    const photo = [
      { alt: "A sunset over the sea", value: "https://example.test/a.jpg" },
    ];
    const parsed = await parseMicropub(
      jsonRequest({ properties: { photo }, type: ["h-entry"] })
    );

    expect(parsed.canonical.properties.photo).toEqual(photo);
  });

  it("extracts top-level mp-* commands and leaves properties clean", async () => {
    const parsed = await parseMicropub(
      jsonRequest({
        "mp-slug": ["my-post"],
        properties: { content: ["x"] },
        type: ["h-entry"],
      })
    );

    expect(parsed.canonical.commands).toEqual({ "mp-slug": ["my-post"] });
    expect(parsed.canonical.properties).not.toHaveProperty("mp-slug");
  });

  it("lifts top-level action and url for update/delete requests", async () => {
    const parsed = await parseMicropub(
      jsonRequest({
        action: "update",
        replace: { content: ["new"] },
        url: "https://example.test/p/1",
      })
    );

    expect(parsed.canonical.action).toBe("update");
    expect(parsed.canonical.url).toBe("https://example.test/p/1");
  });

  it("carries the replace object of an update through verbatim (case 400)", async () => {
    const parsed = await parseMicropub(
      jsonRequest({
        action: "update",
        replace: { content: ["updated content here"] },
        url: "https://example.test/p/1",
      })
    );

    expect(parsed.canonical.update).toEqual({
      replace: { content: ["updated content here"] },
    });
  });

  it("carries add and delete objects of an update (cases 401/402)", async () => {
    const parsed = await parseMicropub(
      jsonRequest({
        action: "update",
        add: { category: ["foo"] },
        delete: { category: ["bar"] },
        url: "https://example.test/p/1",
      })
    );

    expect(parsed.canonical.update).toEqual({
      add: { category: ["foo"] },
      delete: { category: ["bar"] },
    });
  });

  it("carries a delete given as an array of property names (case 403)", async () => {
    const parsed = await parseMicropub(
      jsonRequest({
        action: "update",
        delete: ["category"],
        url: "https://example.test/p/1",
      })
    );

    expect(parsed.canonical.update).toEqual({ delete: ["category"] });
  });

  it("preserves a malformed update operation verbatim for the validator", async () => {
    const parsed = await parseMicropub(
      jsonRequest({
        action: "update",
        replace: { content: "not-an-array" },
        url: "https://example.test/p/1",
      })
    );

    expect(parsed.canonical.update).toEqual({
      replace: { content: "not-an-array" },
    });
  });

  it("omits update for a create and for a delete action", async () => {
    const create = await parseMicropub(
      jsonRequest({ properties: { content: ["x"] }, type: ["h-entry"] })
    );
    const del = await parseMicropub(
      jsonRequest({ action: "delete", url: "https://example.test/p/1" })
    );

    expect(create.canonical.update).toBeUndefined();
    expect(del.canonical.update).toBeUndefined();
  });

  it("does NOT coerce a string type into an array (malformed stays non-conformant)", async () => {
    const parsed = await parseMicropub(
      jsonRequest({ properties: { content: ["x"] }, type: "h-entry" })
    );

    expect(parsed.canonical.type).toEqual([]);
    expect(parsed.issues).toEqual(["invalid-json-type"]);
  });

  it("reports an array containing non-string types as malformed", async () => {
    const parsed = await parseMicropub(
      jsonRequest({ properties: {}, type: ["h-entry", 1] })
    );

    expect(parsed.canonical.type).toEqual([]);
    expect(parsed.issues).toEqual(["invalid-json-type"]);
  });

  it("preserves a non-array property value verbatim for the validator to reject", async () => {
    const parsed = await parseMicropub(
      jsonRequest({
        properties: { content: "not-an-array" },
        type: ["h-entry"],
      })
    );

    expect(parsed.canonical.properties.content).toBe("not-an-array");
  });

  it("detects JSON even with a charset parameter on the content-type", async () => {
    const parsed = await parseMicropub(
      jsonRequest(
        { properties: {}, type: ["h-entry"] },
        "application/json; charset=utf-8"
      )
    );

    expect(parsed.format).toBe("json");
  });

  it("falls back to an empty canonical for a malformed JSON body", async () => {
    const parsed = await parseMicropub(jsonRequest("{ not valid json"));

    expect(parsed.canonical).toEqual({ properties: {}, type: [] });
    expect(parsed.issues).toEqual(["invalid-json"]);
  });

  it("reports a non-object JSON root as malformed", async () => {
    const parsed = await parseMicropub(jsonRequest(["h-entry"]));

    expect(parsed.canonical).toEqual({ properties: {}, type: [] });
    expect(parsed.issues).toEqual(["invalid-json-root"]);
  });

  it("reports missing properties instead of silently treating them as valid", async () => {
    const parsed = await parseMicropub(jsonRequest({ type: ["h-entry"] }));

    expect(parsed.canonical.properties).toEqual({});
    expect(parsed.issues).toEqual(["invalid-json-properties"]);
  });

  it("reports an array-valued properties container as malformed", async () => {
    const parsed = await parseMicropub(
      jsonRequest({ properties: [], type: ["h-entry"] })
    );

    expect(parsed.canonical.properties).toEqual({});
    expect(parsed.issues).toEqual(["invalid-json-properties"]);
  });
});

describe("parseMicropub — multipart/form-data", () => {
  it("normalizes text fields exactly like form-encoded, including [] arrays", async () => {
    const form = new FormData();
    form.append("h", "entry");
    form.append("content", "hello multipart");
    form.append("category[]", "a");
    form.append("category[]", "b");

    const parsed = await parseMicropub(multipartRequest(form));

    expect(parsed.format).toBe("multipart");
    expect(parsed.canonical.type).toEqual(["h-entry"]);
    expect(parsed.canonical.properties.content).toEqual(["hello multipart"]);
    expect(parsed.canonical.properties.category).toEqual(["a", "b"]);
  });

  it("keeps a file part out of properties but surfaces it on files", async () => {
    const form = new FormData();
    form.append("h", "entry");
    form.append("content", "with a photo file");
    form.append(
      "photo",
      new File(["PNG-bytes"], "pic.png", { type: "image/png" })
    );

    const parsed = await parseMicropub(multipartRequest(form));

    expect(parsed.canonical.properties).not.toHaveProperty("photo");
    expect(parsed.canonical.properties.content).toEqual(["with a photo file"]);
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files?.[0].property).toBe("photo");
    expect(parsed.files?.[0].file.name).toBe("pic.png");
  });

  it("surfaces multiple file parts and strips [] from the file field name", async () => {
    const form = new FormData();
    form.append("h", "entry");
    form.append("photo[]", new File(["a"], "one.jpg", { type: "image/jpeg" }));
    form.append("photo[]", new File(["b"], "two.jpg", { type: "image/jpeg" }));

    const parsed = await parseMicropub(multipartRequest(form));

    expect(parsed.canonical.properties).not.toHaveProperty("photo");
    expect(parsed.files?.map((f) => f.property)).toEqual(["photo", "photo"]);
    expect(parsed.files?.map((f) => f.file.name)).toEqual([
      "one.jpg",
      "two.jpg",
    ]);
  });

  it("does not surface unsupported or reserved file fields for media upload", async () => {
    const form = new FormData();
    form.append("h", "entry");
    form.append("attachment", new File(["a"], "attachment.bin"));
    form.append("access_token", new File(["secret"], "token.txt"));

    const parsed = await parseMicropub(multipartRequest(form));

    expect(parsed.files).toBeUndefined();
    expect(parsed.canonical.properties).not.toHaveProperty("attachment");
    expect(parsed.canonical.properties).not.toHaveProperty("access_token");
    // A *file* part named access_token is not a body token — PHP keeps uploads
    // out of the parsed params, so `case 301` never sees it either.
    expect(parsed.accessTokenInBody).toBeUndefined();
  });

  it("flags a bracketed multipart access_token[] text field as a body token", async () => {
    const form = new FormData();
    form.append("h", "entry");
    form.append("content", "x");
    form.append("access_token[]", "secret123");

    const parsed = await parseMicropub(multipartRequest(form));

    expect(parsed.accessTokenInBody).toBe(true);
    expect(parsed.canonical.properties).not.toHaveProperty("access_token");
    expect(parsed.fieldArity).toEqual({ content: "scalar" });
  });

  it("flags a multipart body access token without exposing it (case 301)", async () => {
    const form = new FormData();
    form.append("h", "entry");
    form.append("access_token", "secret123");
    form.append(
      "photo",
      new File(["PNG-bytes"], "pic.png", { type: "image/png" })
    );

    const parsed = await parseMicropub(multipartRequest(form));

    expect(parsed.accessTokenInBody).toBe(true);
    expect(JSON.stringify(parsed.canonical)).not.toContain("secret123");
  });

  it("omits files for a text-only multipart request", async () => {
    const form = new FormData();
    form.append("h", "entry");
    form.append("content", "text only");

    const parsed = await parseMicropub(multipartRequest(form));

    expect(parsed.files).toBeUndefined();
  });

  it("still treats a text-valued photo field as a URL property", async () => {
    const form = new FormData();
    form.append("h", "entry");
    form.append("photo", "https://example.test/remote.jpg");

    const parsed = await parseMicropub(multipartRequest(form));

    expect(parsed.canonical.properties.photo).toEqual([
      "https://example.test/remote.jpg",
    ]);
  });

  it("routes mp-* text fields to commands in multipart too", async () => {
    const form = new FormData();
    form.append("h", "entry");
    form.append("mp-slug", "multipart-slug");

    const parsed = await parseMicropub(multipartRequest(form));

    expect(parsed.canonical.commands).toEqual({
      "mp-slug": ["multipart-slug"],
    });
  });
});

describe("parseMicropub — content-type detection", () => {
  it("treats an unrecognized content-type as form (the PHP else branch)", async () => {
    const request = new Request("https://example.test/mp", {
      body: "h=entry&content=x",
      headers: { "content-type": "text/plain" },
      method: "POST",
    });

    const parsed = await parseMicropub(request);

    expect(parsed.format).toBe("form");
    expect(parsed.canonical.properties.content).toEqual(["x"]);
  });

  it("treats a missing content-type as form", async () => {
    const request = new Request("https://example.test/mp", {
      body: "h=entry&content=x",
      method: "POST",
    });
    // Undici defaults a string body to text/plain; strip it to assert the fallback.
    request.headers.delete("content-type");

    const parsed = await parseMicropub(request);

    expect(parsed.format).toBe("form");
  });
});
