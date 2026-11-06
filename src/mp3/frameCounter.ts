import { FRAME_HEADER_SIZE } from './constants.js';
import { parseFrameHeader } from './frameHeader.js';
import { ID3V2_HEADER_SIZE, id3v2TagSize } from './id3v2.js';
import type { MpegLayer, MpegVersion } from './types.js';

/**
 * skipping-tags: at the start of the file, skipping ID3v2 tags
 * searching:     looking for a frame header we can trust (start of file, or after junk)
 * hopping:       on the trail: read a header, jump over its frame, repeat
 * done:          reached an end-of-file tag; the rest of the input is ignored
 */
type Mode = 'skipping-tags' | 'searching' | 'hopping' | 'done';

export interface FrameCountResult {
  /** Complete MPEG-1 Layer III frames found. */
  readonly frameCount: number;
  /** The first well-formed header of an unsupported MPEG version/layer, if any was seen. */
  readonly unsupportedFormat: { readonly version: MpegVersion; readonly layer: MpegLayer } | null;
}

/** Returned by a step that can't decide until more bytes arrive. */
const NEED_MORE = -1;

const TAG = ascii('TAG'); // ID3v1: always the last 128 bytes of a file
const APETAGEX = ascii('APETAGEX'); // APEv2 footer/header

/**
 * Counts MPEG-1 Layer III frames in a byte stream fed in chunks of any size.
 *
 * Memory stays constant: frame bodies and tags are never buffered, only skipped. The only bytes
 * held between chunks are a small leftover that a decision is waiting on (a header split across
 * chunks, or a candidate header plus its next-frame lookahead: at most ~1.4 KB).
 */
export class FrameCounter {
  #mode: Mode = 'skipping-tags';
  #leftover: Uint8Array = new Uint8Array(0);
  /** Bytes still to jump over (rest of a frame or tag) before looking at data again. */
  #skipRemaining = 0;
  /** True while jumping over a frame. It's only counted once the whole frame has gone past. */
  #inFrame = false;
  #frameCount = 0;
  #unsupportedFormat: FrameCountResult['unsupportedFormat'] = null;
  #finished = false;

