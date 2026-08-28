import { Hono } from "hono";
import { html } from "hono/html";
import type { Env } from "./types";

// Re-export the DO class so the runtime can find it from `main` (wrangler.jsonc
// binds class_name "TestSession").

// biome-ignore lint/performance/noBarrelFile: needed for cloudflare
export { TestSession } from "./session";

/**
 * Channels are `client-<token>` (client tests) and, later, `endpoint-<id>`
 * (server-test reports, Appendix B). The channel name IS the DO name, so the
 * streaming route stays generic instead of client-test-specific.
 */
const CHANNEL_ID = /^(?:client|endpoint)-[A-Za-z0-9]{1,128}$/;

const app = new Hono<{ Bindings: Env }>();

/**
 * Token resolution is the ONLY routing logic in the Worker (spec §3, §5). The
 * Worker never validates Micropub payloads or holds session state — it maps a
 * token to its DO stub and forwards. Everything stateful is one stub.fetch away.
 */
function channelStub(env: Env, channel: string) {
  const id = env.TEST_SESSION.idFromName(channel);
  return env.TEST_SESSION.get(id);
}

function sessionStub(env: Env, token: string) {
  return channelStub(env, `client-${token}`);
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
            Open the session page to watch the live panel; the test list and
            auth-discovery <code>rel</code> links land in later build slices.
          </p>
        </body>
      </html>`
  );
});

// GET /client/:token — session page (spec §10). Slice 2 wires the live panel:
// the browser opens an EventSource and injects each `client-result` fragment.
// The numbered test list arrives with the registry slices.
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
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>micropub-litmus — session ${token}</title>
        </head>
        <body data-channel="client-${token}">
          <h1>Session ${token}</h1>
          <section>
            <h2>Live results</h2>
            <p id="stream-status" role="status">Connecting…</p>
            <div id="result">
              <p>Waiting for the first event from the session…</p>
            </div>
            <details>
              <summary>Debug</summary>
              <pre id="debug"></pre>
            </details>
          </section>
          <p>Test list &amp; the Micropub create path arrive in later slices.</p>
          <script>
            (function () {
              var status = document.getElementById("stream-status");
              var result = document.getElementById("result");
              var debug = document.getElementById("debug");
              var channel = document.body.dataset.channel;
              var source = new EventSource(
                "/streaming/sub?id=" + encodeURIComponent(channel)
              );

              source.onopen = function () {
                status.textContent = "Live on " + channel;
              };

              source.onerror = function () {
                status.textContent = "Disconnected — reconnecting…";
              };

              // Spec §9 event contract, ported verbatim from
              // views/client-tests/basic.php: inject the html, dump the debug.
              source.onmessage = function (event) {
                var payload = JSON.parse(event.data);
                if (payload.action !== "client-result") {
                  return;
                }
                result.innerHTML = payload.html;
                debug.textContent = payload.debug || "";
              };
            })();
          </script>
        </body>
      </html>`
  );
});

// GET /streaming/sub?id=client-:token — SSE (spec §5). Forward to the DO and
// stream its Response straight through; the Worker adds nothing to the stream.
// Headers (incl. Last-Event-ID) pass through for the replay slice.
app.get("/streaming/sub", async (c) => {
  const channel = c.req.query("id") ?? "";

  if (!CHANNEL_ID.test(channel)) {
    return c.text("Bad channel id.", 400);
  }

  return await channelStub(c.env, channel).fetch("https://do/sub", {
    headers: c.req.raw.headers,
  });
});

export default app;
