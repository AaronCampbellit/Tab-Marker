import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const root = path.resolve('work/setup-tests', randomUUID()); fs.mkdirSync(root, { recursive: true });
const version = JSON.parse(fs.readFileSync('package.json')).version;
const bundle = path.join(root, 'archive.mjs');
await build({ entryPoints: ['src/shared/helper-setup.ts'], outfile: bundle, platform: 'node', format: 'esm', bundle: true });
const { helperSetupArchive, HELPER_LAUNCHER_NAME, HELPER_SCRIPT_NAME } = await import(pathToFileURL(bundle));
const template = fs.readFileSync('dist/helper/Install-TabMarkerHelper.ps1', 'utf8');
const launcher = fs.readFileSync('dist/helper/Install TabMarker Helper.cmd', 'utf8');
const zipIndex = process.argv.indexOf('--zip');
const archive = zipIndex >= 0 ? path.resolve(process.argv[zipIndex + 1]) : path.join(root, 'TabMarker-Helper-Setup.zip');
if (zipIndex < 0) fs.writeFileSync(archive, helperSetupArchive(template, launcher, 'a'.repeat(32)));
const extracted = path.join(root, 'Extracted setup & notes!');
const quotePS = value => "'" + value.replaceAll("'", "''") + "'";
const extraction = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', `Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory(${quotePS(archive)}, ${quotePS(extracted)})`], { encoding: 'utf8', windowsHide: true });
assert.equal(extraction.status, 0, extraction.stderr);
const checks = [];
function pass(name, fn) { fn(); checks.push(name); console.log(`PASS ${name}`); }
pass('Windows ZIP extraction preserves exactly the .cmd and .ps1 filenames', () => assert.deepEqual(fs.readdirSync(extracted).sort(), [HELPER_LAUNCHER_NAME, HELPER_SCRIPT_NAME].sort()));
pass('extracted script is personalized for this extension and has no .txt suffix', () => assert.equal(fs.readFileSync(path.join(extracted, HELPER_SCRIPT_NAME), 'utf8'), template.replace('__TABMARKER_EXTENSION_ID__', 'a'.repeat(32))));
pass('extracted batch launcher matches the bundled CRLF file', () => assert.equal(fs.readFileSync(path.join(extracted, HELPER_LAUNCHER_NAME), 'utf8'), launcher));
pass('batch launcher respects existing policy and keeps console feedback', () => { assert.ok(!/ExecutionPolicy|Unblock-File|RunAs|EncodedCommand/i.test(launcher)); assert.match(launcher, /pause/); });
const chrome = path.join(root, 'ChromeData'); fs.mkdirSync(path.join(chrome, 'Default'), { recursive: true });
const target = path.join(root, 'extension'); fs.cpSync('dist', target, { recursive: true });
const prefs = path.join(chrome, 'Default', 'Secure Preferences');
const originalPrefs = JSON.stringify({ extensions: { settings: { ['a'.repeat(32)]: { location: 4, path: target } } } }); fs.writeFileSync(prefs, originalPrefs);
const local = path.join(root, 'local'); fs.mkdirSync(local);
const sandboxKey = `Software\\TabMarker\\HelperTests\\${path.basename(root)}`;
const actualKey = 'Software\\Google\\Chrome\\NativeMessagingHosts\\';
const script = path.join(extracted, HELPER_SCRIPT_NAME);
fs.writeFileSync(script, fs.readFileSync(script, 'utf8').replace(actualKey, sandboxKey + '\\'));
function batch(folder, args = []) {
  const file = path.join(folder, HELPER_LAUNCHER_NAME);
  for (const value of [file, ...args]) assert.ok(!/["\r\n]/.test(value));
  const command = '""' + file + '" ' + args.map(value => '"' + value + '"').join(' ') + '"';
  return spawnSync(process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe', ['/d', '/s', '/c', command], {
    windowsVerbatimArguments: true, encoding: 'utf8', windowsHide: true, timeout: 30_000, cwd: root,
    env: { ...process.env, LOCALAPPDATA: local, TABMARKER_SETUP_NO_PAUSE: '1' },
  });
}
const installed = path.join(local, 'TabMarker', 'Helper');
try {
  pass('actual batch launcher installs the helper from a path with spaces and shell punctuation', () => { const result = batch(extracted, ['-ChromeUserDataRoot', chrome]); assert.equal(result.status, 0, result.stdout + result.stderr); assert.ok(fs.existsSync(path.join(installed, 'TabMarkerHelper.exe'))); assert.match(result.stdout, /Done\. Return to TabMarker/); });
  pass('batch setup writes the current helper version and cleans setup staging', () => { const config = JSON.parse(fs.readFileSync(path.join(installed, 'config.json'), 'utf8').replace(/^\uFEFF/, '')); assert.equal(config.helperVersion, version); assert.ok(!fs.readdirSync(installed).some(name => name.startsWith('setup-'))); });
  pass('batch launcher reports failed setup with a nonzero exit', () => { const result = batch(extracted, ['-ChromeUserDataRoot', chrome, '-ExtensionId', 'b'.repeat(32)]); assert.equal(result.status, 1); assert.match(result.stdout, /Setup did not finish/); });
} finally {
  const uninstaller = path.join(installed, 'Uninstall-TabMarkerHelper.ps1');
  if (fs.existsSync(uninstaller)) {
    fs.writeFileSync(uninstaller, fs.readFileSync(uninstaller, 'utf8').replace(actualKey, sandboxKey + '\\'));
    const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-File', uninstaller], { encoding: 'utf8', windowsHide: true, env: { ...process.env, LOCALAPPDATA: local } }); assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', `[Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree('${sandboxKey}', $false)`], { encoding: 'utf8', windowsHide: true }); assert.equal(result.status, 0, result.stderr);
}
const incomplete = path.join(root, 'missing-script'); fs.mkdirSync(incomplete); fs.writeFileSync(path.join(incomplete, HELPER_LAUNCHER_NAME), launcher);
pass('missing PowerShell companion gives Extract All guidance and exit 1', () => { const result = batch(incomplete); assert.equal(result.status, 1); assert.match(result.stdout, /Extract All/); });
fs.writeFileSync(path.join(incomplete, HELPER_SCRIPT_NAME), 'exit 7\r\n');
pass('batch launcher preserves the PowerShell exit code', () => assert.equal(batch(incomplete).status, 7));
pass('batch setup leaves fixture Chrome preferences unchanged', () => assert.equal(fs.readFileSync(prefs, 'utf8'), originalPrefs));
fs.writeFileSync(path.join(root, 'validation.json'), JSON.stringify({ passed: true, version, checks, browserDownloadedArchive: zipIndex >= 0 }, null, 2));
console.log(`SETUP_CHECKS_PASSED=${checks.length}`); console.log(`SETUP_TEST_ROOT=${root}`);
