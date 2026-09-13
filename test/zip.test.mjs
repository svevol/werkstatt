import test from 'node:test';
import assert from 'node:assert/strict';

import { crc32, zipStore } from '../src/renderer/js/zip.js';

test('crc32 matches the standard check value', () => {
  const bytes = new TextEncoder().encode('123456789');
  assert.equal(crc32(bytes), 0xcbf43926);
});

test('zipStore produces a valid STORE zip structure', async () => {
  const blob = zipStore([
    { name: 'index.html', data: '<h1>hi</h1>' },
    { name: 'styles.css', data: '.a{color:red}' },
  ]);
  assert.equal(blob.type, 'application/zip');
  const buf = new Uint8Array(await blob.arrayBuffer());

  // Local file header magic
  assert.equal(buf[0], 0x50); // P
  assert.equal(buf[1], 0x4b); // K
  assert.equal(buf[2], 0x03);
  assert.equal(buf[3], 0x04);

  const text = new TextDecoder().decode(buf);
  assert.ok(text.includes('index.html'));
  assert.ok(text.includes('<h1>hi</h1>'));
  assert.ok(text.includes('styles.css'));

  // End of central directory record present
  const eocd = [0x50, 0x4b, 0x05, 0x06];
  let found = false;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (eocd.every((b, j) => buf[i + j] === b)) { found = true; break; }
  }
  assert.ok(found, 'EOCD signature missing');
});

test('zipStore accepts Uint8Array data too', async () => {
  const data = new TextEncoder().encode('binary-ish');
  const blob = zipStore([{ name: 'file.bin', data }]);
  const text = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));
  assert.ok(text.includes('file.bin'));
});
