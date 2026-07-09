import { Hono } from "hono";
import { html } from "hono/html";
import type { Env } from "./types";

// Re-export the DO class so the runtime can find it from `main` (wrangler.jsonc
// binds class_name "TestSession").

// biome-ignore lint/performance/noBarrelFile: needed for cloudflare
export { TestSession } from "./session";

const app = new Hono<{ Bindings: Env }>();

/**
 * Token resolution is the ONLY routing logic in the Worker (spec §3, §5). The
 * Worker never validates Micropub payloads or holds session state — it maps a
 * token to its DO stub and forwards. Everything stateful is one stub.fetch away.
 */
function sessionStub(env: Env, token: string) {
  const id = env.TEST_SESSION.idFromName(`client-${token}`);
  return env.TEST_SESSION.get(id);
}

/** URL-safe session token. Format is unspecified in v1; keep it opaque. */
function mintToken(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

// GET / — landing / start a session (spec §5). Mint a token, materialize its
// DO, and render the session page with the endpoint URLs.
app.get("/", async (c) => {
  const token = mintToken();
  const stub = sessionStub(c.env, token);

  // Materialize the DO for this token (DOs are lazy until first fetch).
  await stub.fetch(`https://do/init?token=${encodeURIComponent(token)}`);

  const { origin } = new URL(c.req.url);
  const endpoint = `${origin}/micropub/${token}`;
  const sessionUrl = `${origin}/client/${token}`;

  return c.html(
    html`<!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>micropub-litmus — session started</title>
        </head>
        <body>
          <h1>micropub-litmus</h1>
          <p>A new test session has been created.</p>
          <dl>
            <dt>Micropub endpoint</dt>
            <dd><code>${endpoint}</code></dd>
            <dt>Token</dt>
            <dd><code>${token}</code></dd>
            <dt>Session page</dt>
            <dd><a href="${sessionUrl}">${sessionUrl}</a></dd>
          </dl>
          <p>
            The live test panel and auth-discovery <code>rel</code> links land in
            later build slices.
          </p>
        </body>
      </html>`
  );
});

// GET /client/:token — session page. Slice 1 only proves the route reaches the
// correct DO; the test list + live SSE panel (spec §10) come later.
app.get("/client/:token", async (c) => {
  const token = c.req.param("token");
  const stub = sessionStub(c.env, token);
  const res = await stub.fetch("https://do/ping");
  const state = (await res.json()) as { ok: boolean; meta: unknown };

  if (!state.meta) {
    return c.text("Unknown or expired session.", 404);
  }

  return c.html(
    html`<!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <title>micropub-litmus — session ${token}</title>
        </head>
        <body>
          <h1>Session ${token}</h1>
          <p>Session is live. Test list &amp; live panel arrive in later slices.</p>
        </body>
      </html>`
  );
});

export default app;
