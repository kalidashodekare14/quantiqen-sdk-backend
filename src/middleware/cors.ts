import cors from 'cors';
import type { CorsOptions } from 'cors';
import type { RequestHandler } from 'express';

/**
 * Allow-list CORS. Never "*". When CORS_ORIGINS is unset no CORS headers are
 * emitted — the SDKs are server-side clients and do not need them.
 */
export function createCors(origins: string[] | undefined): RequestHandler {
  if (!origins || origins.length === 0) {
    return (_req, _res, next) => next();
  }

  const options: CorsOptions = {
    origin: (origin, callback) => {
      // Non-browser clients (SDKs, curl) send no Origin header.
      if (!origin) return callback(null, true);
      callback(null, origins.includes(origin));
    },
    methods: ['POST'],
    allowedHeaders: ['Content-Type', 'X-API-KEY', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    maxAge: 600,
  };

  return cors(options);
}
