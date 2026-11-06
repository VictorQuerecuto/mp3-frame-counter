import { expect } from 'vitest';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import type { ErrorBody, ErrorCode } from '../../src/http/errors.js';

export interface FormPart {
  field: string;
  /** Sent as a file when a filename is given, otherwise as a plain text field. */
  content: Uint8Array | string;
  filename?: string;
}

/**
 * Encodes parts as a multipart/form-data body, the way `curl -F` would, using the built-in
 * FormData and Response classes (no extra packages).
 */
export async function multipart(
  parts: FormPart[],
): Promise<Pick<InjectOptions, 'payload' | 'headers'>> {
  const form = new FormData();
  for (const { field, content, filename } of parts) {
    if (filename === undefined) {
      form.append(field, typeof content === 'string' ? content : new TextDecoder().decode(content));
    } else {
      const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
      form.append(field, new Blob([new Uint8Array(bytes)]), filename);
    }
  }
  const encoded = new Response(form);
  return {
    payload: Buffer.from(await encoded.arrayBuffer()),
    headers: { 'content-type': encoded.headers.get('content-type') ?? '' },
  };
}

/** Asserts the response is our standard JSON error with the given status and code. */
export function expectError(
  response: LightMyRequestResponse,
  statusCode: number,
  code: ErrorCode,
): ErrorBody {
  expect(response.statusCode).toBe(statusCode);
  expect(response.headers['content-type']).toMatch(/^application\/json/);
  const body = response.json<ErrorBody>();
  expect(body).toEqual({ error: { code, message: expect.any(String) as string } });
  return body;
}
