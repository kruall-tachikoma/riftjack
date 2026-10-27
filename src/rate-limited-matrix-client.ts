import { MatrixClient } from '@vector-im/matrix-bot-sdk';
import { setTimeout as delay } from 'node:timers/promises';

// Retry at the HTTP boundary: retrying sendMessage/sendRawEvent would allocate
// a new transaction ID (and may encrypt again). Never retry ambiguous failures.
export class RateLimitedMatrixClient extends MatrixClient {
  private readonly retryController = new AbortController();
  private sends: Promise<unknown> = Promise.resolve();

  override doRequest(...args: Parameters<MatrixClient['doRequest']>): ReturnType<MatrixClient['doRequest']> {
    const [method, endpoint] = args;
    // /sync already has SDK backoff. Typing is ephemeral: a delayed update can
    // resurrect the indicator after a turn ends; its owner handles renewal.
    if (/\/(sync|typing\/[^/]+)$/.test(endpoint)) return this.requestOnce(...args);
    const run = () => this.retryRequest(args);
    if (method === 'PUT' && /\/rooms\/[^/]+\/(send|redact)\//.test(endpoint)) {
      // Hold the event lane through a cooldown so later messages/reactions do
      // not consume the same account's quota while the first request retries.
      // Reads stay independent, including authorization of manual approvals.
      const result = this.sends.then(run);
      this.sends = result.catch(() => {});
      return result;
    }
    return run();
  }

  protected requestOnce(...args: Parameters<MatrixClient['doRequest']>): ReturnType<MatrixClient['doRequest']> {
    return super.doRequest(...args);
  }

  protected waitForRetry(ms: number): Promise<void> {
    return delay(ms, undefined, { signal: this.retryController.signal });
  }

  private async retryRequest(args: Parameters<MatrixClient['doRequest']>): Promise<any> {
    let waited = 0;
    for (let attempt = 0; ; attempt++) {
      this.retryController.signal.throwIfAborted();
      try { return await this.requestOnce(...args); }
      catch (error) {
        const ms = matrixRetryDelay(error, attempt);
        // A broken server must not retain confirmations indefinitely. Do not
        // shorten a server-requested delay to fit the budget; fail explicitly.
        if (ms === undefined || attempt >= 5 || waited + ms > 60_000) throw error;
        waited += ms;
        await this.waitForRetry(ms);
      }
    }
  }

  override stop(): void {
    this.retryController.abort();
    super.stop();
  }
}

export function matrixRetryDelay(error: unknown, attempt: number): number | undefined {
  if (!error || typeof error !== 'object') return;
  const e = error as { statusCode?: unknown; status?: unknown; retryAfterMs?: unknown;
    body?: { retry_after_ms?: unknown }; headers?: Record<string, unknown> };
  if (e.statusCode !== 429 && e.status !== 429) return;
  // SDK MatrixError exposes retryAfterMs (Retry-After takes precedence over
  // retry_after_ms). Plain HTTP errors expose headers instead.
  const header = e.headers?.['retry-after'];
  const fromHeader = typeof header === 'string'
    ? (/^\d+(\.\d+)?$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now()) : undefined;
  const ms = [e.retryAfterMs, fromHeader, e.body?.retry_after_ms]
    .find(value => typeof value === 'number' && Number.isFinite(value) && value >= 0);
  return Math.max(250, typeof ms === 'number' ? ms : 1000 * 2 ** attempt);
}
