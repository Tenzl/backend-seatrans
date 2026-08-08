import { AsyncSemaphore } from './async-semaphore';
import { mapWithConcurrency } from './map-with-concurrency';
import { withTimeout, TimeoutError } from './with-timeout';

describe('mapWithConcurrency', () => {
  it('preserves order with bounded parallelism', async () => {
    const started: number[] = [];
    const results = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => {
      started.push(n);
      await new Promise((r) => setTimeout(r, 10));
      return n * 10;
    });
    expect(results).toEqual([10, 20, 30, 40]);
    expect(started.slice(0, 2).sort()).toEqual([1, 2]);
  });
});

describe('AsyncSemaphore', () => {
  it('never exceeds capacity', async () => {
    const gate = new AsyncSemaphore(2);
    let peak = 0;
    let inFlight = 0;

    await Promise.all(
      Array.from({ length: 6 }, () =>
        gate.run(async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise((r) => setTimeout(r, 15));
          inFlight -= 1;
        }),
      ),
    );

    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe('withTimeout', () => {
  it('rejects when the deadline elapses', async () => {
    await expect(
      withTimeout(new Promise(() => undefined), 20, 'demo'),
    ).rejects.toBeInstanceOf(TimeoutError);
  });
});
