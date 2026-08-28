import { describe, expect, it } from "vitest";
import { formatSseComment, formatSseFrame, SSE_HEADERS } from "./sse";

describe("formatSseFrame", () => {
  it("emits id, event, retry and data in wire order", () => {
    expect(
      formatSseFrame({ data: "hello", event: "message", id: 7, retry: 2000 })
    ).toBe("id: 7\nevent: message\nretry: 2000\ndata: hello\n\n");
  });

  it("omits the event name so the browser gets the default `message` type", () => {
    expect(formatSseFrame({ data: '{"action":"client-result"}', id: 1 })).toBe(
      'id: 1\ndata: {"action":"client-result"}\n\n'
    );
  });

  it("splits a multi-line payload across data lines", () => {
    expect(formatSseFrame({ data: "one\ntwo\nthree" })).toBe(
      "data: one\ndata: two\ndata: three\n\n"
    );
  });

  it("keeps an empty payload as one empty data line", () => {
    expect(formatSseFrame({ data: "", id: 3 })).toBe("id: 3\ndata: \n\n");
  });

  it("supports a retry-only frame (no data)", () => {
    expect(formatSseFrame({ retry: 2000 })).toBe("retry: 2000\n\n");
  });

  it("returns nothing for a frame with no fields", () => {
    expect(formatSseFrame({})).toBe("");
  });

  it("terminates every frame with a blank line", () => {
    const stream = [
      formatSseFrame({ data: "a", id: 1 }),
      formatSseFrame({ data: "b", id: 2 }),
    ].join("");

    expect(stream).toBe("id: 1\ndata: a\n\nid: 2\ndata: b\n\n");
  });
});

describe("formatSseComment", () => {
  it("emits an ignorable comment frame", () => {
    expect(formatSseComment("keep-alive")).toBe(": keep-alive\n\n");
  });
});

describe("SSE_HEADERS", () => {
  it("declares an unbuffered event stream", () => {
    expect(SSE_HEADERS["content-type"]).toBe(
      "text/event-stream; charset=utf-8"
    );
    expect(SSE_HEADERS["cache-control"]).toContain("no-cache");
    expect(SSE_HEADERS["cache-control"]).toContain("no-transform");
    expect(SSE_HEADERS["x-accel-buffering"]).toBe("no");
  });
});
