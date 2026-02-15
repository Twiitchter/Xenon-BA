import { EventEmitter } from 'events';
import axios, { AxiosInstance } from 'axios';
import { AsseticRateLimiter, RateLimitStatus } from './asseticRateLimiter';
import settingsService from './settingsService';

/**
 * Multi-agent worker pool for the Assetic REST API.
 *
 * Each "worker" represents a separate Assetic API agent account,
 * each with its own 250-request-per-minute rate limit.  Incoming
 * API calls are dispatched to the worker with the most remaining
 * capacity (least-loaded), with round-robin tie-breaking.
 *
 * Total throughput = workerCount × 250 req/min.
 *
 * Workers are configured via system_settings:
 *   - assetic_worker_count       → number of workers (min 1, default 1)
 *   - assetic_worker_N_username  → per-worker username  (falls back to assetic_api_username)
 *   - assetic_worker_N_api_key   → per-worker API key   (falls back to assetic_api_key)
 *
 * When only 1 worker is configured, it behaves identically to the
 * legacy single-limiter setup.
 */

// ─── Types ──────────────────────────────────────────────────────────

export interface WorkerStatus extends RateLimitStatus {
  workerId: number;
  label: string;
  isConfigured: boolean;
}

export interface PoolRateLimitStatus {
  /** Number of configured workers */
  totalWorkers: number;
  /** Aggregate calls across all workers in the current window */
  totalCallsInWindow: number;
  /** Aggregate max capacity across all workers */
  totalMaxPerWindow: number;
  /** Aggregate remaining capacity */
  totalRemaining: number;
  /** Aggregate queue depth */
  totalQueueLength: number;
  /** True only when ALL workers are throttled */
  isThrottled: boolean;
  /** Per-worker breakdown */
  workers: WorkerStatus[];

  // ── Legacy compat fields (client currently reads these) ──
  callsInWindow: number;
  maxCallsPerWindow: number;
  remaining: number;
  queueLength: number;
  msUntilNextSlot: number;
}

// ─── Worker ─────────────────────────────────────────────────────────

class ApiWorker {
  readonly id: number;
  readonly label: string;
  readonly rateLimiter: AsseticRateLimiter;

  private _siteUrl: string = '';
  private _username: string = '';
  private _apiKey: string = '';
  private _apiVersion: string = 'v2';

  constructor(id: number) {
    this.id = id;
    this.label = `Agent ${id}`;
    this.rateLimiter = new AsseticRateLimiter({
      maxPerMinute: 250,
      label: this.label,
    });
  }

  configure(siteUrl: string, username: string, apiKey: string, apiVersion: string): void {
    this._siteUrl = siteUrl;
    this._username = username;
    this._apiKey = apiKey;
    this._apiVersion = apiVersion;
  }

  get isConfigured(): boolean {
    return !!(this._siteUrl && this._username && this._apiKey);
  }

