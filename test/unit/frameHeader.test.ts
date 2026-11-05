import { describe, expect, it } from 'vitest';
import { computeFrameLength, parseFrameHeader } from '../../src/mp3/frameHeader.js';
import type { FrameHeader, HeaderParseResult, HeaderRejection } from '../../src/mp3/types.js';
import { buildHeader } from '../helpers/mp3Builder.js';

function expectHeader(result: HeaderParseResult): FrameHeader {
  if (!result.ok)
    throw new Error(`Expected a valid header, got ${JSON.stringify(result.rejection)}`);
  return result.header;
}

function expectRejection(result: HeaderParseResult): HeaderRejection {
  if (result.ok) throw new Error(`Expected a rejection, got ${JSON.stringify(result.header)}`);
  return result.rejection;
}

describe('parseFrameHeader', () => {
  describe('valid MPEG-1 Layer III headers', () => {
    it('decodes a real-world header (FF FB 90 64)', () => {
      const header = expectHeader(parseFrameHeader(Uint8Array.of(0xff, 0xfb, 0x90, 0x64)));

      expect(header).toEqual({
        bitrate: 128_000,
        sampleRate: 44_100,
        padding: false,
        hasCrc: false,
        channelMode: 'joint-stereo',
        frameLength: 417,
      });
    });

    it('adds one byte to the frame length when the padding bit is set', () => {
      const header = expectHeader(parseFrameHeader(buildHeader({ padding: true })));

      expect(header.padding).toBe(true);
      expect(header.frameLength).toBe(418);
    });

    it('reports a CRC when the protection bit is 0', () => {
      expect(expectHeader(parseFrameHeader(buildHeader({ hasCrc: true }))).hasCrc).toBe(true);
      expect(expectHeader(parseFrameHeader(buildHeader({ hasCrc: false }))).hasCrc).toBe(false);
    });

    // Expected values are written out from the spec, not imported from the code under test.
    it.each([
      { index: 1, kbps: 32 },
      { index: 2, kbps: 40 },
      { index: 3, kbps: 48 },
      { index: 4, kbps: 56 },
      { index: 5, kbps: 64 },
      { index: 6, kbps: 80 },
      { index: 7, kbps: 96 },
      { index: 8, kbps: 112 },
      { index: 9, kbps: 128 },
      { index: 10, kbps: 160 },
      { index: 11, kbps: 192 },
      { index: 12, kbps: 224 },
      { index: 13, kbps: 256 },
      { index: 14, kbps: 320 },
    ])('maps bitrate index $index to $kbps kbps', ({ index, kbps }) => {
      const header = expectHeader(parseFrameHeader(buildHeader({ bitrateIndex: index })));
      expect(header.bitrate).toBe(kbps * 1000);
    });

    it.each([
      { index: 0, hz: 44_100 },
      { index: 1, hz: 48_000 },
      { index: 2, hz: 32_000 },
    ])('maps sample-rate index $index to $hz Hz', ({ index, hz }) => {
      const header = expectHeader(parseFrameHeader(buildHeader({ sampleRateIndex: index })));
      expect(header.sampleRate).toBe(hz);
    });

    it.each([
      { bits: 0b00, mode: 'stereo' },
      { bits: 0b01, mode: 'joint-stereo' },
      { bits: 0b10, mode: 'dual-channel' },
      { bits: 0b11, mode: 'mono' },
    ])('maps channel-mode bits $bits to $mode', ({ bits, mode }) => {
      const header = expectHeader(parseFrameHeader(buildHeader({ channelModeBits: bits })));
      expect(header.channelMode).toBe(mode);
    });

    it('reads the header at the given offset', () => {
      const bytes = Uint8Array.of(0x00, 0x00, ...buildHeader({ bitrateIndex: 14 }));
      expect(expectHeader(parseFrameHeader(bytes, 2)).bitrate).toBe(320_000);
    });
  });

  describe('rejections', () => {
    it.each([
      { name: 'all zeros', bytes: [0x00, 0x00, 0x00, 0x00] },
      { name: 'first byte not 0xFF', bytes: [0xfe, 0xfb, 0x90, 0x64] },
      { name: 'only 9 sync bits set', bytes: [0xff, 0x7b, 0x90, 0x64] },
    ])('rejects $name as no-sync', ({ bytes }) => {
      expect(expectRejection(parseFrameHeader(Uint8Array.from(bytes)))).toEqual({
        kind: 'no-sync',
      });
    });

    it.each([
      { versionBits: 0b10, layerBits: 0b01, version: 'MPEG-2', layer: 'Layer III' },
      { versionBits: 0b00, layerBits: 0b01, version: 'MPEG-2.5', layer: 'Layer III' },
      { versionBits: 0b11, layerBits: 0b10, version: 'MPEG-1', layer: 'Layer II' },
      { versionBits: 0b11, layerBits: 0b11, version: 'MPEG-1', layer: 'Layer I' },
    ])('rejects $version $layer as unsupported', ({ versionBits, layerBits, version, layer }) => {
      const rejection = expectRejection(parseFrameHeader(buildHeader({ versionBits, layerBits })));
      expect(rejection).toEqual({ kind: 'unsupported', version, layer });
    });

    it.each([
      { name: 'reserved version bits (01)', options: { versionBits: 0b01 } },
      { name: 'reserved layer bits (00)', options: { layerBits: 0b00 } },
      { name: 'free-format bitrate (index 0)', options: { bitrateIndex: 0 } },
      { name: 'forbidden bitrate (index 15)', options: { bitrateIndex: 15 } },
      { name: 'reserved sample rate (index 3)', options: { sampleRateIndex: 3 } },
    ])('rejects $name as invalid', ({ options }) => {
      expect(expectRejection(parseFrameHeader(buildHeader(options))).kind).toBe('invalid');
    });

    it('throws a RangeError when fewer than 4 bytes are available', () => {
      expect(() => parseFrameHeader(Uint8Array.of(0xff, 0xfb))).toThrow(RangeError);
      expect(() => parseFrameHeader(buildHeader(), 1)).toThrow(RangeError);
    });
  });
});

describe('computeFrameLength', () => {
  it.each([
    { bitrate: 128_000, sampleRate: 44_100, padding: false, expected: 417 }, // 417.96 floored
    { bitrate: 128_000, sampleRate: 44_100, padding: true, expected: 418 },
    { bitrate: 320_000, sampleRate: 44_100, padding: false, expected: 1044 }, // largest common frame
    { bitrate: 320_000, sampleRate: 48_000, padding: false, expected: 960 }, // divides exactly
    { bitrate: 128_000, sampleRate: 48_000, padding: false, expected: 384 },
    { bitrate: 32_000, sampleRate: 32_000, padding: false, expected: 144 }, // smallest frame
  ])(
    '$bitrate bps @ $sampleRate Hz, padding=$padding -> $expected bytes',
    ({ bitrate, sampleRate, padding, expected }) => {
      expect(computeFrameLength(bitrate, sampleRate, padding)).toBe(expected);
    },
  );
});
