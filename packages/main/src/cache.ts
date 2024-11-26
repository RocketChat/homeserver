export function cache<T>(
  fn: () => Promise<T>,
  timeout: number
): () => Promise<T> {
  let cached: T | undefined;
  let timeoutId = Date.now();

  return async () => {
    if (Date.now() - timeoutId > timeout) {
      timeoutId = Date.now();
      cached = undefined;
    }
    return cached || ((cached = await fn()), cached);
  };
}
