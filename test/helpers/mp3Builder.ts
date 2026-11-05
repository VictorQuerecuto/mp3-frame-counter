// Builds synthetic MP3 bytes for tests, so tests don't depend on a real file.

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
