import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const repo = process.cwd(), version = JSON.parse(fs.readFileSync('package.json')).version;
const root = path.resolve('work/helper-tests', randomUUID()); fs.mkdirSync(root, { recursive: true });
const home = path.join(root, 'helper'), chrome = path.join(root, 'ChromeData'), local = path.join(root, 'local-é');
fs.mkdirSync(home); fs.mkdirSync(local); fs.mkdirSync(path.join(chrome, 'Default'), { recursive: true });
for (const name of ['TabMarkerHelper.exe', 'Helper.Common.ps1', 'Invoke-TabMarkerHelper.ps1', 'Update-TabMarker.ps1']) fs.copyFileSync(path.join('work/helper-build', name), path.join(home, name));
let hostVersion = version;
const olderInstallerIndex = process.argv.indexOf('--installed-helper');
if (olderInstallerIndex >= 0) {
  const installer = fs.readFileSync(process.argv[olderInstallerIndex + 1], 'utf8');
  const match = installer.match(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/); assert.ok(match);
  const payload = JSON.parse(Buffer.from(match[1], 'base64')); hostVersion = payload.version;
  for (const name of ['TabMarkerHelper.exe', 'Helper.Common.ps1', 'Invoke-TabMarkerHelper.ps1', 'Update-TabMarker.ps1']) fs.writeFileSync(path.join(home, name), Buffer.from(payload.files[name].content, 'base64'));
}
const id = 'a'.repeat(32), otherId = 'b'.repeat(32), origin = `chrome-extension://${id}/`;
const seedVersion = process.argv.includes('--deploy-previous') ? '0.4.6' : '0.4.7';
const target = path.join(root, 'target-é'), other = path.join(root, 'other-target');
fs.cpSync('dist', target, { recursive: true }); fs.cpSync('dist', other, { recursive: true });
for (const folder of [target, other]) {
  for (const name of ['manifest.json', 'update-status.json']) { const file = path.join(folder, name); const value = JSON.parse(fs.readFileSync(file)); value.version = seedVersion; fs.writeFileSync(file, JSON.stringify(value)); }
}
const prefs = path.join(chrome, 'Default', 'Secure Preferences');
fs.writeFileSync(prefs, JSON.stringify({ extensions: { settings: { [id]: { location: 4, path: target }, [otherId]: { location: 4, path: other } } } }));
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const prefsHash = hash(prefs);
const config = { product: 'TabMarker', protocol: 1, helperVersion: hostVersion, updaterSha256: hash(path.join(home, 'Update-TabMarker.ps1')), registrations: [{ id, roots: [chrome] }] };
const writeConfig = () => fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(config)); writeConfig();
const checks = [];
function pass(name, fn) { fn(); checks.push(name); console.log(`PASS ${name}`); }
function native(request, caller = origin, raw) {
  const bytes = raw ?? Buffer.from(JSON.stringify(request)); const length = Buffer.alloc(4); length.writeInt32LE(bytes.length);
  const result = spawnSync(path.join(home, 'TabMarkerHelper.exe'), [caller], { input: Buffer.concat([length, bytes]), env: { ...process.env, LOCALAPPDATA: local }, timeout: 180_000, maxBuffer: 5_000_000, windowsHide: true });
  if (result.error) throw result.error;
  let offset = 0; const messages = [];
  while (offset < result.stdout.length) { assert.ok(offset + 4 <= result.stdout.length); const size = result.stdout.readUInt32LE(offset); offset += 4; assert.ok(size > 0 && offset + size <= result.stdout.length); messages.push(JSON.parse(result.stdout.subarray(offset, offset + size).toString('utf8'))); offset += size; }
  const final = messages.filter(m => m.kind === 'complete'); assert.equal(final.length, 1, result.stderr.toString());
  return { ...final[0].result, messages, exitCode: result.status };
}
pass('real compiled native host exchanges length-prefixed JSON status', () => { const result = native({ action: 'status' }); assert.equal(result.ok, true); assert.equal(result.protocol, 1); assert.equal(result.helperVersion, hostVersion); });
pass('native host rejects unregistered extension IDs', () => { assert.equal(native({ action: 'status' }, `chrome-extension://${otherId}/`).ok, false); });
pass('native host rejects website origins', () => { assert.equal(native({ action: 'status' }, 'https://example.com/').ok, false); });
pass('native host rejects arbitrary commands', () => { assert.equal(native({ action: 'powershell', command: 'Get-Process' }).ok, false); });
pass('native host rejects caller-selected package URLs', () => { assert.equal(native({ action: 'update', version, url: 'https://example.com/package.zip' }).ok, false); });
pass('native host rejects caller-selected file paths', () => { assert.equal(native({ action: 'update', version, path: target }).ok, false); });
pass('native host rejects malformed release versions', () => { assert.equal(native({ action: 'update', version: '1; calc' }).ok, false); });
pass('native host rejects unexpected status-version fields', () => { assert.equal(native({ action: 'status', version }).ok, false); });
pass('native host rejects oversized messages', () => { assert.equal(native(null, origin, Buffer.alloc(4097, 32)).ok, false); });
pass('native host rejects invalid UTF-8', () => { assert.equal(native(null, origin, Buffer.from([0xff, 0xff])).ok, false); });
pass('native host rejects malformed JSON', () => { assert.equal(native(null, origin, Buffer.from('not json')).ok, false); });
pass('native host rejects incompatible helper configuration', () => { config.protocol = 999; writeConfig(); assert.equal(native({ action: 'status' }).ok, false); config.protocol = 1; writeConfig(); });
const template = fs.readFileSync('dist/helper/Install-TabMarkerHelper.ps1', 'utf8');
const installer = path.join(root, 'Install-TabMarkerHelper.ps1'); fs.writeFileSync(installer, template.replace('__TABMARKER_EXTENSION_ID__', id));
function setup(file, extra = [], dry = true) { return spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-File', file, '-ChromeUserDataRoot', chrome, ...(dry ? ['-DryRun'] : []), ...extra], { encoding: 'utf8', windowsHide: true, timeout: 30_000, env: { ...process.env, LOCALAPPDATA: local } }); }
pass('bundled personalized installer validates its payload and discovers the current ID without registration', () => { const result = setup(installer); assert.equal(result.status, 0, result.stdout + result.stderr); assert.ok(result.stdout.includes('HELPER_WOULD_INSTALL=')); assert.deepEqual(fs.readdirSync(path.join(local, 'TabMarker', 'Helper')), ['logs']); });
pass('setup rejects a different, unregistered ID', () => { assert.equal(setup(installer, ['-ExtensionId', 'c'.repeat(32)]).status, 1); });
const payloadMatch = template.match(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/); assert.ok(payloadMatch);
const payload = JSON.parse(Buffer.from(payloadMatch[1], 'base64'));
payload.files['TabMarkerHelper.exe'].content = Buffer.from('corrupt executable').toString('base64');
const corrupt = path.join(root, 'corrupt-setup.ps1'); fs.writeFileSync(corrupt, template.replace('__TABMARKER_EXTENSION_ID__', id).replace(payloadMatch[1], Buffer.from(JSON.stringify(payload)).toString('base64')));
pass('setup refuses a damaged embedded payload before installing files', () => { const result = setup(corrupt); assert.equal(result.status, 1); assert.ok((result.stdout + result.stderr).includes('checksum mismatch')); });
// Exercise setup/repair/uninstall against a private registry key, never Chrome's
// actual native-host registration. All installed files stay inside this fixture.
const sandboxKey = `Software\\TabMarker\\HelperTests\\${path.basename(root)}`;
const actualKey = 'Software\\Google\\Chrome\\NativeMessagingHosts\\';
const sandboxSetup = path.join(root, 'sandbox-setup.ps1');
const sandboxSource = template.replace('__TABMARKER_EXTENSION_ID__', id).replace(actualKey, sandboxKey + '\\');
assert.notEqual(sandboxSource, template.replace('__TABMARKER_EXTENSION_ID__', id)); fs.writeFileSync(sandboxSetup, sandboxSource);
const installedHome = path.join(local, 'TabMarker', 'Helper');
try {
  pass('setup installs its necessary files and isolated registry registration', () => { const result = setup(sandboxSetup, [], false); assert.equal(result.status, 0, result.stdout + result.stderr); assert.ok(fs.existsSync(path.join(installedHome, 'TabMarkerHelper.exe'))); assert.ok(!fs.readdirSync(installedHome).some(name => name.startsWith('setup-'))); });
  pass('reinstall atomically replaces existing helper files', () => { const result = setup(sandboxSetup, [], false); assert.equal(result.status, 0, result.stdout + result.stderr); assert.equal(hash(path.join(installedHome, 'TabMarkerHelper.exe')), hash(path.join('work/helper-build', 'TabMarkerHelper.exe'))); });
  pass('setup authorizes a second validated extension ID while retaining the first', () => { const result = setup(sandboxSetup, ['-ExtensionId', otherId], false); assert.equal(result.status, 0, result.stdout + result.stderr); const manifest = JSON.parse(fs.readFileSync(path.join(installedHome, 'host.json'), 'utf8').replace(/^\uFEFF/, '')); assert.deepEqual(manifest.allowed_origins.sort(), [origin, `chrome-extension://${otherId}/`].sort()); });
} finally {
  const uninstaller = path.join(installedHome, 'Uninstall-TabMarkerHelper.ps1');
  if (fs.existsSync(uninstaller)) {
    fs.writeFileSync(uninstaller, fs.readFileSync(uninstaller, 'utf8').replace(actualKey, sandboxKey + '\\'));
    const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-File', uninstaller], { encoding: 'utf8', windowsHide: true, env: { ...process.env, LOCALAPPDATA: local } });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    pass('uninstall removes only helper registration and program files while retaining logs', () => assert.deepEqual(fs.readdirSync(installedHome), ['logs']));
  }
  const cleanup = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', `[Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree('${sandboxKey}', $false)`], { encoding: 'utf8', windowsHide: true });
  assert.equal(cleanup.status, 0, cleanup.stderr);
}
if (process.argv.includes('--network')) {
  const checked = native({ action: 'check' });
  pass('native helper fetches and verifies actual published release metadata', () => { assert.equal(checked.ok, true, checked.error); assert.match(checked.release.sha256, /^[a-f0-9]{64}$/); });
  pass('changed expected version is refused before deployment', () => { const result = native({ action: 'update', version: '0.0.1' }); assert.equal(result.ok, false); assert.match(result.error, /release changed/); });
  const originalSha = config.updaterSha256; config.updaterSha256 = '0'.repeat(64); writeConfig();
  pass('modified local updater is rejected before it runs', () => { const result = native({ action: 'update', version: checked.release.version }); assert.equal(result.ok, false); assert.match(result.error, /checksum is invalid/); });
  config.updaterSha256 = originalSha; writeConfig();
  if (process.argv.includes('--deploy') || process.argv.includes('--deploy-previous')) {
    const desired = process.argv.includes('--deploy-previous') ? checked.release.version : version;
    const installed = native({ action: 'update', version: desired });
    pass('native host installs the published compiled release into its bound installation', () => { assert.equal(installed.ok, true, JSON.stringify(installed)); assert.equal(JSON.parse(fs.readFileSync(path.join(target, 'manifest.json'))).version, desired); });
    pass('helper update leaves unrelated extension IDs unchanged', () => { assert.equal(JSON.parse(fs.readFileSync(path.join(other, 'manifest.json'))).version, seedVersion); });
    pass('native helper preserves only install.log and returns its Unicode path accurately', () => { assert.equal(installed.report.cleanup, 'Completed'); assert.ok(installed.report.logPath.includes('local-é')); assert.deepEqual(fs.readdirSync(path.dirname(installed.report.logPath)), ['install.log']); });
    pass('native helper reports pending reload with no retained successful receipt', () => { const [row] = installed.report.results; assert.equal(row.status, 'Updated'); assert.equal(row.reloadRequired, true); assert.equal(row.receipt, null); });
  }
}
pass('native/helper/setup checks leave Chrome preference bytes unchanged', () => assert.equal(hash(prefs), prefsHash));
fs.writeFileSync(path.join(root, 'validation.json'), JSON.stringify({ passed: true, checks, version, hostVersion, network: process.argv.includes('--network'), deployed: process.argv.includes('--deploy') }, null, 2));
console.log(`HELPER_CHECKS_PASSED=${checks.length}`); console.log(`HELPER_TEST_ROOT=${root}`);