  /** Build a fresh Axios client with this worker's credentials. */
  buildClient(): AxiosInstance {
    const basicAuth = Buffer.from(`${this._username}:${this._apiKey}`).toString('base64');
    const client = axios.create({
      baseURL: `${this._siteUrl.replace(/\/+$/, '')}/api/${this._apiVersion}`,
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    client.interceptors.response.use(
      (response) => response,
      (error) => {
        console.error(
          `[${this.label}] Assetic API Error:`,
          error.response?.status,
          error.response?.data || error.message,
        );
        throw error;
      },
    );

    return client;
  }

  getStatus(): WorkerStatus {
    const base = this.rateLimiter.getStatus();
    return {
      ...base,
      workerId: this.id,
      label: this.label,
      isConfigured: this.isConfigured,
    };
  }
}

// ─── Pool ───────────────────────────────────────────────────────────

class AsseticWorkerPool extends EventEmitter {
  private workers: ApiWorker[] = [];
  private initialized = false;
  private roundRobinIndex = 0;

  /**
   * Load / reload worker configuration from system_settings.
   * Called on first API call and can be called again when admin
   * updates the worker settings.
   */
  async initialize(): Promise<void> {
    const siteUrl = await settingsService.get('assetic_api_url');
    const apiVersion = await settingsService.get('assetic_api_version', 'v2');
    const defaultUsername = await settingsService.get('assetic_api_username');
    const defaultApiKey = await settingsService.get('assetic_api_key');
    const workerCountStr = await settingsService.get('assetic_worker_count', '1');
    const workerCount = Math.max(1, parseInt(workerCountStr, 10) || 1);

    // Preserve existing workers if count unchanged (keeps their rate-limiter state)
    if (this.workers.length !== workerCount) {
      this.workers = [];
      for (let i = 0; i < workerCount; i++) {
        this.workers.push(new ApiWorker(i + 1));
      }
    }

    for (let i = 0; i < workerCount; i++) {
      const n = i + 1;
      // Per-worker credentials fall back to the default Assetic creds
      const username = await settingsService.get(`assetic_worker_${n}_username`, defaultUsername);
      const apiKey = await settingsService.get(`assetic_worker_${n}_api_key`, defaultApiKey);
      this.workers[i].configure(siteUrl, username, apiKey, apiVersion);
    }

    this.initialized = true;
    const configured = this.workers.filter((w) => w.isConfigured).length;
    console.log(
      `[AsseticWorkerPool] Initialized ${this.workers.length} worker(s) ` +
      `(${configured} configured) — total capacity: ${configured * 250}/min`,
    );
  }

  /**
   * Re-read settings and reconfigure workers (call after admin saves settings).
   */
  async refresh(): Promise<void> {
    this.initialized = false;
    await this.initialize();
  }

  /**
   * Execute an API call through the least-loaded worker.
   * The worker's Axios client is passed into `fn`.
   */
  async execute<T>(
    fn: (client: AxiosInstance) => Promise<T>,
    description?: string,
  ): Promise<T> {
    if (!this.initialized) {
      await this.initialize();
    }

    const worker = this.selectWorker();

    // Wrap fn so the rate limiter's execute() signature stays () => Promise<T>
    return worker.rateLimiter.execute(
      () => fn(worker.buildClient()),
      description,
    );
  }

  /**
   * Return aggregate + per-worker status.
   * Backward compatible: includes flat fields the client already reads.
   */
  getStatus(): PoolRateLimitStatus {
    const workerStatuses = this.workers.map((w) => w.getStatus());
    const totalCallsInWindow = workerStatuses.reduce((s, w) => s + w.callsInWindow, 0);
    const totalMax = workerStatuses.reduce((s, w) => s + w.maxCallsPerWindow, 0);
    const totalRemaining = workerStatuses.reduce((s, w) => s + w.remaining, 0);
    const totalQueue = workerStatuses.reduce((s, w) => s + w.queueLength, 0);
    const allThrottled = workerStatuses.length > 0 && workerStatuses.every((w) => w.isThrottled);
    const minMs = allThrottled
      ? Math.min(...workerStatuses.map((w) => w.msUntilNextSlot))
      : 0;

    return {
      totalWorkers: this.workers.length,
      totalCallsInWindow,
      totalMaxPerWindow: totalMax,
      totalRemaining,
      totalQueueLength: totalQueue,
      isThrottled: allThrottled,
      workers: workerStatuses,

      // Legacy flat fields
      callsInWindow: totalCallsInWindow,
      maxCallsPerWindow: totalMax,
      remaining: totalRemaining,
      queueLength: totalQueue,
      msUntilNextSlot: minMs,
    };
  }

  // ─── Internal ─────────────────────────────────────────────────────

  /**
   * Pick the configured worker with the most remaining capacity.
   * Ties are broken by round-robin to spread load evenly.
   */
  private selectWorker(): ApiWorker {
    const configured = this.workers.filter((w) => w.isConfigured);
    if (configured.length === 0) {
      throw new Error(
        'No Assetic API workers are configured. Set credentials in Admin > Settings.',
      );
    }
    if (configured.length === 1) return configured[0];

    // Find the max remaining capacity
    let maxRemaining = -1;
    for (const w of configured) {
      const rem = w.rateLimiter.getStatus().remaining;
      if (rem > maxRemaining) maxRemaining = rem;
    }

    // Collect workers tied at max
    const best = configured.filter(
      (w) => w.rateLimiter.getStatus().remaining === maxRemaining,
    );

    // Round-robin among tied workers
    const idx = this.roundRobinIndex % best.length;
    this.roundRobinIndex = (this.roundRobinIndex + 1) % Number.MAX_SAFE_INTEGER;
    return best[idx];
  }
}

/** Singleton pool instance */
export const asseticWorkerPool = new AsseticWorkerPool();
export default asseticWorkerPool;
