export function shouldDropCloudflareWebkitBridgeError(event, hint) {
  const exception = event?.exception?.values?.[0];
  const message = [
    exception?.value,
    hint?.originalException?.message,
    event?.message,
  ].filter(Boolean).join(' ');
  if (!message.includes('window.webkit.messageHandlers')) return false;

  const frames = exception?.stacktrace?.frames || [];
  return frames.some((frame) => (
    frame?.function === 'sendDataToNative' ||
    frame?.function === 'sendPageHideMessage' ||
    String(frame?.filename || '').includes('/cdn-cgi/challenge-platform/')
  ));
}
