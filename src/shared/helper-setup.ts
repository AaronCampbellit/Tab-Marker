import { personalizeInstaller } from './github-updates';

export const HELPER_SETUP_NAME = 'TabMarker-Helper-Setup.zip';
export const HELPER_LAUNCHER_NAME = 'Install TabMarker Helper.cmd';
export const HELPER_SCRIPT_NAME = 'Install-TabMarkerHelper.ps1';

// Small ZIP with stored entries: no runtime dependency, compression or executable
// generation. Names/bytes are preserved for Windows' built-in Extract All.
export function storedZip(files: { name: string; data: Uint8Array }[]): Uint8Array<ArrayBuffer> {
  if (!files.length || files.length > 10) throw new Error('Invalid setup archive.');
  const encoder = new TextEncoder(), names = new Set<string>();
  const local: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,99}$/.test(file.name) || file.name.endsWith('.') || file.name.endsWith(' ') || names.has(file.name.toLowerCase())) throw new Error('Invalid setup filename.');
    names.add(file.name.toLowerCase());
    if (file.data.length > 4_194_304 || offset + file.data.length > 4_194_304) throw new Error('Setup archive is too large.');
    const name = encoder.encode(file.name);
    let crc = 0xffffffff;
    for (const byte of file.data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const head = new Uint8Array(30 + name.length), h = new DataView(head.buffer);
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true); h.setUint16(12, 0x21, true);
    h.setUint32(14, crc, true); h.setUint32(18, file.data.length, true); h.setUint32(22, file.data.length, true); h.setUint16(26, name.length, true); head.set(name, 30);
    const record = new Uint8Array(46 + name.length), c = new DataView(record.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true); c.setUint16(14, 0x21, true);
    c.setUint32(16, crc, true); c.setUint32(20, file.data.length, true); c.setUint32(24, file.data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true); record.set(name, 46);
    local.push(head, file.data); central.push(record); offset += head.length + file.data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, centralSize, true); e.setUint32(16, offset, true);
  const archive = new Uint8Array(offset + centralSize + end.length);
  let position = 0; for (const part of [...local, ...central, end]) { archive.set(part, position); position += part.length; }
  return archive;
}
export function helperSetupArchive(template: string, launcher: string, extensionId: string): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  return storedZip([
    { name: HELPER_LAUNCHER_NAME, data: encoder.encode(launcher.replace(/\r?\n/g, '\r\n')) },
    { name: HELPER_SCRIPT_NAME, data: encoder.encode(personalizeInstaller(template, extensionId)) },
  ]);
}
