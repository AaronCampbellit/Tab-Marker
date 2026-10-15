import { describe, expect, it } from 'vitest';
import { helperSetupArchive, HELPER_LAUNCHER_NAME, HELPER_SCRIPT_NAME, HELPER_SETUP_NAME, storedZip } from '../../src/shared/helper-setup';

const encoder = new TextEncoder(), decoder = new TextDecoder();
function entries(zip: Uint8Array) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let offset = 0;
  const files: { name: string; text: string; crc: number }[] = [];
  while (view.getUint32(offset, true) === 0x04034b50) {
    const length = view.getUint32(offset + 18, true), nameLength = view.getUint16(offset + 26, true), extra = view.getUint16(offset + 28, true);
    const start = offset + 30 + nameLength + extra;
    files.push({ name: decoder.decode(zip.subarray(offset + 30, offset + 30 + nameLength)), text: decoder.decode(zip.subarray(start, start + length)), crc: view.getUint32(offset + 14, true) });
    offset = start + length;
  }
  expect(view.getUint32(offset, true)).toBe(0x02014b50);
  expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50);
  return files;
}
describe('helper setup ZIP', () => {
  it('keeps real .cmd and .ps1 filenames and personalizes the current ID', () => {
    const zip = helperSetupArchive("$id='__TABMARKER_EXTENSION_ID__'", '@echo off\necho Ready\n', 'a'.repeat(32));
    expect(HELPER_SETUP_NAME).toBe('TabMarker-Helper-Setup.zip');
    const files = entries(zip);
    expect(files.map(file => file.name)).toEqual([HELPER_LAUNCHER_NAME, HELPER_SCRIPT_NAME]);
    expect(files[0].text).toBe('@echo off\r\necho Ready\r\n');
    expect(files[1].text).toBe(`$id='${'a'.repeat(32)}'`);
    expect(files.some(file => file.name.endsWith('.txt'))).toBe(false);
  });
  it('uses the standard CRC-32 check value and preserves UTF-8 data', () => {
    expect(entries(storedZip([{ name: 'check.txt', data: encoder.encode('123456789') }]))[0].crc).toBe(0xcbf43926);
    expect(entries(storedZip([{ name: 'script.ps1', data: encoder.encode('café ✓') }]))[0].text).toBe('café ✓');
  });
  it.each(['../escape.cmd', 'folder/script.ps1', 'folder\\script.ps1', 'name.', 'name '])('refuses unsafe archive name %s', name => {
    expect(() => storedZip([{ name, data: encoder.encode('test') }])).toThrow();
  });
  it('refuses duplicate Windows filenames and oversized archives', () => {
    expect(() => storedZip([{ name: 'Setup.cmd', data: new Uint8Array() }, { name: 'setup.cmd', data: new Uint8Array() }])).toThrow();
    expect(() => storedZip([{ name: 'Setup.ps1', data: new Uint8Array(4_194_305) }])).toThrow();
  });
});
