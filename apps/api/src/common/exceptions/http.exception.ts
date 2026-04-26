import { HttpException } from '@nestjs/common';

/**
 * Drop-in replacement for the legacy `HttpError` so existing service code keeps
 * working: `throw HttpError.notFound('Trip x')`.
 *
 * The response body is shaped as `{ error, details? }` (same as the old Express
 * errorHandler) — the global filter relies on this.
 *
 * NOTE: HttpException's `status` field is private; do not expose a public
 * `status` getter (it would conflict). Use `err.getStatus()` instead.
 */
export class HttpError extends HttpException {
  public readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(
      details !== undefined ? { error: message, details } : { error: message },
      status,
    );
    this.details = details;
    this.name = 'HttpError';
  }

  static badRequest(message: string, details?: unknown): HttpError {
    return new HttpError(400, message, details);
  }
  static unauthorized(message = 'Unauthorized'): HttpError {
    return new HttpError(401, message);
  }
  static forbidden(message = 'Forbidden'): HttpError {
    return new HttpError(403, message);
  }
  static notFound(message = 'Not found'): HttpError {
    return new HttpError(404, message);
  }
  static conflict(message: string, details?: unknown): HttpError {
    return new HttpError(409, message, details);
  }
}
