// Helpers for feeding bytes to the counter in chunks, the way a network upload arrives.

import {
  FrameCounter,
  type FrameCounterOptions,
  type FrameCountResult,
} from '../../src/mp3/frameCounter.js';

/** Splits `bytes` into views (no copying) whose sizes come from `nextSize`. */
export function* chunksOf(bytes: Uint8Array, nextSize: () => number): Generator<Uint8Array> {
  let offset = 0;
  while (offset < bytes.length) {
    const size = Math.max(1, nextSize());
    yield bytes.subarray(offset, offset + size);
    offset += size;
  }
}

export const fixedSize = (size: number) => () => size;

/** Random chunk sizes in [1, max], from a seeded generator so failures are reproducible. */
export function randomSize(seed: number, max: number): () => number {
  const random = mulberry32(seed);
  return () => 1 + Math.floor(random() * max);
}

export function countInChunks(
  bytes: Uint8Array,
  nextSize: () => number,
  options: FrameCounterOptions = {},
): FrameCountResult {
  const counter = new FrameCounter(options);
  for (const chunk of chunksOf(bytes, nextSize)) counter.push(chunk);
  return counter.finish();
}

export function countWhole(bytes: Uint8Array, options: FrameCounterOptions = {}): FrameCountResult {
  return countInChunks(bytes, fixedSize(bytes.length), options);
}

export async function* toAsync(chunks: Iterable<Uint8Array>): AsyncGenerator<Uint8Array> {
  for (const chunk of chunks) {
    await Promise.resolve();
    yield chunk;
  }
}

/** Reproducible noise, for "random binary file" tests. */
export function randomBytes(seed: number, length: number): Uint8Array {
  const random = mulberry32(seed);
  return Uint8Array.from({ length }, () => Math.floor(random() * 256));
}

/** Tiny seeded PRNG (public-domain mulberry32). */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
