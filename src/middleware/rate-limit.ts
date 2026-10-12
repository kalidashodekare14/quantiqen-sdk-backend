import type { RequestHandler } from 'express';

interface Window {
  count: number;
  resetAt: number;
}

/**
 * In-memory per-IP sliding-window limiter. Correct for a single edge
 * instance (MVP). If the edge scales past one instance and exact limits
 * matter, swap the store for Redis inside this file only.
 */
export function createRateLimit(opts: {
  windowMs: number;
  max: number;
  now?: () => number;
}): RequestHandler {
  const now = opts.now ?? Date.now;
  const windows = new Map<string, Window>();

  // Opportunistic cleanup so the map cannot grow unbounded.
  const sweep = () => {
    const t = now();
    for (const [ip, w] of windows) {
      if (w.resetAt <= t) windows.delete(ip);
    }
  };

  return (req, res, next) => {
    if (!req.path.startsWith('/v1')) return next();

    const ip = req.ip ?? 'unknown';
    const t = now();

    if (windows.size > 10_000) sweep();

    let w = windows.get(ip);
    if (!w || w.resetAt <= t) {
      w = { count: 0, resetAt: t + opts.windowMs };
      windows.set(ip, w);
    }

    w.count += 1;

    if (w.count > opts.max) {
      const retryAfterSec = Math.max(1, Math.ceil((w.resetAt - t) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Slow down and retry after the delay.',
          request_id: req.id,
        },
      });
      return;
    }

    next();
  };
}
