export const FEEDBACK_BATCH_CONCURRENCY = 3;

export interface FeedbackPoolOptions {
  concurrency?: number;
  signal?: AbortSignal;
  shouldContinue?: () => boolean;
}

/**
 * Fill available slots immediately while preserving each item's original index.
 * Cancellation stops queued work; callers use the same signal inside worker to
 * cancel active requests. Always wait for active work before returning. Unexpected
 * worker/check errors stop the queue and are rethrown after active work settles.
 */
export async function runFeedbackPool<T>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<void>,
  options: FeedbackPoolOptions = {},
): Promise<void> {
  const concurrency = options.concurrency ?? FEEDBACK_BATCH_CONCURRENCY;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new RangeError("Feedback concurrency must be a positive safe integer.");
  }

  let nextIndex = 0;
  let stopped = false;
  let hasError = false;
  let firstError: unknown;

  async function consume() {
    while (!stopped && nextIndex < items.length) {
      try {
        if (options.signal?.aborted || options.shouldContinue?.() === false) {
          stopped = true;
          return;
        }
        const index = nextIndex++;
        await worker(items[index], index);
      } catch (error) {
        if (!hasError) {
          hasError = true;
          firstError = error;
        }
        stopped = true;
        return;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, consume));
  if (hasError) throw firstError;
}
