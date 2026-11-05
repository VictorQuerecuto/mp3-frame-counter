export type MpegVersion = 'MPEG-1' | 'MPEG-2' | 'MPEG-2.5';

export type MpegLayer = 'Layer I' | 'Layer II' | 'Layer III';

export type ChannelMode = 'stereo' | 'joint-stereo' | 'dual-channel' | 'mono';

/** A decoded MPEG-1 Layer III frame header (the only format this service supports). */
export interface FrameHeader {
  /** Bits per second, e.g. 128000. */
  readonly bitrate: number;
  /** Samples per second, e.g. 44100. */
  readonly sampleRate: number;
  readonly padding: boolean;
  /** True when a 16-bit CRC follows the 4-byte header. */
  readonly hasCrc: boolean;
  readonly channelMode: ChannelMode;
  /** Total frame size in bytes, including the 4-byte header. */
  readonly frameLength: number;
}

/** Why 4 bytes could not be used as an MPEG-1 Layer III frame header. */
export type HeaderRejection =
  /** The 11 sync bits are not all set: these bytes are not a frame header. */
  | { readonly kind: 'no-sync' }
  /** Sync is present, but a field holds a reserved or forbidden value. */
  | { readonly kind: 'invalid'; readonly detail: string }
  /** A well-formed MPEG audio header of a version/layer this service does not support. */
  | { readonly kind: 'unsupported'; readonly version: MpegVersion; readonly layer: MpegLayer };

export type HeaderParseResult =
  | { readonly ok: true; readonly header: FrameHeader }
  | { readonly ok: false; readonly rejection: HeaderRejection };
