import { FRAME_HEADER_SIZE } from './constants.js';
import type { FrameHeader } from './types.js';

/**
 * Encoder metadata frames: a valid MPEG frame at the start of the stream whose payload is a
 * summary of the file (frame count, seek table, ...) instead of audio.
 *   Xing: written by LAME/Xing for VBR files. Info: same layout, written by LAME for CBR files.
 *   VBRI: written by the Fraunhofer encoder.
 */
export type MetadataFrameKind = 'Xing' | 'Info' | 'VBRI';

const CRC_SIZE = 2;

// "Side information" follows the header (and CRC) in every MPEG-1 Layer III frame. It's
// per-channel decoder data, so its size depends on the channel mode. The Xing/Info tag is
// written right after it, where audio data would otherwise start.
const SIDE_INFO_SIZE_MONO = 17;
const SIDE_INFO_SIZE_STEREO = 32;

/** VBRI is always 32 bytes after the end of the 4-byte header, whatever the channel mode. */
const VBRI_OFFSET = FRAME_HEADER_SIZE + 32;

/**
 * Checks whether the frame starting at `offset` is a Xing, Info or VBRI metadata frame.
 * Only meaningful for the first frame of a stream: later frames hold audio, where these bytes
 * could appear by chance.
 */
export function detectMetadataFrame(
  bytes: Uint8Array,
  offset: number,
  header: FrameHeader,
): MetadataFrameKind | null {
  const sideInfoSize = header.channelMode === 'mono' ? SIDE_INFO_SIZE_MONO : SIDE_INFO_SIZE_STEREO;
  const xingOffset = offset + FRAME_HEADER_SIZE + (header.hasCrc ? CRC_SIZE : 0) + sideInfoSize;

  const xingTag = readTag(bytes, xingOffset);
  if (xingTag === 'Xing' || xingTag === 'Info') return xingTag;
  if (readTag(bytes, offset + VBRI_OFFSET) === 'VBRI') return 'VBRI';
  return null;
}

/** Reads 4 bytes as ASCII text, or returns null if they aren't all available. */
function readTag(bytes: Uint8Array, offset: number): string | null {
  if (offset + 4 > bytes.length) return null;
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}
