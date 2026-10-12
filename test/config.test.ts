import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('applies defaults and normalizes the upstream base URL', () => {
    const config = loadConfig({
      NESTJS_BASE_URL: 'https://platform.example.com/',
    } as NodeJS.ProcessEnv);

    expect(config.PORT).toBe(3000);
    expect(config.NESTJS_BASE_URL).toBe('https://platform.example.com');
    expect(config.REQUEST_TIMEOUT_MS).toBe(10000);
    expect(config.MAX_BODY_SIZE).toBe('512kb');
    expect(config.RATE_LIMIT_WINDOW_MS).toBe(60000);
    expect(config.RATE_LIMIT_MAX).toBe(600);
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.CORS_ORIGINS).toBeUndefined();
    expect(config.INTERNAL_PROXY_SECRET).toBeUndefined();
  });

  it('parses CORS_ORIGINS into a trimmed list', () => {
    const config = loadConfig({
      NESTJS_BASE_URL: 'http://localhost:3000',
      CORS_ORIGINS: 'https://a.example.com , https://b.example.com,,',
    } as NodeJS.ProcessEnv);

    expect(config.CORS_ORIGINS).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });

  it('treats a blank CORS_ORIGINS as unset', () => {
    const config = loadConfig({
      NESTJS_BASE_URL: 'http://localhost:3000',
      CORS_ORIGINS: ' , ',
    } as NodeJS.ProcessEnv);

    expect(config.CORS_ORIGINS).toBeUndefined();
  });

  it('coerces numeric env strings', () => {
    const config = loadConfig({
      NESTJS_BASE_URL: 'http://localhost:3000',
      PORT: '4000',
      RATE_LIMIT_MAX: '5',
      LOG_LEVEL: 'debug',
    } as NodeJS.ProcessEnv);

    expect(config.PORT).toBe(4000);
    expect(config.RATE_LIMIT_MAX).toBe(5);
    expect(config.LOG_LEVEL).toBe('debug');
  });

  it('throws when NESTJS_BASE_URL is missing', () => {
    expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow(
      'Invalid environment variables',
    );
  });

  it('throws on an invalid URL', () => {
    expect(() =>
      loadConfig({ NESTJS_BASE_URL: 'not-a-url' } as NodeJS.ProcessEnv),
    ).toThrow('Invalid environment variables');
  });

  it('throws on an invalid LOG_LEVEL', () => {
    expect(() =>
      loadConfig({
        NESTJS_BASE_URL: 'http://localhost:3000',
        LOG_LEVEL: 'verbose',
      } as NodeJS.ProcessEnv),
    ).toThrow('Invalid environment variables');
  });
});
