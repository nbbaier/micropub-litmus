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
