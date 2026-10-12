import { describe, it, expect, vi } from 'vitest';
import type { ErrorRequestHandler, Request, Response } from 'express';
import { errorHandler } from '../src/middleware/error-handler.js';
import { createLogger } from '../src/logger.js';

const logger = createLogger('error', {}, () => {});

function mockRes() {
  return {
    headersSent: false,
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

const req = {
  id: 'req_unit',
  method: 'POST',
  path: '/v1/events/bulk',
} as unknown as Request;

describe('errorHandler', () => {
  it('maps unexpected errors to a 500 envelope', () => {
    const res = mockRes();
    (errorHandler(logger) as ErrorRequestHandler)(
      new Error('boom'),
      req,
      res,
      vi.fn(),
    );

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'boom',
        request_id: 'req_unit',
      },
    });
  });

  it('maps body-parser entity.too.large to 413', () => {
    const res = mockRes();
    const err = Object.assign(new Error('too large'), {
      type: 'entity.too.large',
    });
    (errorHandler(logger) as ErrorRequestHandler)(err, req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body too large.',
        request_id: 'req_unit',
      },
    });
  });

  it('maps non-Error values to the generic envelope', () => {
    const res = mockRes();
    (errorHandler(logger) as ErrorRequestHandler)(
      'string failure',
      req,
      res,
      vi.fn(),
    );

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
        request_id: 'req_unit',
      },
    });
  });

  it('does nothing once headers are sent', () => {
    const res = mockRes();
    res.headersSent = true;
    const next = vi.fn();

    (errorHandler(logger) as ErrorRequestHandler)(
      new Error('boom'),
      req,
      res,
      next,
    );

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
