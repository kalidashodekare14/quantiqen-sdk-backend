import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from '../logger.js';

/**
 * Maps body-parser and unexpected errors to the platform error envelope
 * `{ error: { code, message, request_id } }`. Upstream errors are never
 * produced here — the proxy passes NestJS responses through untouched.
 */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    if (res.headersSent) return;

    let status = 500;
    let code = 'INTERNAL_SERVER_ERROR';
    let message = 'An unexpected error occurred';

    const type = (err as { type?: string }).type;
    if (type === 'entity.too.large') {
      status = 413;
      code = 'PAYLOAD_TOO_LARGE';
      message = 'Request body too large.';
    } else if (type === 'entity.parse.failed') {
      status = 400;
      code = 'BAD_REQUEST';
      message = 'Malformed JSON body.';
    } else if (err instanceof Error) {
      message = err.message;
    }

    logger.error('request_failed', {
      request_id: req.id,
      method: req.method,
      path: req.path,
      status,
      code,
      detail: err instanceof Error ? err.message : String(err),
    });

    res.status(status).json({
      error: { code, message, request_id: req.id },
    });
  };
}

/** JSON 404 for unmatched routes — same envelope as the platform. */
export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found.`,
      request_id: req.id,
    },
  });
};
