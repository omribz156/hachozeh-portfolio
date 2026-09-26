export class TradeServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: Record<string, unknown> | null;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "TradeServiceError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details ?? null;
  }
}
