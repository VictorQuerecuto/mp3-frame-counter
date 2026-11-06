import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Config } from '../config.js';
import { type ErrorBody, toHttpError } from './errors.js';
import { fileUploadRoutes } from './routes/fileUpload.js';

export interface BuildAppOptions {
  /** Overrides the default logger (e.g. `false` in tests). */
  logger?: FastifyServerOptions['logger'];
}

export function buildApp(config: Config, options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? { level: config.logLevel } });

  void app.register(multipart, {
    limits: {
      fileSize: config.maxFileSizeBytes,
      files: 1,
      fields: 10,
      fieldSize: 1024,
      parts: 20,
    },
  });
  void app.register(fileUploadRoutes, { maxFileSizeBytes: config.maxFileSizeBytes });

  app.setNotFoundHandler(async (request, reply) => {
    const body: ErrorBody = {
      error: { code: 'NOT_FOUND', message: `No route for ${request.method} ${request.url}.` },
    };
    return reply.code(404).send(body);
  });

  // Every error, from our code, Fastify or the multipart parser, leaves through here, so all
  // error responses share one JSON shape and nothing internal leaks to the client.
  app.setErrorHandler(async (error, request, reply) => {
    const httpError = toHttpError(error, config.maxFileSizeBytes);
    if (httpError.statusCode >= 500) {
      request.log.error({ err: error }, 'request failed');
    } else {
      request.log.info({ code: httpError.code, reason: httpError.message }, 'request rejected');
    }
    return reply.code(httpError.statusCode).send(httpError.toBody());
  });

  return app;
}
