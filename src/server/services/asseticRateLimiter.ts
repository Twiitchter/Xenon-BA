import { EventEmitter } from 'events';

/**
 * Rate-limited queue for Assetic API calls.
 *
 * Hard cap: 250 requests per rolling 60-second window.
 * When the limit is reached, new calls are queued and executed
 * in FIFO order as capacity becomes available.
 */

interface QueuedRequest<T = any> {
  id: string;
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: any) => void;
  enqueuedAt: number;
  description?: string;
}

export interface RateLimitStatus {
  /** Calls made in the current 60-second window */
  callsInWindow: number;
  /** Maximum calls allowed per window */
  maxCallsPerWindow: number;
  /** Remaining calls before throttling */
  remaining: number;
  /** Number of requests currently queued */
  queueLength: number;
  /** Whether the queue is currently throttled */
  isThrottled: boolean;
  /** Milliseconds until oldest tracked call expires from the window */
  msUntilNextSlot: number;
}

class AsseticRateLimiter extends EventEmitter {
  private readonly MAX_PER_MINUTE = 250;
  private readonly WINDOW_MS = 60_000; // 60 seconds
  private readonly DRAIN_INTERVAL_MS = 200; // check queue every 200ms

  /** Timestamps of calls made within the current window */
  private callTimestamps: number[] = [];

  /** FIFO queue of pending requests */
  private queue: QueuedRequest[] = [];

  /** Whether the drain loop is running */
  private draining = false;

  /** Counter for generating request IDs */
  private requestCounter = 0;

  /**
   * Execute an API call through the rate limiter.
   * If under the limit, it runs immediately.
   * If at the limit, it's queued and resolved when a slot opens.
   */
  async execute<T>(fn: () => Promise<T>, description?: string): Promise<T> {
    this.pruneWindow();

    // If under limit, execute immediately
    if (this.callTimestamps.length < this.MAX_PER_MINUTE) {
      this.recordCall();
      return fn();
    }

    // At the limit — queue the request
    return new Promise<T>((resolve, reject) => {
      const id = `assetic-${++this.requestCounter}`;
      this.queue.push({ id, execute: fn, resolve, reject, enqueuedAt: Date.now(), description });

      console.log(
        `[AsseticRateLimiter] Rate limit reached (${this.MAX_PER_MINUTE}/min). ` +
        `Queued request #${id} (queue depth: ${this.queue.length})`
      );

      this.emit('queued', this.getStatus());
      this.startDraining();
    });
  }

  /**
   * Get the current rate-limit and queue status.
   */
  getStatus(): RateLimitStatus {
    this.pruneWindow();

    const callsInWindow = this.callTimestamps.length;
    const remaining = Math.max(0, this.MAX_PER_MINUTE - callsInWindow);
    const isThrottled = remaining === 0;

    let msUntilNextSlot = 0;
    if (isThrottled && this.callTimestamps.length > 0) {
      const oldest = this.callTimestamps[0];
      msUntilNextSlot = Math.max(0, (oldest + this.WINDOW_MS) - Date.now());
    }

    return {
      callsInWindow,
      maxCallsPerWindow: this.MAX_PER_MINUTE,
      remaining,
      queueLength: this.queue.length,
      isThrottled,
      msUntilNextSlot,
    };
  }

  // ─── Internal ───────────────────────────────────────────────────────

  /** Remove timestamps older than the window */
  private pruneWindow(): void {
    const cutoff = Date.now() - this.WINDOW_MS;
    while (this.callTimestamps.length > 0 && this.callTimestamps[0] < cutoff) {
      this.callTimestamps.shift();
    }
  }

  /** Record a call in the current window */
  private recordCall(): void {
    this.callTimestamps.push(Date.now());
  }

  /** Start the drain loop if not already running */
  private startDraining(): void {
    if (this.draining) return;
    this.draining = true;
    this.drainLoop();
  }

  /** Periodically process queued requests as capacity frees up */
  private async drainLoop(): Promise<void> {
    while (this.queue.length > 0) {
      this.pruneWindow();

      if (this.callTimestamps.length < this.MAX_PER_MINUTE) {
        const item = this.queue.shift()!;
        this.recordCall();

        const waitTime = Date.now() - item.enqueuedAt;
        console.log(
          `[AsseticRateLimiter] Dequeuing #${item.id} after ${waitTime}ms wait ` +
          `(remaining queue: ${this.queue.length})`
        );

        // Execute without blocking the drain loop
        item.execute().then(item.resolve).catch(item.reject);

        this.emit('dequeued', this.getStatus());

        if (this.queue.length === 0) {
          this.emit('drained', this.getStatus());
        }
      } else {
        // Wait before checking again
        await this.sleep(this.DRAIN_INTERVAL_MS);
      }
    }

    this.draining = false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/** Singleton rate limiter instance */
export const asseticRateLimiter = new AsseticRateLimiter();
export default asseticRateLimiter;
