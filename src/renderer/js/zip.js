// Minimal STORE-only ZIP writer (no compression, no deps) for text exports.

function crc32(bytes) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const push = (u8) => { chunks.push(u8); offset += u8.length; };
  const u16 = (n) => push(new Uint8Array([n & 0xff, (n >> 8) & 0xff]));
  const u32 = (n) => push(new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]));
  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const localOff = offset;
    u32(0x04034b50); u16(20); u16(0x0800); u16(0); u16(0); u16(0);
    u32(crc); u32(data.length); u32(data.length); u16(nameBytes.length); u16(0);
    push(nameBytes); push(data);
    central.push({ nameBytes, crc, size: data.length, localOff });
  }
  const cdStart = offset;
  let cdSize = 0;
  const cpush = (arr) => { chunks.push(arr); offset += arr.length; cdSize += arr.length; };
  const cu16 = (n) => cpush(new Uint8Array([n & 0xff, (n >> 8) & 0xff]));
  const cu32 = (n) => cpush(new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]));
  for (const c of central) {
    cu32(0x02014b50); cu16(20); cu16(20); cu16(0x0800); cu16(0); cu16(0); cu16(0);
    cu32(c.crc); cu32(c.size); cu32(c.size); cu16(c.nameBytes.length);
    cu16(0); cu16(0); cu16(0); cu16(0); cu32(0); cu32(c.localOff);
    cpush(c.nameBytes);
  }
  const end = new Uint8Array(22);
  const dv = new DataView(end.buffer);
  dv.setUint32(0, 0x06054b50, true);
  dv.setUint16(8, central.length, true);
  dv.setUint16(10, central.length, true);
  dv.setUint32(12, cdSize, true);
  dv.setUint32(16, cdStart, true);
  chunks.push(end);
  return new Blob(chunks, { type: 'application/zip' });
}

export { crc32, zipStore };
