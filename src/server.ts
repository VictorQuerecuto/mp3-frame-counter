import { ConfigError, loadConfig } from './config.js';
import { buildApp } from './http/app.js';

/** How long in-flight uploads get to finish after a shutdown signal. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const app = buildApp(config);

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down: no new connections, finishing in-flight requests');

    setTimeout(() => {
      app.log.error('shutdown timed out, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();

    app.close().then(
      () => {
        app.log.info('server closed');
      },
      (error: unknown) => {
        app.log.error({ err: error }, 'error during shutdown');
        process.exitCode = 1;
      },
    );
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  await app.listen({ port: config.port, host: config.host });
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(`Invalid configuration: ${error.message}`);
  } else {
    console.error('Failed to start the server:', error);
  }
  process.exit(1);
});
