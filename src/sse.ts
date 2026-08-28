/**
 * `text/event-stream` wire format — the only place SSE framing lives.
 *
 * Pure string work on purpose: the fan-out hub in `TestSession` needs a
 * Workers runtime, but the framing it depends on is unit-testable in plain
 * node (see `sse.test.ts`).
 */

/**
 * Response headers for an SSE stream. `no-transform` and `x-accel-buffering`
 * exist to stop intermediaries from buffering the stream into uselessness —
 * harmless where nothing is buffering.
 */
export const SSE_HEADERS = {
  "cache-control": "no-cache, no-transform",
  "content-type": "text/event-stream; charset=utf-8",
  "x-accel-buffering": "no",
} as const;

/** One SSE frame. Every field is optional except that an empty frame is a no-op. */
export interface SseFrame {
  /** Payload. Newlines are split across multiple `data:` lines per the spec. */
  data?: string;
  /** Event name. Omitted ⇒ the default `message`, which `onmessage` receives. */
  event?: string;
  /** Monotonic event id; the browser echoes the last one as `Last-Event-ID`. */
  id?: number;
  /** Reconnect backoff hint, in ms. */
  retry?: number;
}

/** Serialize one frame, terminator included. */
export function formatSseFrame({ id, event, data, retry }: SseFrame): string {
  const lines: string[] = [];

  if (id !== undefined) {
    lines.push(`id: ${id}`);
  }
  if (event !== undefined) {
    lines.push(`event: ${event}`);
  }
  if (retry !== undefined) {
    lines.push(`retry: ${retry}`);
  }
  if (data !== undefined) {
    // A payload containing newlines MUST be split across `data:` lines; the
    // browser rejoins them with "\n" before handing them to `onmessage`.
    for (const line of data.split("\n")) {
      lines.push(`data: ${line}`);
    }
  }

  return lines.length > 0 ? `${lines.join("\n")}\n\n` : "";
}

/**
 * A comment frame (`: text`). Browsers ignore the content, so it is the
 * standard way to open a stream promptly and to keep an idle one alive.
 */
export function formatSseComment(text: string): string {
  return `: ${text}\n\n`;
}
