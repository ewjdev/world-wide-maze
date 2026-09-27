/** Structured JSON logging (one object per line; Workers Logs indexes the fields). */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

/** Captured URLs can carry credentials in query/path fields; never send them to Workers logs. */
function redact(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/https?:\/\/[^\s<>"']+/gi, '[redacted-url]');
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /^(text|title|prompt|body|content)$/i.test(key) ? '[redacted-content]' : redact(item),
      ]),
    );
  return value;
}

export function createLogger(
  base: Record<string, unknown> = {},
  sink: (line: string, level: LogLevel) => void = (line, level) => {
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  },
): Logger {
  const write = (level: LogLevel, msg: string, fields?: Record<string, unknown>) =>
    sink(JSON.stringify(redact({ level, msg, ...base, ...fields, t: new Date().toISOString() })), level);
  return {
    debug: (m, f) => write('debug', m, f),
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
    child: (fields) => createLogger({ ...base, ...fields }, sink),
  };
}

/** A logger that drops everything (tests). */
export const silentLogger: Logger = createLogger({}, () => {});
