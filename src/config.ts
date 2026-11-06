const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Config {
  readonly port: number;
  readonly host: string;
  /** Uploads larger than this are rejected with 413. */
  readonly maxFileSizeBytes: number;
  readonly logLevel: LogLevel;
}

export const DEFAULT_CONFIG: Config = {
  port: 3000,
  host: '127.0.0.1',
  maxFileSizeBytes: 200 * 1024 * 1024, // 200 MB: hours of audio, but bounded
  logLevel: 'info',
};

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/** Reads configuration from environment variables, falling back to defaults. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: parseInteger(env, 'PORT', DEFAULT_CONFIG.port, { min: 0, max: 65_535 }),
    host: env.HOST ?? DEFAULT_CONFIG.host,
    maxFileSizeBytes: parseInteger(env, 'MAX_FILE_SIZE', DEFAULT_CONFIG.maxFileSizeBytes, {
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
    }),
    logLevel: parseLogLevel(env.LOG_LEVEL),
  };
}

function parseInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  range: { min: number; max: number },
): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < range.min || value > range.max) {
    throw new ConfigError(
      `${name} must be an integer between ${range.min} and ${range.max}, got "${raw}"`,
    );
  }
  return value;
}

function parseLogLevel(raw: string | undefined): LogLevel {
  if (raw === undefined || raw === '') return DEFAULT_CONFIG.logLevel;
  const level = LOG_LEVELS.find((candidate) => candidate === raw);
  if (level === undefined) {
    throw new ConfigError(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}, got "${raw}"`);
  }
  return level;
}
