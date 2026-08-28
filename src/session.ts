import { DurableObject } from "cloudflare:workers";
import { formatSseComment, formatSseFrame, SSE_HEADERS } from "./sse";
import type { Env, SessionEvent, SessionMeta } from "./types";

/** Comment frames keep an idle stream from being reaped by intermediaries. */
const HEARTBEAT_INTERVAL_MS = 15_000;
/** Reconnect backoff advertised to `EventSource` when a stream drops. */
const RECONNECT_BACKOFF_MS = 2000;
/** Cadence of the slice-2 scaffold publisher (removed when real results land). */
const DEMO_PUBLISH_INTERVAL_MS = 3000;
/**
 * How long a single frame may sit unwritten before its stream is presumed
 * dead. A connected browser drains a few hundred bytes instantly; a stream
 * whose reader is gone stalls forever once the queue fills. See `push()`.
 */
const WRITE_TIMEOUT_MS = 10_000;

/**
 * Stream failures are already handled where they matter: `push()` drops the
 * writer that broke. Anything reaching here is the tail of that same
 * disconnect, so there is nothing left to do with it.
 */
const ignoreStreamError = () => undefined;

/** Reject `promise` if it has not settled within `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("SSE write timed out")),
      ms
    );
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/**
 * TestSession — one Durable Object instance per session channel, addressed by
 * `env.TEST_SESSION.idFromName('client-' + token)`.
 *
 * The thesis (spec §1): this single DO replaces the original's external SSE
 * streaming daemon AND its Redis TTL cache. It is, per token, simultaneously
 * the Micropub server, the ephemeral post store, and the SSE fan-out hub.
 *
 * This is build slice 2 (spec §12.2): the fan-out hub half. `/sub` returns a
 * live `text/event-stream`, writers are retained on the instance across
 * requests, and a hardcoded publisher on a timer proves the browser panel
 * updates. The Micropub surface (`/mp`, `/media`), session control
 * (`/active-test`), auth shims, and Last-Event-ID replay land in later slices
 * (#4–#9). Keep this handler generic — do not bake in `client-`-specific
 * assumptions (the server-test half reuses this core on the `endpoint-<id>`
 * channel, Appendix B).
 */
export class TestSession extends DurableObject<Env> {
  /**
   * Open SSE writers, retained on the instance ACROSS requests. This Set *is*
   * the message bus that the original ran as a separate streaming daemon.
   *
   * Deliberate v1 tradeoff, not an oversight: an open SSE stream keeps this DO
   * awake for as long as a tab is connected — there is no WebSocket-Hibernation
   * equivalent for SSE, so "browser connected" means "DO resident in memory".
   * That is fine at this tool's volume (one session per tester, minutes at a
   * time, a handful of tabs). If it ever stops being fine, swap the transport
   * for WebSockets + hibernation: `subscribe()` and `broadcast()` below are the
   * only two methods that have to change.
   */
  private readonly writers = new Set<WritableStreamDefaultWriter<Uint8Array>>();
  private readonly encoder = new TextEncoder();

