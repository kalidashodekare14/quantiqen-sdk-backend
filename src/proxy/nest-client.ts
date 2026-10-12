import type { Request, RequestHandler, Response } from 'express';
import type { Env } from '../config.js';
import type { Logger } from '../logger.js';

/**
 * Forward the request to the private NestJS platform and pass the response
 * through untouched. The upstream URL is fixed configuration — never
 * customer-supplied (no SSRF surface). Upstream POSTs are never retried;
 * retries are the SDK's job and the platform is idempotency-keyed.
 */
export function createNestProxy(
  config: Env,
  logger: Logger,
): RequestHandler {
  return async (req: Request, res: Response) => {
    const upstreamPath = `/api/v1${req.path.replace(/^\/v1/, '')}`;
    const url = `${config.NESTJS_BASE_URL}${upstreamPath}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-API-KEY': req.header('X-API-KEY') ?? '',
      'X-Request-Id': req.id ?? '',
    };

    // Never trust an inbound proxy secret — strip it (all inbound headers
    // outside the allow-list are dropped) and attach the configured one.
    if (config.INTERNAL_PROXY_SECRET) {
      headers['X-Internal-Proxy-Secret'] = config.INTERNAL_PROXY_SECRET;
    }
    const sdkVersion = req.header('X-SDK-Version');
    if (sdkVersion) {
      headers['X-SDK-Version'] = sdkVersion;
    }

    try {
      const upstream = await fetch(url, {
        method: req.method,
        headers,
        body: req.rawBody ? new Uint8Array(req.rawBody) : undefined,
        signal: AbortSignal.timeout(config.REQUEST_TIMEOUT_MS),
      });

      const body = Buffer.from(await upstream.arrayBuffer());
      const contentType =
        upstream.headers.get('content-type') ?? 'application/json';
      res.setHeader('Content-Type', contentType);
      const retryAfter = upstream.headers.get('retry-after');
      if (retryAfter) {
        res.setHeader('Retry-After', retryAfter);
      }

      logger.info('upstream_response', {
        request_id: req.id,
        method: req.method,
        path: req.path,
        upstream_status: upstream.status,
      });

      res.status(upstream.status).send(body);
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        logger.warn('upstream_timeout', {
          request_id: req.id,
          method: req.method,
          path: req.path,
          timeout_ms: config.REQUEST_TIMEOUT_MS,
        });
        res.status(504).json({
          error: {
            code: 'UPSTREAM_TIMEOUT',
            message: `Platform did not respond within ${config.REQUEST_TIMEOUT_MS}ms.`,
            request_id: req.id,
          },
        });
        return;
      }

      logger.error('upstream_unavailable', {
        request_id: req.id,
        method: req.method,
        path: req.path,
        detail: err instanceof Error ? err.message : String(err),
      });
      res.status(503).json({
        error: {
          code: 'UPSTREAM_UNAVAILABLE',
          message: 'Platform backend is temporarily unreachable.',
          request_id: req.id,
        },
      });
    }
  };
}
