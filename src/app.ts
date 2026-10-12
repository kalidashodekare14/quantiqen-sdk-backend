import express from 'express';
import type { Express, Request } from 'express';
import type { Env } from './config.js';
import { createLogger, type Logger } from './logger.js';
import { requestId } from './middleware/request-id.js';
import { createCors } from './middleware/cors.js';
import { apiKeyFormat } from './middleware/api-key-format.js';
import { createRateLimit } from './middleware/rate-limit.js';
import { errorHandler, notFound } from './middleware/error-handler.js';
import { healthRouter } from './routes/health.js';
import { eventsRouter } from './routes/events.js';

/**
 * Wire the Express app. Exported separately from server.ts so tests can
 * build the app with an injected config without binding a port.
 *
 * Middleware order is significant (see plan §4.2):
 * request-id → cors → health → api-key-format → rate-limit → body → events
 * → 404 → error-handler.
 */
export function createApp(config: Env, logger?: Logger): Express {
  const log = logger ?? createLogger(config.LOG_LEVEL);
  const app = express();

  app.disable('x-powered-by');
  // Render sits behind a proxy — needed for correct req.ip in the rate limiter.
  app.set('trust proxy', 1);

  app.use(requestId);
  app.use(createCors(config.CORS_ORIGINS));

  // Health/ready: no auth, no rate limit (probes must never be blocked).
  app.use(healthRouter(config));

  app.use(apiKeyFormat);
  app.use(
    createRateLimit({
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      max: config.RATE_LIMIT_MAX,
    }),
  );

  app.use(
    express.json({
      limit: config.MAX_BODY_SIZE,
      verify: (req, _res, buf) => {
        (req as Request).rawBody = buf;
      },
    }),
  );

  app.use('/v1', eventsRouter(config, log));

  app.use(notFound);
  app.use(errorHandler(log));

  return app;
}
