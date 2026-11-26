import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const size = 256;
const raw = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y++)
  for (let x = 0; x < size; x++) {
    const dx = x / 2 - 63.5,
      dy = y / 2 - 63.5;
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    const cornerX = Math.max(Math.abs(dx) - 40, 0),
      cornerY = Math.max(Math.abs(dy) - 40, 0);
    const inside = cornerX * cornerX + cornerY * cornerY < 24 * 24;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const arc = distance >= 34 && distance <= 43 && (dx < 20 || Math.abs(dy) > 25);
    const cross =
      (Math.abs(dy) < 4 && dx > -26 && dx < 31) || (Math.abs(dx) < 4 && Math.abs(dy) < 25);
    raw[offset] = arc || cross ? 215 : 30;
    raw[offset + 1] = arc || cross ? 165 : 31;
    raw[offset + 2] = arc || cross ? 129 : 32;
    raw[offset + 3] = inside ? 255 : 0;
  }
function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type),
    length = Buffer.alloc(4),
    checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(size, 0);
header.writeUInt32BE(size, 4);
header[8] = 8;
header[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);
mkdirSync('assets', { recursive: true });
writeFileSync('assets/icon.png', png);
const icoHeader = Buffer.alloc(22);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(1, 4);
icoHeader.writeUInt16LE(1, 10);
icoHeader.writeUInt16LE(32, 12);
icoHeader.writeUInt32LE(png.length, 14);
icoHeader.writeUInt32LE(22, 18);
writeFileSync('assets/icon.ico', Buffer.concat([icoHeader, png]));
