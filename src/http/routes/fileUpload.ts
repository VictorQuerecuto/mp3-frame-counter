import type { FastifyInstance } from 'fastify';
import { countFrames } from '../../mp3/index.js';
import { fileTooLarge, HttpError } from '../errors.js';

const FILE_FIELD = 'file';

export interface FileUploadRouteOptions {
  maxFileSizeBytes: number;
}

export function fileUploadRoutes(app: FastifyInstance, options: FileUploadRouteOptions): void {
  app.post(
    '/file-upload',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: { frameCount: { type: 'integer' } },
            required: ['frameCount'],
            additionalProperties: false,
          },
        },
      },
    },
    async (request) => {
      const upload = await request.file();
      if (upload === undefined) {
        throw new HttpError(
          400,
          'NO_FILE',
          `No file was uploaded. Send it as multipart/form-data in a field named "${FILE_FIELD}".`,
        );
      }
      if (upload.fieldname !== FILE_FIELD) {
        throw new HttpError(
          400,
          'WRONG_FIELD',
          `Expected the file in a field named "${FILE_FIELD}", but got "${upload.fieldname}".`,
        );
      }

      // The upload is streamed straight into the counter: it is never buffered or written to disk.
      let bytesReceived = 0;
      const result = await countFrames(measure(upload.file, (size) => (bytesReceived += size)));

      // When the stream is read directly, @fastify/multipart reports the size limit by ending
      // the stream early and setting `truncated`, not by throwing. Without this check an
      // oversized upload would get a 200 with a partial count.
      if (upload.file.truncated) throw fileTooLarge(options.maxFileSizeBytes);

      if (bytesReceived === 0) {
        throw new HttpError(400, 'EMPTY_FILE', 'The uploaded file is empty.');
      }
      if (result.frameCount === 0) {
        if (result.unsupportedFormat !== null) {
          const { version, layer } = result.unsupportedFormat;
          throw new HttpError(
            422,
            'UNSUPPORTED_MPEG_FORMAT',
            `The file contains ${version} ${layer} audio. Only MPEG-1 Layer III is supported.`,
          );
        }
        throw new HttpError(
          415,
          'NOT_AN_MP3',
          'No MPEG audio frames were found. The file does not appear to be an MP3.',
        );
      }

      request.log.info(
        {
          filename: upload.filename,
          bytes: bytesReceived,
          frameCount: result.frameCount,
          metadataFrame: result.metadataFrame,
        },
        'counted frames',
      );
      return { frameCount: result.frameCount };
    },
  );

  // A known path with the wrong method gets 405 (with an Allow header) rather than 404.
  app.route({
    method: ['GET', 'PUT', 'PATCH', 'DELETE'],
    url: '/file-upload',
    handler: async (_request, reply) => {
      const error = new HttpError(
        405,
        'METHOD_NOT_ALLOWED',
        'Use POST to upload a file to /file-upload.',
      );
      // Build the response directly: awaiting `reply` (it is thenable) would wait for the
      // response to be sent, which deadlocks the handler.
      return reply.code(error.statusCode).header('allow', 'POST').send(error.toBody());
    },
  });
}

/** Passes chunks through unchanged, reporting each chunk's size. */
async function* measure(
  source: AsyncIterable<Uint8Array>,
  onChunk: (size: number) => void,
): AsyncGenerator<Uint8Array> {
  for await (const chunk of source) {
    onChunk(chunk.length);
    yield chunk;
  }
}