  /** Monotonic SSE event id — the anchor for Last-Event-ID replay in slice #9. */
  private nextEventId = 1;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private demoTimer: ReturnType<typeof setInterval> | null = null;
  private demoTick = 0;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    switch (url.pathname) {
      // Called once by the Worker on GET / to materialize the DO for a fresh
      // token. DOs are lazy — a stub without a fetch never instantiates — so
      // this first write is what actually "creates" the session.
      case "/init": {
        const existing = await this.ctx.storage.get<SessionMeta>("meta");
        if (!existing) {
          const token = url.searchParams.get("token") ?? "";
          const meta: SessionMeta = { createdAt: Date.now(), token };
          await this.ctx.storage.put("meta", meta);
          return Response.json({ created: true, meta });
        }
        return Response.json({ created: false, meta: existing });
      }

      // Reachability probe: proves a session route forwarded from the Worker
      // lands on the correct DO instance and can read its own state.
      case "/ping": {
        const meta = await this.ctx.storage.get<SessionMeta>("meta");
        return Response.json({ meta: meta ?? null, ok: true });
      }

      // SSE subscribe (spec §4). The Worker streams this Response straight
      // back to the browser's EventSource.
      case "/sub": {
        const meta = await this.ctx.storage.get<SessionMeta>("meta");
        if (!meta) {
          return new Response("Unknown or expired session.", { status: 404 });
        }
        return this.subscribe(request);
      }

      default:
        return new Response("Not found", { status: 404 });
    }
  }

  /**
   * Open one SSE stream. The readable half goes back to the browser; the
   * writable half is retained here so `publish()` can reach it later.
   */
  private subscribe(request: Request): Response {
    const { readable, writable } = new TransformStream<
      Uint8Array,
      Uint8Array
    >();
    const writer = writable.getWriter();

    this.writers.add(writer);
    this.startTimers();

    // Best-effort disconnect signals. Neither fired in local workerd testing
    // when a subscriber went away, so they are a bonus, not the mechanism —
    // the write timeout in `push()` is what actually reaps dead writers. Kept
    // because when they do fire the reap is immediate instead of ~10s later.
    request.signal.addEventListener("abort", () => this.drop(writer), {
      once: true,
    });
    writer.closed.catch(() => this.drop(writer));

    // Open the stream with bytes immediately: EventSource fires `open` on the
    // first frame, and a comment tells any buffering proxy the stream is live.
    // Replaying prior results here (spec §4 `replayState`, Last-Event-ID) needs
    // the stored `result:<num>` entries that slice #9 introduces.
    // NOT awaited, deliberately: a TransformStream write only settles once
    // something reads the readable half, and nothing reads it until this
    // Response is returned. Awaiting here deadlocks the subscribe.
    this.push(
      writer,
      formatSseFrame({ retry: RECONNECT_BACKOFF_MS }) +
        formatSseComment("connected")
    ).catch(ignoreStreamError);

    return new Response(readable, { headers: SSE_HEADERS });
  }

  /**
   * Fan an event out to every open stream (spec §9 contract). Each event gets
   * a monotonic id so a reconnecting browser can say where it left off; acting
   * on `Last-Event-ID` is the replay slice (#9).
   */
  private async publish(event: SessionEvent): Promise<void> {
    const id = this.nextEventId;
    this.nextEventId += 1;

    await this.broadcast(formatSseFrame({ data: JSON.stringify(event), id }));
  }

  private async broadcast(payload: string): Promise<void> {
    await Promise.all(
      [...this.writers].map((writer) => this.push(writer, payload))
    );
  }

  /**
   * Write one payload to one stream, dropping the stream if it fails or
   * stalls.
   *
   * The timeout is the load-bearing part. A departed subscriber does NOT error
   * its writer — `request.signal` and `writer.closed` both stay quiet when a
   * browser closes its tab (verified against workerd, see
   * implementation-notes) — it simply stops reading, so writes queue and then
   * hang. An unbounded stall would leave dead writers in the Set and the
   * timers below running, keeping this DO resident forever.
   */
  private async push(
    writer: WritableStreamDefaultWriter<Uint8Array>,
    payload: string
  ): Promise<void> {
    try {
      await withTimeout(
        writer.write(this.encoder.encode(payload)),
        WRITE_TIMEOUT_MS
      );
    } catch {
      this.drop(writer);
    }
  }

  private drop(writer: WritableStreamDefaultWriter<Uint8Array>): void {
    if (!this.writers.delete(writer)) {
      return;
    }
    // `abort`, not `close`: a stalled stream never drains, so close() would
    // hang waiting on the same queue that got the writer dropped.
    writer.abort().catch(ignoreStreamError);
    if (this.writers.size === 0) {
      this.stopTimers();
    }
  }

  /** Timers run only while someone is listening — no subscribers, no work. */
  private startTimers(): void {
    this.heartbeatTimer ??= setInterval(() => {
      this.broadcast(formatSseComment("keep-alive")).catch(ignoreStreamError);
    }, HEARTBEAT_INTERVAL_MS);

    // Slice-2 scaffold: hardcoded publisher proving the browser panel updates
    // end to end. Slice #5 replaces it with real `client-result` events built
    // from inbound Micropub requests; delete this timer then.
    this.demoTimer ??= setInterval(() => {
      this.publishDemoResult().catch(ignoreStreamError);
    }, DEMO_PUBLISH_INTERVAL_MS);
  }

  private stopTimers(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.demoTimer !== null) {
      clearInterval(this.demoTimer);
      this.demoTimer = null;
    }
  }

  /** See `startTimers()` — scaffold, replaced by the real create path. */
  private publishDemoResult(): Promise<void> {
    this.demoTick += 1;
    const receivedAt = new Date().toISOString();

    return this.publish({
      action: "client-result",
      debug: `scaffold tick ${this.demoTick}\nat ${receivedAt}\nsubscribers ${this.writers.size}`,
      html: `<p><strong>Timer tick ${this.demoTick}</strong> — SSE fan-out from the Durable Object is live.</p><p>No Micropub request has been validated yet; posting to the endpoint starts working in a later build slice.</p>`,
    });
  }
}
