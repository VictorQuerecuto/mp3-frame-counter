// Builds synthetic MP3 bytes for tests, so tests don't depend on a real file.

import { parseFrameHeader } from '../../src/mp3/frameHeader.js';

/**
 * Defaults produce a valid MPEG-1 Layer III, 128 kbps, 44.1 kHz, joint-stereo header.
 * Fields take raw bit values so tests can also build invalid or unsupported headers.
 */
export interface HeaderOptions {
  versionBits?: number;
  layerBits?: number;
  hasCrc?: boolean;
  bitrateIndex?: number;
  sampleRateIndex?: number;
  padding?: boolean;
  channelModeBits?: number;
}

export function buildHeader(options: HeaderOptions = {}): Uint8Array {
  const {
    versionBits = 0b11, // MPEG-1
    layerBits = 0b01, // Layer III
    hasCrc = false,
    bitrateIndex = 9, // 128 kbps
    sampleRateIndex = 0, // 44100 Hz
    padding = false,
    channelModeBits = 0b01, // joint stereo
  } = options;

  return Uint8Array.of(
    0xff,
    0xe0 | (versionBits << 3) | (layerBits << 1) | (hasCrc ? 0 : 1),
    (bitrateIndex << 4) | (sampleRateIndex << 2) | (padding ? 0b10 : 0),
    channelModeBits << 6,
  );
}

export interface Id3v2Options {
  /** Size of the tag body (frames + padding), excluding the 10-byte header and footer. */
  bodySize?: number;
  majorVersion?: number;
  hasFooter?: boolean;
}

/** A complete ID3v2 tag: header, zero-filled body, and optional footer. */
export function buildId3v2Tag(options: Id3v2Options = {}): Uint8Array {
  const { bodySize = 0, majorVersion = 4, hasFooter = false } = options;
  const flags = hasFooter ? 0x10 : 0;
  const size = encodeSynchsafe(bodySize);
  const header = [0x49, 0x44, 0x33, majorVersion, 0, flags, ...size]; // "ID3"
  const footer = hasFooter ? [0x33, 0x44, 0x49, majorVersion, 0, flags, ...size] : []; // "3DI"
  return Uint8Array.from([...header, ...new Array<number>(bodySize).fill(0), ...footer]);
}

export function encodeSynchsafe(value: number): number[] {
  return [(value >> 21) & 0x7f, (value >> 14) & 0x7f, (value >> 7) & 0x7f, value & 0x7f];
}

/** A whole MPEG-1 Layer III frame: a valid header followed by a zero-filled body. */
export function buildFrame(options: HeaderOptions = {}): Uint8Array {
  const header = buildHeader(options);
  const result = parseFrameHeader(header);
  if (!result.ok) throw new Error(`buildFrame needs a valid header: ${JSON.stringify(result)}`);
  const frame = new Uint8Array(result.header.frameLength);
  frame.set(header);
  return frame;
}

/**
 * A frame with an unsupported version/layer. Its body length is irrelevant to the counter
 * (it never hops on these), so a fixed size keeps the helper independent of other tables.
 */
export function buildUnsupportedFrame(options: HeaderOptions, size = 300): Uint8Array {
  const frame = new Uint8Array(size);
  frame.set(buildHeader(options));
  return frame;
}

/** A 128-byte ID3v1 tag. Its fields contain header-like bytes, to prove they aren't counted. */
export function buildId3v1Tag(): Uint8Array {
  const tag = new Uint8Array(128);
  tag.set([0x54, 0x41, 0x47]); // "TAG"
  for (let i = 3; i + 4 <= 128; i += 30) tag.set(buildHeader(), i);
  return tag;
}

/** An APEv2 tag, starting with its "APETAGEX" header and containing header-like bytes. */
export function buildApeTag(size = 96): Uint8Array {
  const tag = new Uint8Array(size);
  tag.set([0x41, 0x50, 0x45, 0x54, 0x41, 0x47, 0x45, 0x58]); // "APETAGEX"
  tag.set(buildHeader(), 40);
  return tag;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function repeat(bytes: Uint8Array, times: number): Uint8Array {
  return concatBytes(...Array.from({ length: times }, () => bytes));
}
