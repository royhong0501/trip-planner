import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../exceptions/http.exception.js';

/**
 * Global filter mirroring the old Express errorHandler:
 *   - HttpError       → { error, details? }       at err.status
 *   - ZodError        → 400 { error, issues }
 *   - ThrottlerException → 429 { error: 中文訊息 }
 *   - HttpException   → pass through, normalized
 *   - Anything else   → 500 (prod hides message)
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');
  private readonly isProd: boolean;

  constructor(opts: { isProd: boolean } = { isProd: false }) {
    this.isProd = opts.isProd;
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    if (res.headersSent) return;

    if (exception instanceof HttpError) {
      res.status(exception.getStatus()).json(this.shapeHttpError(exception));
      return;
    }

    if (exception instanceof ZodError) {
      res.status(400).json({
        error: 'Invalid request payload',
        issues: exception.issues,
      });
      return;
    }

    if (exception instanceof ThrottlerException) {
      res.status(HttpStatus.TOO_MANY_REQUESTS).json({
        error: '太多請求，請稍候再試',
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = this.shapeNestException(exception);
      res.status(status).json(body);
      return;
    }

    this.logger.error(
      `[unhandled] ${req.method} ${req.url}`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    res.status(500).json({
      error: this.isProd
        ? 'Internal server error'
        : exception instanceof Error
          ? exception.message
          : String(exception),
    });
  }

  private shapeHttpError(err: HttpError): Record<string, unknown> {
    const body = err.getResponse();
    if (body && typeof body === 'object') {
      return body as Record<string, unknown>;
    }
    return { error: typeof body === 'string' ? body : 'Http Error' };
  }

  private shapeNestException(exception: HttpException): Record<string, unknown> {
    const raw = exception.getResponse();
    if (typeof raw === 'string') {
      return { error: raw };
    }
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      // Nest stuffs validation errors into "message" — translate to "error" for parity.
      if (typeof obj.error === 'string') return obj;
      if (typeof obj.message === 'string') {
        const { message, ...rest } = obj;
        return { error: message, ...rest };
      }
      return { error: exception.message, ...obj };
    }
    return { error: exception.message };
  }
}
