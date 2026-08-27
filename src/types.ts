import type { TestSession } from "./session";

/** Worker + DO bindings (see wrangler.jsonc). */
export interface Env {
  TEST_SESSION: DurableObjectNamespace<TestSession>;
}

/** DO storage: meta value (spec §4 storage schema). */
export interface SessionMeta {
  createdAt: number;
  token: string;
}

/**
 * SSE event contract (spec §9) — preserved verbatim from the original so the
 * ported views stay a straight translation. `client-result` carries a rendered
 * result fragment plus the request dump for the collapsible debug pane; the
 * `login` shape lands with the auth slice, if auth events are surfaced at all.
 */
export interface SessionEvent {
  action: "client-result";
  debug: string;
  html: string;
}
