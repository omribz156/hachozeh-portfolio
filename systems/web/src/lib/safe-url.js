export function safeHttpsUrl(value) {
  if (typeof value !== 'string') {
    return null;
  }

  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}
