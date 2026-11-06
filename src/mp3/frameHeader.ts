import {
  BITRATES_KBPS,
  CHANNEL_MODES,
  FRAME_HEADER_SIZE,
  FRAME_LENGTH_FACTOR,
  LAYERS,
  SAMPLE_RATES_HZ,
  VERSIONS,
} from './constants.js';
import type { HeaderParseResult, HeaderRejection } from './types.js';

/**
 * Decodes the 4-byte frame header at `offset`.
 *
 * Header bit layout (A = most significant bit of byte 0):
 *
 *   byte 0    byte 1    byte 2    byte 3
 *   AAAAAAAA  AAABBCCD  EEEEFFGH  IIJJKLMM
 *
 *   A sync (11 bits, all set)   E bitrate index      I channel mode
 *   B version                   F sample-rate index  J mode extension
 *   C layer                     G padding            K copyright
 *   D protection (0 = has CRC)  H private            L original
 *                                                    M emphasis
 *
 * Fields J-M (and H) don't affect frame length, so they are not decoded.
 *
 * @throws RangeError if fewer than 4 bytes are available at `offset` (a caller bug,
 *   not bad input: callers must buffer enough bytes before asking).
 */
export function parseFrameHeader(bytes: Uint8Array, offset = 0): HeaderParseResult {
  const b0 = bytes[offset];
  const b1 = bytes[offset + 1];
  const b2 = bytes[offset + 2];
  const b3 = bytes[offset + 3];
  if (b0 === undefined || b1 === undefined || b2 === undefined || b3 === undefined) {
    throw new RangeError(
      `Need ${FRAME_HEADER_SIZE} bytes at offset ${offset}, but buffer length is ${bytes.length}`,
    );
  }

  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) {
    return reject({ kind: 'no-sync' });
  }

  const versionBits = (b1 >> 3) & 0b11;
  const layerBits = (b1 >> 1) & 0b11;
  const version = VERSIONS[versionBits];
  const layer = LAYERS[layerBits];
  if (version == null) return invalid(`reserved version bits ${versionBits}`);
  if (layer == null) return invalid(`reserved layer bits ${layerBits}`);

  // Bitrate index 0/15 and sample-rate index 3 are invalid in every MPEG version and layer, so
  // reject them before the version check: "unsupported" should only ever describe a well-formed
  // header (otherwise e.g. a JPEG's FF E2 marker would be reported as MPEG-2.5 audio).
  // The looked-up values themselves are only meaningful for MPEG-1 Layer III.
  const bitrateIndex = (b2 >> 4) & 0x0f;
  const bitrateKbps = BITRATES_KBPS[bitrateIndex];
  if (bitrateKbps == null) {
    return invalid(`bitrate index ${bitrateIndex} is free-format or forbidden`);
  }

  const sampleRateIndex = (b2 >> 2) & 0b11;
  const sampleRate = SAMPLE_RATES_HZ[sampleRateIndex];
  if (sampleRate == null) return invalid(`reserved sample-rate index ${sampleRateIndex}`);

  if (version !== 'MPEG-1' || layer !== 'Layer III') {
    return reject({ kind: 'unsupported', version, layer });
  }

  const channelMode = CHANNEL_MODES[(b3 >> 6) & 0b11];
  // Unreachable (a 2-bit index into a 4-entry table), but the compiler can't prove that.
  if (channelMode === undefined) return invalid('channel mode out of range');

  const bitrate = bitrateKbps * 1000;
  const padding = ((b2 >> 1) & 1) === 1;

  return {
    ok: true,
    header: {
      bitrate,
      sampleRate,
      padding,
      hasCrc: (b1 & 1) === 0,
      channelMode,
      frameLength: computeFrameLength(bitrate, sampleRate, padding),
    },
  };
}

/** Frame size in bytes (header included): floor(144 * bitrate / sampleRate) + padding. */
export function computeFrameLength(bitrate: number, sampleRate: number, padding: boolean): number {
  return Math.floor((FRAME_LENGTH_FACTOR * bitrate) / sampleRate) + (padding ? 1 : 0);
}

function reject(rejection: HeaderRejection): HeaderParseResult {
  return { ok: false, rejection };
}

function invalid(detail: string): HeaderParseResult {
  return reject({ kind: 'invalid', detail });
}
