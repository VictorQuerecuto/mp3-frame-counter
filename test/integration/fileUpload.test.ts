import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/config.js';
import { buildApp } from '../../src/http/app.js';
import { expectError, multipart, type FormPart } from '../helpers/http.js';
import { buildFrame, buildUnsupportedFrame, concatBytes, repeat } from '../helpers/mp3Builder.js';

const sample = new Uint8Array(readFileSync(new URL('../fixtures/sample.mp3', import.meta.url)));
const frame = buildFrame(); // 417 bytes

describe('POST /file-upload', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp(DEFAULT_CONFIG, { logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function upload(parts: FormPart[]) {
    return app.inject({ method: 'POST', url: '/file-upload', ...(await multipart(parts)) });
  }

  const asFile = (content: Uint8Array | string, filename = 'upload.mp3'): FormPart => ({
    field: 'file',
    content,
    filename,
  });

  describe('success', () => {
    it('returns the frame count of the sample file as JSON', async () => {
      const response = await upload([asFile(sample, 'sample.mp3')]);

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toMatch(/^application\/json/);
      expect(response.json()).toEqual({ frameCount: 6089 });
    });

    it('accepts extra text fields alongside the file', async () => {
      const response = await upload([
        { field: 'note', content: 'hello' },
        asFile(repeat(frame, 3)),
      ]);
      expect(response.json()).toEqual({ frameCount: 3 });
    });

    it('counts only complete frames in a truncated file', async () => {
      const truncated = concatBytes(repeat(frame, 5), frame.subarray(0, 200));
      expect((await upload([asFile(truncated)])).json()).toEqual({ frameCount: 5 });
    });

    it('counts the complete frames in the first 100,000 bytes of the sample', async () => {
      const response = await upload([asFile(sample.subarray(0, 100_000))]);
      expect(response.json()).toEqual({ frameCount: 442 });
    });
  });

  describe('bad requests (400)', () => {
    it('rejects a request with no body', async () => {
      const response = await app.inject({ method: 'POST', url: '/file-upload' });
      expectError(response, 400, 'INVALID_UPLOAD');
    });

    it('rejects a JSON body', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/file-upload',
        payload: { file: 'not really' },
      });
      expectError(response, 400, 'INVALID_UPLOAD');
    });

    it('rejects a malformed multipart body', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/file-upload',
        headers: { 'content-type': 'multipart/form-data; boundary=xyz' },
        payload:
          '--xyz\r\nContent-Disposition: form-data; name="file"; filename="a.mp3"\r\n\r\nabc',
      });
      expectError(response, 400, 'INVALID_UPLOAD');
    });

    it('rejects a form without a file', async () => {
      const response = await upload([{ field: 'file', content: 'just text' }]);
      expectError(response, 400, 'NO_FILE');
    });

    it('rejects a file sent under the wrong field name, naming the field', async () => {
      const response = await upload([{ field: 'audio', content: sample, filename: 'a.mp3' }]);
      const body = expectError(response, 400, 'WRONG_FIELD');
      expect(body.error.message).toContain('"audio"');
    });

    it('rejects an empty file', async () => {
      expectError(await upload([asFile(new Uint8Array(0))]), 400, 'EMPTY_FILE');
    });
  });

  describe('not an MP3 (415)', () => {
    it.each([
      { name: 'a text file', content: 'hello, this is not audio\n' },
      {
        name: 'a PNG image',
        content: concatBytes(
          Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
          new Uint8Array(2000),
        ),
      },
    ])('rejects $name', async ({ content }) => {
      expectError(await upload([asFile(content)]), 415, 'NOT_AN_MP3');
    });
  });

  describe('unsupported MPEG formats (422)', () => {
    it.each([
      { versionBits: 0b10, layerBits: 0b01, expected: 'MPEG-2 Layer III' },
      { versionBits: 0b11, layerBits: 0b10, expected: 'MPEG-1 Layer II' },
    ])('rejects $expected and says which format it found', async (format) => {
      const file = repeat(buildUnsupportedFrame(format), 20);
      const body = expectError(await upload([asFile(file)]), 422, 'UNSUPPORTED_MPEG_FORMAT');
      expect(body.error.message).toContain(format.expected);
    });
  });

  describe('routing', () => {
    it.each(['GET', 'PUT', 'PATCH', 'DELETE'] as const)(
      'answers %s with 405 and an Allow header',
      async (method) => {
        const response = await app.inject({ method, url: '/file-upload' });
        expectError(response, 405, 'METHOD_NOT_ALLOWED');
        expect(response.headers.allow).toBe('POST');
      },
    );

    it.each(['GET', 'POST'] as const)('answers %s on an unknown route with 404', async (method) => {
      const response = await app.inject({ method, url: '/no-such-route' });
      expectError(response, 404, 'NOT_FOUND');
    });
  });
});

describe('file size limit (413)', () => {
  const limit = 10 * frame.length; // exactly 10 frames
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp({ ...DEFAULT_CONFIG, maxFileSizeBytes: limit }, { logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const send = async (file: Uint8Array) =>
    app.inject({
      method: 'POST',
      url: '/file-upload',
      ...(await multipart([{ field: 'file', content: file, filename: 'a.mp3' }])),
    });

  it('accepts a file of exactly the limit', async () => {
    const response = await send(repeat(frame, 10));
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ frameCount: 10 });
  });

  it('rejects a file one frame over the limit', async () => {
    const body = expectError(await send(repeat(frame, 11)), 413, 'FILE_TOO_LARGE');
    expect(body.error.message).toContain('4,170 bytes');
  });

  it('rejects the sample file, which is far over the limit', async () => {
    expectError(await send(sample), 413, 'FILE_TOO_LARGE');
  });
});

describe('unexpected errors (500)', () => {
  it('returns a generic message and leaks no internal details', async () => {
    const app = buildApp(DEFAULT_CONFIG, { logger: false });
    app.get('/boom', () => {
      throw new Error('secret details from deep inside the server');
    });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/boom' });
    await app.close();

    expectError(response, 500, 'INTERNAL_ERROR');
    expect(response.body).not.toContain('secret');
    expect(response.body).not.toContain('at '); // no stack trace lines
  });
});
