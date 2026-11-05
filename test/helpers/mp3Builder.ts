/**
 * Builds synthetic MP3 bytes for tests, so tests don't depend on a real file.
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
