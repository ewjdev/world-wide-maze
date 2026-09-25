/** Structured JSON logging (one object per line; Workers Logs indexes the fields). */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
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
    sink(JSON.stringify({ level, msg, ...base, ...fields, t: new Date().toISOString() }), level);
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
