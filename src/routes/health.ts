import { Router } from 'express';
import type { Env } from '../config.js';

const READY_TIMEOUT_MS = 2000;

export function healthRouter(config: Env): Router {
  const router = Router();

  // Liveness — no dependencies, no auth.
  router.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', uptime_s: Math.round(process.uptime()) });
  });

  // Readiness — is the private platform reachable?
  router.get('/ready', async (_req, res) => {
    try {
      const upstream = await fetch(`${config.NESTJS_BASE_URL}/api/v1/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(READY_TIMEOUT_MS),
      });
      if (upstream.ok) {
        res.status(200).json({ status: 'ready' });
        return;
      }
      res.status(503).json({ status: 'unavailable' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  return router;
}
