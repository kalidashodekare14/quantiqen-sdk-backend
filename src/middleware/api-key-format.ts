import type { RequestHandler } from 'express';

const API_KEY_PATTERN = /^qtn_(live|test|dev)_[A-Za-z0-9_-]+$/;

/**
 * Cheap format pre-check — NOT authentication. Real key validation happens
 * only in the NestJS ApiKeyGuard. This just rejects obvious garbage with a
 * 400 before touching the upstream. Scoped to /v1/* so liveness probes on
 * /health and /ready are unaffected.
 */
export const apiKeyFormat: RequestHandler = (req, res, next) => {
  if (!req.path.startsWith('/v1')) return next();

  const key = req.header('X-API-KEY');
  if (!key || !API_KEY_PATTERN.test(key)) {
    res.status(400).json({
      error: {
        code: 'INVALID_API_KEY',
        message:
          'Missing or malformed X-API-KEY header. Expected a key matching qtn_{live|test|dev}_<secret>.',
        request_id: req.id,
      },
    });
    return;
  }
  next();
};
