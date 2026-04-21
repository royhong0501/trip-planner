import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';

type Source = 'body' | 'query' | 'params';

/**
 * `validate(schema, 'body')` parses that field on the request and replaces it
 * with the parsed/coerced value. Throws ZodError, which errorHandler renders as 400.
 */
export function validate<Schema extends ZodTypeAny>(schema: Schema, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed = schema.parse(req[source]) as z.infer<Schema>;
      if (source === 'query') {
        // Express 5's req.query is a read-only accessor, so we stash the parsed value on locals.
        (req as Request & { validatedQuery?: unknown }).validatedQuery = parsed;
      } else {
        (req[source] as z.infer<Schema>) = parsed;
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        next(err);
        return;
      }
      next(err);
    }
  };
}

/** Access the query parsed via validate(..., 'query'). */
export function getValidatedQuery<T>(req: Request): T {
  return (req as Request & { validatedQuery?: T }).validatedQuery as T;
}