  push(chunk: Uint8Array): void {
    if (this.#finished) throw new Error('push() called after finish()');
    if (this.#mode === 'done' || chunk.length === 0) return;
    // Only copy when there's a leftover to join; otherwise work on the chunk directly.
    const bytes = this.#leftover.length === 0 ? chunk : concat(this.#leftover, chunk);
    this.#leftover = this.#process(bytes, false);
  }

  finish(): FrameCountResult {
    if (!this.#finished) {
      this.#finished = true;
      this.#process(this.#leftover, true);
      this.#leftover = new Uint8Array(0);
      // If we're still mid-jump over a frame here, the input was truncated: that frame is
      // incomplete and deliberately not counted.
    }
    return { frameCount: this.#frameCount, unsupportedFormat: this.#unsupportedFormat };
  }

  /** Consumes as much of `bytes` as possible and returns the unconsumed tail. */
  #process(bytes: Uint8Array, isFinal: boolean): Uint8Array {
    let pos = 0;
    while (this.#mode !== 'done') {
      if (this.#skipRemaining > 0) {
        const skipped = Math.min(this.#skipRemaining, bytes.length - pos);
        pos += skipped;
        this.#skipRemaining -= skipped;
        if (this.#skipRemaining > 0) break; // jump continues into the next chunk
        if (this.#inFrame) {
          this.#frameCount++;
          this.#inFrame = false;
        }
      }
      if (pos >= bytes.length) break;

      const advance = this.#step(bytes, pos, isFinal);
      if (advance === NEED_MORE) break;
      this.#skipRemaining = advance;
    }
    return bytes.subarray(pos);
  }

  /**
   * Looks at the bytes at `pos` and decides what to do. Returns how many bytes to jump over
   * (0 when only the mode changed), or NEED_MORE when the decision needs more input.
   */
  #step(bytes: Uint8Array, pos: number, isFinal: boolean): number {
    switch (this.#mode) {
      case 'skipping-tags':
        return this.#skipTag(bytes, pos, isFinal);
      case 'searching':
        return this.#search(bytes, pos, isFinal);
      case 'hopping':
        return this.#hop(bytes, pos, isFinal);
      case 'done':
        return 0;
    }
  }

  #skipTag(bytes: Uint8Array, pos: number, isFinal: boolean): number {
    if (bytes.length - pos < ID3V2_HEADER_SIZE) {
      if (!isFinal) return NEED_MORE;
      this.#mode = 'searching';
      return 0;
    }
    const tagSize = id3v2TagSize(bytes, pos);
    if (tagSize === null) this.#mode = 'searching';
    return tagSize ?? 0; // stay in this mode after a tag: several may be stacked
  }

  #search(bytes: Uint8Array, pos: number, isFinal: boolean): number {
    // Every header starts with 0xFF, so jump straight to the next one.
    const nextFF = bytes.indexOf(0xff, pos);
    if (nextFF === -1) return bytes.length - pos;
    if (nextFF > pos) return nextFF - pos;

    const available = bytes.length - pos;
    if (available < FRAME_HEADER_SIZE) return isFinal ? available : NEED_MORE;

    const result = parseFrameHeader(bytes, pos);
    if (!result.ok) {
      if (result.rejection.kind === 'unsupported' && this.#unsupportedFormat === null) {
        const { version, layer } = result.rejection;
        this.#unsupportedFormat = { version, layer };
      }
      return 1;
    }

    // False-sync protection: 0xFFFx can occur by chance (in tag data, or inside audio after
    // junk), so only trust a candidate if the place it says the next frame starts checks out.
    const { frameLength } = result.header;
    const next = pos + frameLength;
    const confirmed = this.#confirmNextFrame(bytes, next, isFinal);
    if (confirmed === null) return NEED_MORE;
    if (!confirmed) return 1;

    this.#mode = 'hopping';
    this.#inFrame = true;
    return frameLength;
  }

  /**
   * Is there a valid header, an end-of-file tag, or the exact end of input at `pos`?
   * Returns null if that can't be known yet.
   */
  #confirmNextFrame(bytes: Uint8Array, pos: number, isFinal: boolean): boolean | null {
    const available = bytes.length - pos;
    if (available >= FRAME_HEADER_SIZE && parseFrameHeader(bytes, pos).ok) return true;
    if (available >= TAG.length && startsWith(bytes, pos, TAG)) return true;
    if (available >= APETAGEX.length && startsWith(bytes, pos, APETAGEX)) return true;
    if (isFinal) return available === 0;
    return available >= APETAGEX.length ? false : null;
  }

  #hop(bytes: Uint8Array, pos: number, isFinal: boolean): number {
    const available = bytes.length - pos;
    if (available < FRAME_HEADER_SIZE) {
      if (!isFinal) return NEED_MORE;
      this.#mode = 'done'; // a few stray bytes at the very end: nothing more to count
      return 0;
    }

    const result = parseFrameHeader(bytes, pos);
    if (result.ok) {
      this.#inFrame = true;
      return result.header.frameLength;
    }

    // Not a header. Wait until there are enough bytes to recognise any tag signature.
    if (available < ID3V2_HEADER_SIZE && !isFinal) return NEED_MORE;

    if (startsWith(bytes, pos, TAG) || startsWith(bytes, pos, APETAGEX)) {
      this.#mode = 'done';
      return 0;
    }
    if (available >= ID3V2_HEADER_SIZE) {
      const tagSize = id3v2TagSize(bytes, pos);
      if (tagSize !== null) return tagSize; // an ID3v2 tag between frames: skip it, keep hopping
    }

    // Lost the trail (corrupt or unexpected data): search for the next trustworthy header.
    this.#mode = 'searching';
    return 0;
  }
}

/** Counts frames in an async stream of chunks, e.g. a Node.js Readable or an upload stream. */
export async function countFrames(source: AsyncIterable<Uint8Array>): Promise<FrameCountResult> {
  const counter = new FrameCounter();
  for await (const chunk of source) counter.push(chunk);
  return counter.finish();
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function startsWith(bytes: Uint8Array, pos: number, signature: Uint8Array): boolean {
  if (bytes.length - pos < signature.length) return false;
  return signature.every((byte, i) => bytes[pos + i] === byte);
}

function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}
