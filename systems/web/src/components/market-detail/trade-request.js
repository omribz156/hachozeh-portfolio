export async function postJSON(url, body, timeoutMs = 0, fetchImpl = globalThis.fetch) {
  const fetchFn = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch;
  const normalizedTimeoutMs = Number(timeoutMs);
  const shouldTimeout =
    Number.isFinite(normalizedTimeoutMs) && normalizedTimeoutMs > 0;
  const canUseAbortSignalTimeout =
    shouldTimeout && typeof globalThis.AbortSignal?.timeout === 'function';
  const requestOptions = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  };

  let timeoutId = null;
  let timeoutError = null;
  let controller = null;
  if (shouldTimeout) {
    if (canUseAbortSignalTimeout) {
      requestOptions.signal = globalThis.AbortSignal.timeout(normalizedTimeoutMs);
    } else {
      controller = new AbortController();
      requestOptions.signal = controller.signal;
      timeoutError = new Error(`request timed out after ${normalizedTimeoutMs}ms`);
      timeoutError.name = 'TimeoutError';
    }
  }

  try {
    const fetchResult = fetchFn(url, requestOptions);
    const response = shouldTimeout && !canUseAbortSignalTimeout
      ? await Promise.race([
        fetchResult,
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            controller?.abort(timeoutError);
            reject(timeoutError);
          }, normalizedTimeoutMs);
        }),
      ])
      : await fetchResult;

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.error) {
      const err = new Error(data?.error?.message || 'request failed');
      err.code = data?.error?.code || 'request_failed';
      throw err;
    }
    return data;
  } catch (error) {
    if (error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      // Keep timeout/abort network failures in the ambiguous class: no app-level
      // `code`, so the trade recovery path remains enabled.
      const timeoutError = new Error(error.message || 'request timed out');
      timeoutError.name = error.name;
      throw timeoutError;
    }
    throw error;
  } finally {
    if (!canUseAbortSignalTimeout && timeoutId !== null) clearTimeout(timeoutId);
  }
}
