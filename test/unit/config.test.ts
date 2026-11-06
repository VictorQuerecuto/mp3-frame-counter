import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULT_CONFIG, loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('uses defaults when nothing is set', () => {
    expect(loadConfig({})).toEqual(DEFAULT_CONFIG);
  });

  it('treats empty strings as unset', () => {
    expect(loadConfig({ PORT: '', MAX_FILE_SIZE: '', LOG_LEVEL: '' })).toEqual(DEFAULT_CONFIG);
  });

  it('reads every variable', () => {
    expect(
      loadConfig({ PORT: '8080', HOST: '0.0.0.0', MAX_FILE_SIZE: '1048576', LOG_LEVEL: 'debug' }),
    ).toEqual({ port: 8080, host: '0.0.0.0', maxFileSizeBytes: 1_048_576, logLevel: 'debug' });
  });

  it.each([
    { env: { PORT: 'abc' }, variable: 'PORT' },
    { env: { PORT: '70000' }, variable: 'PORT' },
    { env: { PORT: '30.5' }, variable: 'PORT' },
    { env: { MAX_FILE_SIZE: '0' }, variable: 'MAX_FILE_SIZE' },
    { env: { MAX_FILE_SIZE: '-5' }, variable: 'MAX_FILE_SIZE' },
    { env: { MAX_FILE_SIZE: '10MB' }, variable: 'MAX_FILE_SIZE' },
    { env: { LOG_LEVEL: 'loud' }, variable: 'LOG_LEVEL' },
  ])('rejects $env with a ConfigError naming $variable', ({ env, variable }) => {
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(variable);
  });
});
