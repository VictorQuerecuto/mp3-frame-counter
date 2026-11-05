export const ID3V2_HEADER_SIZE = 10;
const ID3V2_FOOTER_SIZE = 10;
const FOOTER_PRESENT_FLAG = 0x10; // flags bit 4, defined in ID3v2.4 only

/**
 * If an ID3v2 tag starts at `offset`, returns the number of bytes to skip to get past it
 * (header + body + optional footer). Returns null if there is no valid tag there.
 *
 * Header layout (10 bytes):
 *   "ID3" | major version | revision | flags | size (4 bytes, synchsafe, excludes header/footer)
 *
 * @throws RangeError if fewer than 10 bytes are available at `offset`.
 */
export function id3v2TagSize(bytes: Uint8Array, offset = 0): number | null {
  if (bytes.length - offset < ID3V2_HEADER_SIZE) {
    throw new RangeError(
      `Need ${ID3V2_HEADER_SIZE} bytes at offset ${offset}, but buffer length is ${bytes.length}`,
    );
  }
  // bytes.byteOffset matters: Node often hands out views into a larger shared buffer.
  const header = new DataView(bytes.buffer, bytes.byteOffset + offset, ID3V2_HEADER_SIZE);

  // 0x49 0x44 0x33 are the ASCII codes for "I", "D", "3".
  const isId3 =
    header.getUint8(0) === 0x49 && header.getUint8(1) === 0x44 && header.getUint8(2) === 0x33;
  if (!isId3) return null;

  const majorVersion = header.getUint8(3);
  const revision = header.getUint8(4);
  if (majorVersion === 0xff || revision === 0xff) return null;

  const bodySize = decodeSynchsafe(header.getUint32(6));
  if (bodySize === null) return null;

  const hasFooter = majorVersion === 4 && (header.getUint8(5) & FOOTER_PRESENT_FLAG) !== 0;
  return ID3V2_HEADER_SIZE + bodySize + (hasFooter ? ID3V2_FOOTER_SIZE : 0);
}

/**
 * Decodes a 32-bit synchsafe integer: 4 bytes holding 7 bits each, with the top bit of every
 * byte always 0. ID3v2 uses this so a tag's size can never contain a false MPEG sync (0xFF...).
 * Returns null if any top bit is set, which means the value isn't synchsafe.
 */
export function decodeSynchsafe(value: number): number | null {
  if ((value & 0x80808080) !== 0) return null;
  return (
    (((value >> 24) & 0x7f) << 21) |
    (((value >> 16) & 0x7f) << 14) |
    (((value >> 8) & 0x7f) << 7) |
    (value & 0x7f)
  );
}
