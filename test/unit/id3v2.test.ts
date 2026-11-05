import { describe, expect, it } from 'vitest';
import { decodeSynchsafe, id3v2TagSize } from '../../src/mp3/id3v2.js';
import { buildHeader, buildId3v2Tag } from '../helpers/mp3Builder.js';

describe('decodeSynchsafe', () => {
  it.each([
    { hex: '00000000', expected: 0 },
    { hex: '00000022', expected: 34 },
    { hex: '0000007f', expected: 127 }, // largest value that fits in one 7-bit byte
    { hex: '00000100', expected: 128 }, // 128 carries into the next byte
    { hex: '0000017f', expected: 255 },
    { hex: '7f7f7f7f', expected: 2 ** 28 - 1 }, // 28 usable bits: max ~256 MB
  ])('decodes 0x$hex to $expected', ({ hex, expected }) => {
    expect(decodeSynchsafe(parseInt(hex, 16))).toBe(expected);
  });

  it.each(['00000080', '00008000', '00800000', '80000000'])(
    'rejects 0x%s because a top bit is set',
    (hex) => {
      expect(decodeSynchsafe(parseInt(hex, 16))).toBeNull();
    },
  );
});

describe('id3v2TagSize', () => {
  it('reads the tag at the start of the sample fixture as 44 bytes', () => {
    // First 10 bytes of test/fixtures/sample.mp3: "ID3", v2.4.0, no flags, size 34.
    const header = Uint8Array.of(0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x22);
    expect(id3v2TagSize(header)).toBe(44);
  });

  it('includes header and body in the size', () => {
    const tag = buildId3v2Tag({ bodySize: 1000 });
    expect(id3v2TagSize(tag)).toBe(1010);
    expect(id3v2TagSize(tag)).toBe(tag.length);
  });

  it('adds 10 bytes for the footer on ID3v2.4', () => {
    const tag = buildId3v2Tag({ bodySize: 100, hasFooter: true });
    expect(id3v2TagSize(tag)).toBe(120);
    expect(id3v2TagSize(tag)).toBe(tag.length);
  });

  it('ignores the footer flag before ID3v2.4, where it was undefined', () => {
    const tag = buildId3v2Tag({ bodySize: 100, majorVersion: 3 });
    tag[5] = 0x10;
    expect(id3v2TagSize(tag)).toBe(110);
  });

  it('returns null when the bytes do not start with "ID3"', () => {
    const notATag = Uint8Array.of(...buildHeader(), 0, 0, 0, 0, 0, 0);
    expect(id3v2TagSize(notATag)).toBeNull();
  });

  it('returns null when the size is not a valid synchsafe integer', () => {
    const tag = buildId3v2Tag({ bodySize: 10 });
    tag[9] = 0x80;
    expect(id3v2TagSize(tag)).toBeNull();
  });

  it('returns null when the version byte is 0xFF', () => {
    const tag = buildId3v2Tag({ majorVersion: 0xff });
    expect(id3v2TagSize(tag)).toBeNull();
  });

  it('reads a tag at a non-zero offset', () => {
    const bytes = Uint8Array.of(0, 0, 0, ...buildId3v2Tag({ bodySize: 5 }));
    expect(id3v2TagSize(bytes, 3)).toBe(15);
  });

  it('reads relative to the view, not the underlying buffer', () => {
    // Node often hands out Uint8Array views into a larger pooled ArrayBuffer.
    const backing = Uint8Array.of(0xaa, 0xaa, ...buildId3v2Tag({ bodySize: 5 }));
    const view = backing.subarray(2);
    expect(id3v2TagSize(view)).toBe(15);
  });

  it('throws a RangeError when fewer than 10 bytes are available', () => {
    expect(() => id3v2TagSize(Uint8Array.of(0x49, 0x44, 0x33))).toThrow(RangeError);
    // A short view into a longer buffer must still throw, not read past the view.
    const backing = buildId3v2Tag({ bodySize: 20 });
    expect(() => id3v2TagSize(backing.subarray(0, 9))).toThrow(RangeError);
  });
});
