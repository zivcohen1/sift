/**
 * The error both product readers throw when a database is down, slow or rate-limiting us.
 * It lives in one place so `instanceof SourceUnavailableError` works for every reader.
 */
export class SourceUnavailableError extends Error {
  constructor(
    message: string,
    public httpStatus?: number,
  ) {
    super(message);
    this.name = "SourceUnavailableError";
  }
}
