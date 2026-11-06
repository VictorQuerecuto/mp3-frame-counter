// Public API of the MP3 module. It has no HTTP dependencies and can be used on its own.
export { COUNT_METADATA_FRAME } from './constants.js';
export {
  countFrames,
  FrameCounter,
  type FrameCounterOptions,
  type FrameCountResult,
} from './frameCounter.js';
export type { MetadataFrameKind } from './metadataFrame.js';
export type { ChannelMode, FrameHeader, MpegLayer, MpegVersion } from './types.js';
