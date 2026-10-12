import { loadConfig, type Env } from '../src/config.js';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/logger.js';

export const TEST_API_KEY = 'qtn_test_abc123DEF456';

export function testConfig(overrides: Partial<Env> = {}): Env {
  return {
    ...loadConfig({
      ...process.env,
      NESTJS_BASE_URL: 'http://upstream.test',
      LOG_LEVEL: 'error',
    }),
    ...overrides,
  };
}

export function testApp(overrides: Partial<Env> = {}) {
  const config = testConfig(overrides);
  const logger = createLogger(config.LOG_LEVEL, {}, () => {});
  return createApp(config, logger);
}
