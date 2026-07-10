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

  it("omits commands/action/url when the request carries none", async () => {
    const parsed = await parseMicropub(formRequest("h=entry&content=x"));

    expect(parsed.canonical.commands).toBeUndefined();
    expect(parsed.canonical.action).toBeUndefined();
    expect(parsed.canonical.url).toBeUndefined();
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

  it("does NOT coerce a string type into an array (malformed stays non-conformant)", async () => {
    const parsed = await parseMicropub(
      jsonRequest({ properties: { content: ["x"] }, type: "h-entry" })
    );

    expect(parsed.canonical.type).toEqual([]);
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
  });

  it("falls back to an empty canonical when properties is missing", async () => {
    const parsed = await parseMicropub(jsonRequest({ type: ["h-entry"] }));

    expect(parsed.canonical.properties).toEqual({});
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

  it("defers file parts to media handling — they never enter properties", async () => {
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
