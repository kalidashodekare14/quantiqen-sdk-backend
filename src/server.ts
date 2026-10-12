import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createApp } from './app.js';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const app = createApp(config, logger);

  const server = app.listen(config.PORT, () => {
    logger.info('server_started', {
      port: config.PORT,
      nestjs_base_url: config.NESTJS_BASE_URL,
    });
  });

  const shutdown = (signal: string) => {
    logger.info('shutdown_signal', { signal });
    server.close(() => process.exit(0));
    // Force-exit if in-flight requests refuse to drain.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Log runtime rejections loudly instead of crashing; genuine boot failures
// still fail fast through bootstrap().catch below (exit 1 = bad deploy).
process.on('unhandledRejection', (reason) => {
  const detail =
    reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
  createLogger().error('unhandled_rejection', { detail });
});

bootstrap().catch((err) => {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  createLogger().error('bootstrap_failed', { detail });
  process.exit(1);
});
