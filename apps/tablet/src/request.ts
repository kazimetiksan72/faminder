// React Native's AbortSignal polyfill does not provide timeout() or any().
export async function withRequestSignal<T>(
  timeoutMs: number,
  parent: AbortSignal | undefined,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (parent?.aborted) cancel();
  else parent?.addEventListener('abort', cancel);
  const timer = setTimeout(cancel, timeoutMs);
  try {
    return await work(controller.signal);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', cancel);
  }
}
