// Packs PNG images into a Windows .ico (PNG-compressed entries, supported since Vista).
const fs = require('node:fs');

/** @param {string} out  @param {Buffer[]} pngs */
function writeIco(out, pngs) {
  const images = pngs.map((data) => ({ data, width: data.readUInt32BE(16), height: data.readUInt32BE(20) })); // IHDR

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + 16 * images.length;
  const entries = images.map(({ data, width, height }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(width >= 256 ? 0 : width, 0); // 0 means 256
    entry.writeUInt8(height >= 256 ? 0 : height, 1);
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });

  fs.writeFileSync(out, Buffer.concat([header, ...entries, ...images.map((image) => image.data)]));
}

module.exports = { writeIco };
