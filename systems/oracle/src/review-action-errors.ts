export class OracleReviewActionError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "OracleReviewActionError";
    this.statusCode = statusCode;
    this.code = code;
  }
}
