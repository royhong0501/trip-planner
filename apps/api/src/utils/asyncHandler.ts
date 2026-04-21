import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 5 forwards async errors automatically, but this wrapper keeps the
 * type signature tight (handlers can `throw`) and makes migration off older
 * middleware libraries trivial.
 */
export function asyncHandler<P = unknown, ResBody = unknown, ReqBody = unknown, ReqQuery = unknown>(
  fn: (req: Request<P, ResBody, ReqBody, ReqQuery>, res: Response<ResBody>, next: NextFunction) => Promise<unknown>,
): RequestHandler<P, ResBody, ReqBody, ReqQuery> {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
