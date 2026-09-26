export type ServerSentEventWritable = {
  write(chunk: string): unknown;
};

function sanitizeSseField(value: string): string {
  return value.replace(/[\r\n\0]/g, "");
}

export function writeServerSentEventFrame(
  response: ServerSentEventWritable,
  event: string,
  payload: unknown
): void {
  const eventId =
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    typeof (payload as Record<string, unknown>).eventId === "string"
      ? sanitizeSseField((payload as Record<string, string>).eventId)
      : null;

  if (eventId) {
    response.write(`id: ${eventId}\n`);
  }

  response.write(`event: ${sanitizeSseField(event)}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}
