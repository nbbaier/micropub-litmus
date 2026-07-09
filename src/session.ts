import { DurableObject } from "cloudflare:workers";
import type { Env, SessionMeta } from "./types";

/**
 * TestSession — one Durable Object instance per session token, addressed by
 * `env.TEST_SESSION.idFromName('client-' + token)`.
 *
 * The thesis (spec §1): this single DO replaces the original's external SSE
 * streaming daemon AND its Redis TTL cache. It is, per token, simultaneously
 * the Micropub server, the ephemeral post store, and the SSE fan-out hub.
 *
 * This is build slice 1 (spec §12.1): an intentionally EMPTY stub. It knows
 * only how to be created (`/init`) and to prove reachability (`/ping`). The
 * Micropub surface (`/mp`, `/media`), session control (`/active-test`, `/sub`),
 * and auth shims land in later slices (#3–#9). Keep this handler generic —
 * do not bake in `client-`-specific assumptions (the server-test half reuses
 * this core on the `endpoint-<id>` channel, Appendix B).
 */
export class TestSession extends DurableObject<Env> {
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
          const meta: SessionMeta = { token, createdAt: Date.now() };
          await this.ctx.storage.put("meta", meta);
          return Response.json({ created: true, meta });
        }
        return Response.json({ created: false, meta: existing });
      }

      // Reachability probe: proves a session route forwarded from the Worker
      // lands on the correct DO instance and can read its own state.
      case "/ping": {
        const meta = await this.ctx.storage.get<SessionMeta>("meta");
        return Response.json({ ok: true, meta: meta ?? null });
      }

      default:
        return new Response("Not found", { status: 404 });
    }
  }
}
