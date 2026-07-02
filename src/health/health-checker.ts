import type { Logger } from 'pino';

import { ProbeError, probeOnce } from './probe.js';

const READY_TIMEOUT_MS = 60_000;
const INITIAL_DELAY_MS = 200;
const MAX_DELAY_MS = 1_000;

function jitteredDelay(base: number): number {
  const delta = base * 0.2;
  return base - delta + Math.random() * 2 * delta;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Poll a backend's liveness endpoint with jittered exponential backoff until it
 * reports 200 or the time budget is exhausted. Fatal probe errors (e.g. 404)
 * surface immediately; transient network errors are swallowed and retried.
 */
export async function waitForBackend(port: number, probePath: string, log: Logger): Promise<void> {
  const start = Date.now();
  let delay = INITIAL_DELAY_MS;

  while (Date.now() - start < READY_TIMEOUT_MS) {
    try {
      await probeOnce(port, probePath);
      log.info({ port }, `Backend on port ${port} is healthy`);
      return;
    } catch (err) {
      if (err instanceof ProbeError) {
        if (!err.transient) throw err;
      } else {
        throw err;
      }
    }
    await sleep(jitteredDelay(delay));
    delay = Math.min(delay * 2, MAX_DELAY_MS);
  }

  throw new Error(`Backend on port ${port} did not become healthy within ${READY_TIMEOUT_MS}ms`);
}
