import { describe, it, expect, vi } from 'vitest';
import { createLogger, redact } from '../src/logger.js';

describe('createLogger', () => {
  it('emits JSON lines with ts, level and msg', () => {
    const write = vi.fn();
    const logger = createLogger('info', { service: 'edge' }, write);

    logger.info('hello', { request_id: 'req_1' });

    expect(write).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(write.mock.calls[0][0]);
    expect(entry.level).toBe('info');
    expect(entry.msg).toBe('hello');
    expect(entry.service).toBe('edge');
    expect(entry.request_id).toBe('req_1');
    expect(typeof entry.ts).toBe('string');
  });

  it('filters below the configured level', () => {
    const write = vi.fn();
    const logger = createLogger('warn', {}, write);

    logger.debug('nope');
    logger.info('nope');
    logger.warn('yes');
    logger.error('yes');

    expect(write).toHaveBeenCalledTimes(2);
  });

  it('redacts API keys in field values', () => {
    const write = vi.fn();
    const logger = createLogger('info', {}, write);

    logger.info('request', { 'x-api-key': 'qtn_live_supersecret' });

    const entry = JSON.parse(write.mock.calls[0][0]);
    expect(entry['x-api-key']).toBe('qtn_[redacted]');
    expect(entry['x-api-key']).not.toContain('supersecret');
  });

  it('inherits base fields in child loggers', () => {
    const write = vi.fn();
    const logger = createLogger('info', { request_id: 'req_1' }, write);
    const child = logger.child({ method: 'POST' });

    child.info('chained');

    const entry = JSON.parse(write.mock.calls[0][0]);
    expect(entry.request_id).toBe('req_1');
    expect(entry.method).toBe('POST');
  });
});

describe('redact', () => {
  it('keeps only the qtn_ prefix of API keys', () => {
    expect(redact('qtn_test_secret')).toBe('qtn_[redacted]');
  });

  it('leaves other strings and non-strings alone', () => {
    expect(redact('plain')).toBe('plain');
    expect(redact(42)).toBe(42);
    expect(redact(undefined)).toBeUndefined();
  });
});
