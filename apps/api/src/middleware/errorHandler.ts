import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { isProd } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (res.headersSent) {
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Invalid request payload',
      issues: err.issues,
    });
    return;
  }

  console.error('[errorHandler] unhandled', err);
  res.status(500).json({
    error: isProd ? 'Internal server error' : (err instanceof Error ? err.message : String(err)),
  });
};
