import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const build = resolve('work/helper-build');
mkdirSync(build, { recursive: true });
const compiler = process.env.TABMARKER_CSC ?? (process.platform === 'win32' ? resolve(process.env.SystemRoot ?? 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe') : null);
if (!compiler) throw new Error('Bundling the Windows helper requires Windows .NET Framework csc.exe (or TABMARKER_CSC).');
const executable = resolve(build, 'TabMarkerHelper.exe');
const result = spawnSync(compiler, ['/nologo', '/optimize+', '/target:exe', '/platform:anycpu', '/reference:System.Web.Extensions.dll', `/out:${executable}`, resolve('scripts/helper/TabMarkerHelper.cs')], { encoding: 'utf8', windowsHide: true });
if (result.status !== 0) throw new Error(`Helper compilation failed: ${result.error?.message ?? ''} ${result.stdout} ${result.stderr}`);
const paths = { 'TabMarkerHelper.exe': executable, 'Update-TabMarker.ps1': 'scripts/Update-TabMarker.ps1' };
for (const name of ['Helper.Common.ps1', 'Invoke-TabMarkerHelper.ps1', 'Uninstall-TabMarkerHelper.ps1']) paths[name] = `scripts/helper/${name}`;
const files = Object.fromEntries(Object.entries(paths).map(([name, path]) => {
  const bytes = readFileSync(path);
  return [name, { sha256: createHash('sha256').update(bytes).digest('hex'), content: bytes.toString('base64') }];
}));
const payload = Buffer.from(JSON.stringify({ version, files })).toString('base64');
const installer = readFileSync('scripts/helper/Install-TabMarkerHelper.template.ps1', 'utf8').replace('__TABMARKER_HELPER_PAYLOAD__', payload);
mkdirSync('dist/helper', { recursive: true });
writeFileSync('dist/helper/Install-TabMarkerHelper.ps1', installer);
// Payload files are also available to the isolated native-host test harness.
for (const [name, path] of Object.entries(paths)) copyFileSync(path, resolve(build, name));
writeFileSync(resolve(build, 'payload.json'), JSON.stringify({ version, files }));
console.log(`Bundled Windows helper ${version} and standalone setup script.`);
