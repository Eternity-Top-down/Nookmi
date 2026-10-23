import { describe, expect, it } from "vitest";
import { FEEDBACK_BATCH_CONCURRENCY, runFeedbackPool } from "./feedbackGenerationPool";

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function fixture(count: number) {
  const items = Array.from({ length: count }, (_, index) => ({ studentId: `student-${index}` }));
  const gates = items.map(deferred);
  const started = items.map(deferred);
  const calls: Array<{ studentId: string; index: number }> = [];
  const completed: number[] = [];
  let active = 0;
  let maxActive = 0;
  const worker = async (item: { studentId: string }, index: number) => {
    calls.push({ studentId: item.studentId, index });
    active += 1;
    maxActive = Math.max(maxActive, active);
    started[index].resolve();
    try {
      await gates[index].promise;
      completed.push(index);
    } finally {
      active -= 1;
    }
  };
  return { items, gates, started, calls, completed, worker, maxActive: () => maxActive };
}

describe("feedback generation worker pool", () => {
  it("starts three requests immediately and fills a free slot without waiting for the slow first request", async () => {
    const batch = fixture(5);
    const result = runFeedbackPool(batch.items, batch.worker);
    expect(FEEDBACK_BATCH_CONCURRENCY).toBe(3);
    expect(batch.calls.map((call) => call.index)).toEqual([0, 1, 2]);

    batch.gates[1].resolve();
    await batch.started[3].promise;
    expect(batch.completed).toEqual([1]);
    expect(batch.calls[3]).toEqual({ studentId: "student-3", index: 3 });

    batch.gates[3].resolve();
    await batch.started[4].promise;
    expect(batch.completed).toEqual([1, 3]);
    expect(batch.calls[4]).toEqual({ studentId: "student-4", index: 4 });

    batch.gates[4].resolve();
    batch.gates[2].resolve();
    batch.gates[0].resolve();
    await result;
    expect(batch.completed).toEqual([1, 3, 4, 2, 0]);
    expect(batch.maxActive()).toBe(3);
    expect(batch.calls).toEqual(batch.items.map((item, index) => ({ ...item, index })));
  });

  it("limits a single worker to sequential requests", async () => {
    const batch = fixture(2);
    const result = runFeedbackPool(batch.items, batch.worker, { concurrency: 1 });
    expect(batch.calls.map((call) => call.index)).toEqual([0]);
    batch.gates[0].resolve();
    await batch.started[1].promise;
    expect(batch.completed).toEqual([0]);
    batch.gates[1].resolve();
    await result;
    expect(batch.maxActive()).toBe(1);
  });

  it("stops queued items on abort and waits for all active requests", async () => {
    const batch = fixture(5);
    const controller = new AbortController();
    let settled = false;
    const result = runFeedbackPool(batch.items, batch.worker, { signal: controller.signal })
      .then(() => { settled = true; });
    controller.abort();
    batch.gates[0].resolve();
    batch.gates[1].resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(batch.calls).toHaveLength(3);
    batch.gates[2].resolve();
    await result;
    expect(settled).toBe(true);
    expect(batch.calls).toHaveLength(3);
  });

  it("does not start any requests if already aborted", async () => {
    const batch = fixture(2);
    const controller = new AbortController();
    controller.abort();
    await runFeedbackPool(batch.items, batch.worker, { signal: controller.signal });
    expect(batch.calls).toEqual([]);
  });

  it("stops queued items when the caller marks the batch obsolete or fatally failed", async () => {
    const batch = fixture(5);
    let allowed = true;
    const result = runFeedbackPool(batch.items, batch.worker, { shouldContinue: () => allowed });
    allowed = false;
    batch.gates[0].resolve();
    batch.gates[1].resolve();
    batch.gates[2].resolve();
    await result;
    expect(batch.calls).toHaveLength(3);
  });

  it("does not start requests when shouldContinue initially returns false", async () => {
    const batch = fixture(2);
    await runFeedbackPool(batch.items, batch.worker, { shouldContinue: () => false });
    expect(batch.calls).toEqual([]);
  });

  it("stops queued work on an unexpected rejection, but does not reject until other active work settles", async () => {
    const batch = fixture(5);
    const failure = new Error("unexpected worker failure");
    let settled = false;
    const result = runFeedbackPool(batch.items, batch.worker);
    const observed = result.then(
      () => { settled = true; },
      (error: unknown) => { settled = true; return error; },
    );
    batch.gates[0].reject(failure);
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(batch.calls).toHaveLength(3);
    batch.gates[1].reject(new Error("later failure"));
    batch.gates[2].resolve();
    expect(await observed).toBe(failure);
    expect(settled).toBe(true);
    expect(batch.calls).toHaveLength(3);
  });

  it("waits for active work if the continuation check throws", async () => {
    const batch = fixture(3);
    const failure = new Error("check failed");
    let checks = 0;
    const result = runFeedbackPool(batch.items, batch.worker, {
      shouldContinue: () => {
        checks += 1;
        if (checks === 2) throw failure;
        return true;
      },
    });
    const observed = result.catch((error: unknown) => error);
    expect(batch.calls).toHaveLength(1);
    batch.gates[0].resolve();
    expect(await observed).toBe(failure);
    expect(batch.calls).toHaveLength(1);
  });

  it("propagates even a worker rejection with an undefined reason", async () => {
    let rejected = false;
    await runFeedbackPool([1], () => Promise.reject(undefined)).catch((error: unknown) => {
      rejected = true;
      expect(error).toBeUndefined();
    });
    expect(rejected).toBe(true);
  });

  it("handles an empty batch and a concurrency larger than the item count", async () => {
    const calls: number[] = [];
    const worker = async (item: number) => { calls.push(item); };
    await runFeedbackPool([], worker);
    expect(calls).toEqual([]);
    await runFeedbackPool([1, 2], worker, { concurrency: 10 });
    expect(calls).toEqual([1, 2]);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid concurrency %s without starting work",
    async (concurrency) => {
      const batch = fixture(1);
      await expect(runFeedbackPool(batch.items, batch.worker, { concurrency })).rejects.toThrow(RangeError);
      expect(batch.calls).toEqual([]);
    },
  );
});
