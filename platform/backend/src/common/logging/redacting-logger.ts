import { ConsoleLogger, LoggerService } from '@nestjs/common';

const SENSITIVE_KEY = /(?:password|passwd|secret|token|api[-_]?key|authorization|private[-_]?key|aes[-_]?key)/i;
const STRING_PATTERNS: Array<[RegExp, string]> = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]'],
  [/((?:password|passwd|secret|token|api[-_]?key|access_token|private[-_]?key|aes[-_]?key)=)[^&\s]+/gi, '$1[REDACTED]'],
  [/("(?:password|passwd|secret|token|api[-_]?key|authorization|private[-_]?key|aes[-_]?key)"\s*:\s*")[^"]*(")/gi, '$1[REDACTED]$2'],
  [/enc:v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+/g, '[ENCRYPTED]'],
];

export function redactLogValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return STRING_PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
  if (value instanceof Error) {
    const error = new Error(String(redactLogValue(value.message)));
    error.name = value.name;
    error.stack = value.stack ? String(redactLogValue(value.stack)) : undefined;
    return error;
  }
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactLogValue(item, seen));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactLogValue(item, seen),
  ]));
}

/** Global Nest logger adapter; existing Logger instances delegate through it. */
export class RedactingLogger implements LoggerService {
  private readonly logger = new ConsoleLogger();

  log(message: any, ...optionalParams: any[]): void {
    this.logger.log(redactLogValue(message), ...optionalParams.map((item) => redactLogValue(item)));
  }

  error(message: any, ...optionalParams: any[]): void {
    this.logger.error(redactLogValue(message), ...optionalParams.map((item) => redactLogValue(item)));
  }

  warn(message: any, ...optionalParams: any[]): void {
    this.logger.warn(redactLogValue(message), ...optionalParams.map((item) => redactLogValue(item)));
  }

  debug(message: any, ...optionalParams: any[]): void {
    this.logger.debug(redactLogValue(message), ...optionalParams.map((item) => redactLogValue(item)));
  }

  verbose(message: any, ...optionalParams: any[]): void {
    this.logger.verbose(redactLogValue(message), ...optionalParams.map((item) => redactLogValue(item)));
  }

  fatal(message: any, ...optionalParams: any[]): void {
    this.logger.fatal(redactLogValue(message), ...optionalParams.map((item) => redactLogValue(item)));
  }
}
