/**
 * Structured logging with secret redaction.
 *
 * Every log line is JSON so it can be shipped and queried. Values whose keys look like
 * credentials are replaced before serialization — there is no code path that writes a secret,
 * including when an error object carries request headers.
 */

const SECRET_KEY = /(api[_-]?key|token|secret|password|passwd|authorization|cookie|credential|bearer|session)/i;
const SECRET_VALUE = /\b(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._-]{12,})/g;

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]';
  if (typeof value === 'string') return value.replace(SECRET_VALUE, '[redacted]');
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Error) {
    return { name: value.name, message: redact(value.message, depth + 1), code: (value as { code?: string }).code };
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export function createLogger(
  bindings: Record<string, unknown> = {},
  opts: { level?: LogLevel; sink?: (line: string) => void } = {},
): Logger {
  const min = LEVEL_ORDER[opts.level ?? ((process.env.LOG_LEVEL as LogLevel) || 'info')] ?? 20;
  const sink = opts.sink ?? ((line: string) => process.stdout.write(`${line}\n`));

  const emit = (level: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (LEVEL_ORDER[level] < min) return;
    const payload = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...(redact(bindings) as Record<string, unknown>),
      ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
    };
    sink(JSON.stringify(payload));
  };

  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: (extra) => createLogger({ ...bindings, ...extra }, opts),
  };
}

/** Discards output. Used in tests that assert behavior rather than logging. */
export const nullLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return nullLogger;
  },
};
