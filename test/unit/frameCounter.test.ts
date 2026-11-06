import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { countFrames } from '../../src/mp3/frameCounter.js';
import { parseFrameHeader } from '../../src/mp3/frameHeader.js';
import {
  chunksOf,
  countInChunks,
  countWhole,
  fixedSize,
  randomBytes,
  randomSize,
  toAsync,
} from '../helpers/chunks.js';
import {
  buildApeTag,
  buildFrame,
  buildHeader,
  buildId3v1Tag,
  buildId3v2Tag,
  buildUnsupportedFrame,
  concatBytes,
  repeat,
} from '../helpers/mp3Builder.js';

const frame = buildFrame(); // 128 kbps, 44.1 kHz: 417 bytes

describe('FrameCounter', () => {
  describe('walking frames', () => {
    it('counts back-to-back frames', () => {
      expect(countWhole(repeat(frame, 5)).frameCount).toBe(5);
    });

    it('follows frames of different sizes (VBR and padding)', () => {
      const vbr = concatBytes(
        buildFrame({ bitrateIndex: 9 }), // 417
        buildFrame({ bitrateIndex: 14, padding: true }), // 1045
        buildFrame({ bitrateIndex: 1 }), // 104
        buildFrame({ bitrateIndex: 5, sampleRateIndex: 1 }), // 64 kbps @ 48 kHz: 192
      );
      expect(countWhole(vbr).frameCount).toBe(4);
    });

    it('counts a file containing a single frame', () => {
      expect(countWhole(frame).frameCount).toBe(1);
    });

    it('returns 0 for empty input', () => {
      expect(countWhole(new Uint8Array(0))).toEqual({ frameCount: 0, unsupportedFormat: null });
    });
  });

  describe('tags', () => {
    it('skips a leading ID3v2 tag', () => {
      const file = concatBytes(buildId3v2Tag({ bodySize: 500 }), repeat(frame, 3));
      expect(countWhole(file).frameCount).toBe(3);
    });

    it('skips several stacked ID3v2 tags, including one with a footer', () => {
      const file = concatBytes(
        buildId3v2Tag({ bodySize: 100 }),
        buildId3v2Tag({ bodySize: 50, hasFooter: true }),
        buildId3v2Tag({ bodySize: 20, majorVersion: 3 }),
        repeat(frame, 3),
      );
      expect(countWhole(file).frameCount).toBe(3);
    });

    it('jumps over tag contents instead of scanning them', () => {
      // A tag whose body is full of real-looking frames (like embedded data could be).
      const tag = buildId3v2Tag({ bodySize: 50_000 });
      tag.set(repeat(frame, 100), 10);
      const file = concatBytes(tag, repeat(frame, 3));
      expect(countWhole(file).frameCount).toBe(3);
    });

    it('skips an ID3v2 tag found between frames', () => {
      const file = concatBytes(repeat(frame, 2), buildId3v2Tag({ bodySize: 30 }), repeat(frame, 2));
      expect(countWhole(file).frameCount).toBe(4);
    });

    it('stops at an ID3v1 tag', () => {
      const file = concatBytes(repeat(frame, 3), buildId3v1Tag());
      expect(countWhole(file).frameCount).toBe(3);
    });

    it('stops at an APEv2 tag', () => {
      const file = concatBytes(repeat(frame, 3), buildApeTag(), buildId3v1Tag());
      expect(countWhole(file).frameCount).toBe(3);
    });
  });

  describe('end of input', () => {
    it('does not count a truncated final frame', () => {
      const file = concatBytes(repeat(frame, 3), frame.subarray(0, 200));
      expect(countWhole(file).frameCount).toBe(3);
    });

    it('does not count a final frame cut off inside its header', () => {
      const file = concatBytes(repeat(frame, 3), frame.subarray(0, 2));
      expect(countWhole(file).frameCount).toBe(3);
    });

    it('does not count a lone frame that is cut off', () => {
      expect(countWhole(frame.subarray(0, 400)).frameCount).toBe(0);
    });
  });

  describe('false syncs and resynchronisation', () => {
    it('ignores a header-like pattern whose next-frame position does not check out', () => {
      // The fake header claims a 104-byte frame, but byte 104 is junk, not another header.
      // Trusting it would count it as a 4th frame.
      const fakeHeader = concatBytes(
        buildHeader({ bitrateIndex: 1 }),
        new Uint8Array(200).fill(0x11),
      );
      const file = concatBytes(fakeHeader, repeat(frame, 3));
      expect(countWhole(file).frameCount).toBe(3);
    });

    it('finds the trail again after junk in the middle', () => {
      const junk = Uint8Array.of(0xff, 0x00, ...buildHeader({ bitrateIndex: 1 }), 0x3a, 0x91);
      const file = concatBytes(repeat(frame, 3), junk, repeat(frame, 3));
      expect(countWhole(file).frameCount).toBe(6);
    });

    it('finds no frames in random noise, even though it contains header-like bytes', () => {
      const noise = randomBytes(42, 1_000_000);
      let headerLookalikes = 0;
      for (let i = 0; i + 4 <= noise.length; i++) {
        if (parseFrameHeader(noise, i).ok) headerLookalikes++;
      }

      expect(headerLookalikes).toBeGreaterThan(0); // without the double-check, these would count
      expect(countWhole(noise).frameCount).toBe(0);
    });

    it('finds no frames in a non-MP3 file', () => {
      const png = concatBytes(
        Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
        new Uint8Array(1000),
      );
      expect(countWhole(png)).toEqual({ frameCount: 0, unsupportedFormat: null });
    });
  });

  describe('unsupported formats', () => {
    it.each([
      { versionBits: 0b10, layerBits: 0b01, version: 'MPEG-2', layer: 'Layer III' },
      { versionBits: 0b00, layerBits: 0b01, version: 'MPEG-2.5', layer: 'Layer III' },
      { versionBits: 0b11, layerBits: 0b10, version: 'MPEG-1', layer: 'Layer II' },
    ])('counts nothing in $version $layer and reports the format', (format) => {
      const file = repeat(buildUnsupportedFrame(format), 20);
      expect(countWhole(file)).toEqual({
        frameCount: 0,
        unsupportedFormat: { version: format.version, layer: format.layer },
      });
    });
  });

  describe('chunk boundaries', () => {
    // Tags, padding, VBR frames, a false sync in junk, a mid-stream tag, and trailing tags.
    const mixedFile = concatBytes(
      buildId3v2Tag({ bodySize: 2000 }),
      buildId3v2Tag({ bodySize: 50, hasFooter: true }),
      new Uint8Array(13),
      ...[9, 14, 1, 5, 9, 12, 9, 9, 3, 14].map((bitrateIndex, i) =>
        buildFrame({ bitrateIndex, padding: i % 3 === 0 }),
      ),
      Uint8Array.of(0xff, 0x00, ...buildHeader({ bitrateIndex: 1 }), 0x12, 0x34),
      repeat(frame, 5),
      buildId3v2Tag({ bodySize: 30 }),
      repeat(buildFrame({ bitrateIndex: 11 }), 4),
      buildApeTag(),
      buildId3v1Tag(),
    );
    const expected = 19;

    it('counts the mixed file correctly in one piece', () => {
      expect(countWhole(mixedFile).frameCount).toBe(expected);
    });

    it.each([1, 2, 3, 4, 5, 7, 10, 64, 417, 4096, 65_536])(
      'gives the same count in %i-byte chunks',
      (size) => {
        expect(countInChunks(mixedFile, fixedSize(size)).frameCount).toBe(expected);
      },
    );

    it.each([1, 2, 3, 4, 5])('gives the same count in random-size chunks (seed %i)', (seed) => {
      expect(countInChunks(mixedFile, randomSize(seed, 50)).frameCount).toBe(expected);
      expect(countInChunks(mixedFile, randomSize(seed, 5000)).frameCount).toBe(expected);
    });

    it('works with an async stream of chunks', async () => {
      const source = toAsync(chunksOf(mixedFile, randomSize(7, 300)));
      expect((await countFrames(source)).frameCount).toBe(expected);
    });
  });
});

describe('sample.mp3 fixture', () => {
  const sample = new Uint8Array(readFileSync(new URL('../fixtures/sample.mp3', import.meta.url)));
  // 6,089 audio frames + 1 Xing/Info frame. mediainfo reports 6,089: see the Xing handling.
  const physicalFrames = 6090;

  it('counts every frame in the file', () => {
    expect(countWhole(sample).frameCount).toBe(physicalFrames);
  });

  it.each([
    { name: '1-byte chunks', nextSize: fixedSize(1) },
    { name: '64 KB chunks', nextSize: fixedSize(65_536) },
    { name: 'random chunks up to 100 bytes', nextSize: randomSize(1, 100) },
    { name: 'random chunks up to 100 KB', nextSize: randomSize(2, 100_000) },
  ])('gives the same count in $name', ({ nextSize }) => {
    expect(countInChunks(sample, nextSize).frameCount).toBe(physicalFrames);
  });
});
