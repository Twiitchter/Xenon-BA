import { useEffect, useRef, useCallback } from 'react';
import { useToast } from '../contexts/ToastContext';
import { adminService } from '../services/adminService';

/**
 * Hook that polls the Assetic rate-limit status endpoint and displays
 * toast notifications when the queue is filling or throttled.
 *
 * Supports the multi-worker pool: shows aggregate capacity and
 * per-worker details when more than one worker is active.
 *
 * Only active for admin users (the endpoint requires admin access).
 * Polls every 5 seconds when idle, every 2 seconds when throttled.
 */
export function useAsseticRateLimitMonitor(isAdmin: boolean) {
  const { addToast } = useToast();
  const throttledToastRef = useRef<string | null>(null);
  const prevThrottled = useRef(false);
  const prevQueueLen = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = useCallback(async () => {
    if (!isAdmin) return;

    try {
      const status = await adminService.getAsseticRateLimitStatus();
      const workerCount = status.totalWorkers || 1;
      const workerLabel = workerCount > 1 ? ` across ${workerCount} workers` : '';

      // ── Throttled state ───────────────────────────────────────────
      if (status.isThrottled && !prevThrottled.current) {
        // Just became throttled (ALL workers at capacity)
        const waitSec = Math.ceil(status.msUntilNextSlot / 1000);
        const capLabel = `${status.maxCallsPerWindow} calls/min${workerLabel}`;
        throttledToastRef.current = addToast({
          type: 'warning',
          title: 'Assetic API rate limit reached',
          message: `${capLabel} cap hit. ${status.queueLength} request${status.queueLength !== 1 ? 's' : ''} queued. Next slot in ~${waitSec}s.`,
          duration: 0, // sticky until resolved
        });
      }

      if (!status.isThrottled && prevThrottled.current) {
        // Just recovered from throttle
        addToast({
          type: 'success',
          title: 'Assetic API rate limit cleared',
          message: 'Queued requests are being processed.',
          duration: 4000,
        });
      }

      // ── Queue depth updates ───────────────────────────────────────
      if (status.queueLength > 0 && status.queueLength !== prevQueueLen.current) {
        // Only show queue depth change as info when NOT in the initial throttle toast
        if (prevThrottled.current && status.queueLength > prevQueueLen.current) {
          addToast({
            type: 'info',
            title: 'Assetic request queued',
            message: `${status.queueLength} request${status.queueLength !== 1 ? 's' : ''} waiting. ${status.remaining} slots remaining${workerLabel}.`,
            duration: 3000,
          });
        }
      }

      if (status.queueLength === 0 && prevQueueLen.current > 0) {
        addToast({
          type: 'success',
          title: 'Assetic queue drained',
          message: 'All queued API requests have been processed.',
          duration: 4000,
        });
      }

      prevThrottled.current = status.isThrottled;
      prevQueueLen.current = status.queueLength;

      // Poll faster when throttled
      const interval = status.isThrottled || status.queueLength > 0 ? 2000 : 5000;
      timerRef.current = setTimeout(poll, interval);
    } catch {
      // Silently retry — endpoint may not be reachable
      timerRef.current = setTimeout(poll, 10000);
    }
  }, [isAdmin, addToast]);

  useEffect(() => {
    if (!isAdmin) return;

    // Start polling
    timerRef.current = setTimeout(poll, 3000); // initial delay

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isAdmin, poll]);
}
