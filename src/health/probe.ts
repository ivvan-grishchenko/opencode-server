import http from 'node:http';

const PROBE_TIMEOUT_MS = 2_000;
const TRANSIENT_NETWORK_ERRORS = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'EPIPE',
  'ETIMEDOUT',
]);

/**
 * Thrown by {@link probeOnce}. `transient` failures are retried by the
 * health-checker; fatal ones abort the wait (e.g. a 404 means the probe path
 * does not exist on this opencode version — surfacing the bug immediately).
 */
export class ProbeError extends Error {
  constructor(
    message: string,
    readonly transient: boolean,
  ) {
    super(message);
    this.name = 'ProbeError';
  }
}

/**
 * Single HTTP GET against the opencode liveness endpoint.
 * Resolves on 200; throws {@link ProbeError} otherwise.
 */
export function probeOnce(port: number, probePath: string): Promise<void> {
  const url = `http://127.0.0.1:${port}${probePath}`;
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const req = http.get(url, (res) => {
      if (res.statusCode === 200) {
        res.resume();
        resolve();
        return;
      }
      res.resume();
      if (res.statusCode === 404) {
        reject(
          new ProbeError(
            `Backend on port ${port} returned HTTP 404 for ${probePath}. The probe path may not exist in this opencode version.`,
            false,
          ),
        );
        return;
      }
      reject(
        new ProbeError(
          `Backend on port ${port} returned HTTP ${res.statusCode}, retrying...`,
          true,
        ),
      );
    });
    req.on('error', (err: NodeJS.ErrnoException) => {
      const transient = timedOut || (!!err.code && TRANSIENT_NETWORK_ERRORS.has(err.code));
      reject(new ProbeError(err.message, transient));
    });
    req.setTimeout(PROBE_TIMEOUT_MS, () => {
      timedOut = true;
      req.destroy(new Error('probe-timeout'));
    });
  });
}
