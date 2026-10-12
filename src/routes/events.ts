import { Router } from 'express';
import type { Env } from '../config.js';
import type { Logger } from '../logger.js';
import { createNestProxy } from '../proxy/nest-client.js';

export function eventsRouter(config: Env, logger: Logger): Router {
  const router = Router();
  const proxy = createNestProxy(config, logger);

  router.post('/events', proxy);
  router.post('/events/bulk', proxy);

  return router;
}
