export class TimeoutError extends Error {
  readonly code = 'EXTERNAL_TIMEOUT';

  constructor(
    message: string,
    readonly timeoutMs: number,
  ) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Race `promise` against a deadline. Optional `onTimeout` cleans up
 * (e.g. destroy an upload stream) when the timer wins.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
  onTimeout?: () => void,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          try {
            onTimeout?.();
          } catch {
            // Cleanup must not mask the timeout error.
          }
          reject(new TimeoutError(`${label} timed out after ${timeoutMs}ms`, timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/** AbortSignal with a deadline; falls back to a manual controller on older runtimes. */
export function abortSignalAfter(timeoutMs: number): AbortSignal {
  if (
    typeof AbortSignal !== 'undefined' &&
    typeof AbortSignal.timeout === 'function'
  ) {
    return AbortSignal.timeout(timeoutMs);
  }

  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}
