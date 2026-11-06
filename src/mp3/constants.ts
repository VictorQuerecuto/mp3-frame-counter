import type { ChannelMode, MpegLayer, MpegVersion } from './types.js';

export const FRAME_HEADER_SIZE = 4;

/**
 * Whether a Xing/Info/VBRI metadata frame at the start of the stream counts as a frame.
 * It is a valid MPEG frame, but it holds encoder metadata, not audio.
 *
 * false matches mediainfo: for test/fixtures/sample.mp3 it reports 6089 frames, while the file
 * physically holds 6090 (the extra one is the Xing frame). 6089 is also the frame count LAME
 * itself stored inside that Xing frame. Override per counter with { countMetadataFrame }.
 */
export const COUNT_METADATA_FRAME = false;

/** Every MPEG-1 Layer III frame carries 1152 samples per channel. */
export const SAMPLES_PER_FRAME = 1152;

/**
 * Bytes per frame = (SAMPLES_PER_FRAME / 8 bits-per-byte) * bitrate / sampleRate.
 * 1152 / 8 = 144, hence the well-known "144 * bitrate / sampleRate".
 */
export const FRAME_LENGTH_FACTOR = SAMPLES_PER_FRAME / 8;

/**
 * MPEG-1 Layer III bitrates in kbps, indexed by the 4-bit bitrate field.
 * Index 0 is "free format" (bitrate not stated, so the frame length can't be
 * computed) and index 15 is forbidden. Both are treated as invalid.
 */
// prettier-ignore
export const BITRATES_KBPS = [
// 0     1   2   3   4   5   6   7   8    9    10   11   12   13   14   15
  null, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, null,
] as const;

/** MPEG-1 sample rates in Hz, indexed by the 2-bit sample-rate field. Index 3 is reserved. */
export const SAMPLE_RATES_HZ = [44100, 48000, 32000, null] as const;

/** Indexed by the 2-bit version field. 0b01 is reserved. */
export const VERSIONS = [
  'MPEG-2.5',
  null,
  'MPEG-2',
  'MPEG-1',
] as const satisfies readonly (MpegVersion | null)[];

/** Indexed by the 2-bit layer field. Note the inverted encoding: 0b01 is Layer III. 0b00 is reserved. */
export const LAYERS = [
  null,
  'Layer III',
  'Layer II',
  'Layer I',
] as const satisfies readonly (MpegLayer | null)[];

/** Indexed by the 2-bit channel-mode field. */
export const CHANNEL_MODES = [
  'stereo',
  'joint-stereo',
  'dual-channel',
  'mono',
] as const satisfies readonly ChannelMode[];
