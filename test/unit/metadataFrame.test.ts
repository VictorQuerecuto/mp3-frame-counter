import { describe, expect, it } from 'vitest';
import { parseFrameHeader } from '../../src/mp3/frameHeader.js';
import { detectMetadataFrame } from '../../src/mp3/metadataFrame.js';
import type { FrameHeader } from '../../src/mp3/types.js';
import { buildFrame, buildMetadataFrame, type HeaderOptions } from '../helpers/mp3Builder.js';

function detect(frame: Uint8Array) {
  const result = parseFrameHeader(frame);
  if (!result.ok) throw new Error('test frame has an invalid header');
  return detectMetadataFrame(frame, 0, result.header);
}

describe('detectMetadataFrame', () => {
  it.each([
    { name: 'stereo', options: { channelModeBits: 0b00 }, offset: 36 },
    { name: 'joint stereo', options: { channelModeBits: 0b01 }, offset: 36 },
    { name: 'dual channel', options: { channelModeBits: 0b10 }, offset: 36 },
    { name: 'mono', options: { channelModeBits: 0b11 }, offset: 21 },
    { name: 'stereo with CRC', options: { channelModeBits: 0b00, hasCrc: true }, offset: 38 },
    { name: 'mono with CRC', options: { channelModeBits: 0b11, hasCrc: true }, offset: 23 },
  ] satisfies { name: string; options: HeaderOptions; offset: number }[])(
    'finds "Xing" at byte $offset in a $name frame',
    ({ options, offset }) => {
      const frame = buildMetadataFrame('Xing', options);
      expect(String.fromCharCode(...frame.subarray(offset, offset + 4))).toBe('Xing');
      expect(detect(frame)).toBe('Xing');
    },
  );

  it('recognises "Info", the tag LAME writes for constant-bitrate files', () => {
    expect(detect(buildMetadataFrame('Info'))).toBe('Info');
  });

  it.each([
    { name: 'stereo', options: { channelModeBits: 0b00 } },
    { name: 'mono', options: { channelModeBits: 0b11 } },
  ])('finds "VBRI" at byte 36 in a $name frame', ({ options }) => {
    expect(detect(buildMetadataFrame('VBRI', options))).toBe('VBRI');
  });

  it('returns null for an ordinary audio frame', () => {
    expect(detect(buildFrame())).toBeNull();
  });

  it('ignores "Xing" written at the wrong offset for the channel mode', () => {
    // A mono-position tag inside a stereo frame is not a Xing header.
    const frame = buildFrame({ channelModeBits: 0b00 });
    frame.set(
      Uint8Array.from('Xing', (c) => c.charCodeAt(0)),
      21,
    );
    expect(detect(frame)).toBeNull();
  });

  it('returns null rather than reading past the end of the available bytes', () => {
    const frame = buildMetadataFrame('Xing');
    const header = (parseFrameHeader(frame) as { ok: true; header: FrameHeader }).header;
    expect(detectMetadataFrame(frame.subarray(0, 30), 0, header)).toBeNull();
  });
});
