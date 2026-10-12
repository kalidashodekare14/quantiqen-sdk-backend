import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';

export function requestId(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.header('X-Request-Id');
  const id =
    incoming && /^[\w.:-]{1,128}$/.test(incoming) ? incoming : randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
}
