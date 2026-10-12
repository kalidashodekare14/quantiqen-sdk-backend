export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

const SECRET_HEADERS = new Set(['x-api-key', 'x-internal-proxy-secret']);

/** Redact secret-looking values; keep only the `qtn_` prefix of API keys. */
export function redact(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (value.startsWith('qtn_')) {
    return `${value.slice(0, 4)}[redacted]`;
  }
  return value;
}

function redactFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = SECRET_HEADERS.has(key.toLowerCase()) ? redact(value) : value;
  }
  return out;
}

export function createLogger(
  level: LogLevel = 'info',
  base: Record<string, unknown> = {},
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): Logger {
  const emit = (lvl: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (LEVEL_ORDER[lvl] < LEVEL_ORDER[level]) return;
    write(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: lvl,
        msg,
        ...redactFields({ ...base, ...fields }),
      }),
    );
  };

  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
    child: (fields) => createLogger(level, { ...base, ...fields }, write),
  };
}
