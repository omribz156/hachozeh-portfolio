export class PublishMarketServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "PublishMarketServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}
