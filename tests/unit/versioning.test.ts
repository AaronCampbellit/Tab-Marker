import { afterEach, describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const scratch = path.resolve('work/versioning-tests');
const fixtures: string[] = [];
function fixture(version = '1.0.0') {
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(path.join(scratch, 'case-'));
  fixtures.push(root);
  for (const folder of ['scripts', 'public', 'src']) mkdirSync(path.join(root, folder));
  copyFileSync('scripts/sync-version.mjs', path.join(root, 'scripts/sync-version.mjs'));
  json(root, 'package.json', { version });
  json(root, 'package-lock.json', { version, packages: { '': { version } } });
  json(root, 'public/manifest.json', { version });
  json(root, 'public/update-status.json', { version });
  writeFileSync(path.join(root, 'src/index.ts'), 'export const label = "original";\n');
  return root;
}
function json(root: string, file: string, value: unknown) { writeFileSync(path.join(root, file), JSON.stringify(value)); }
function run(root: string, ...args: string[]) { return spawnSync(process.execPath, [path.join(root, 'scripts/sync-version.mjs'), ...args], { encoding: 'utf8', cwd: root, windowsHide: true }); }
function released(root: string) {
  for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.name=Version Test', '-c', 'user.email=version-test@example.invalid', 'commit', '-qm', 'fixture release'], ['tag', 'v1.0.0']]) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error(result.stderr);
  }
}
afterEach(() => {
  for (const root of fixtures.splice(0)) {
    if (!path.resolve(root).startsWith(scratch + path.sep)) throw new Error('Refusing cleanup outside test scratch directory');
    rmSync(root, { recursive: true, force: true });
  }
});

describe('project version workflow', () => {
  it('synchronizes manifest, marker and both lockfile versions from package.json', () => {
    const root = fixture(); json(root, 'package.json', { version: '1.2.3' });
    expect(run(root).status).toBe(0);
    for (const file of ['public/manifest.json', 'public/update-status.json', 'package-lock.json']) {
      expect(JSON.parse(readFileSync(path.join(root, file), 'utf8')).version).toBe('1.2.3');
    }
    expect(JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8')).packages[''].version).toBe('1.2.3');
  });
  it('check mode reports drift without writing files', () => {
    const root = fixture(); json(root, 'public/manifest.json', { version: '0.9.0' });
    const before = readFileSync(path.join(root, 'public/manifest.json'), 'utf8');
    expect(run(root, '--check').status).not.toBe(0);
    expect(readFileSync(path.join(root, 'public/manifest.json'), 'utf8')).toBe(before);
  });
  it('allows reproducing a released version and requires a bump for tracked extension changes', () => {
    const root = fixture(); released(root);
    expect(run(root, '--check').status).toBe(0);
    writeFileSync(path.join(root, 'src/index.ts'), 'export const label = "changed";\n');
    const blocked = run(root);
    expect(blocked.status).not.toBe(0);
    expect(blocked.stderr).toContain('npm version patch --no-git-tag-version');
    json(root, 'package.json', { version: '1.0.1' });
    expect(run(root).status).toBe(0);
  });
  it('also requires a bump for newly added extension files', () => {
    const root = fixture(); released(root);
    writeFileSync(path.join(root, 'src/new.ts'), 'export const added = true;\n');
    expect(run(root, '--check').status).not.toBe(0);
  });
  it.each(['0.0.0', '1.2.65536', '01.2.3', '1.2.3-beta.1'])('rejects an incompatible Chrome version: %s', version => {
    expect(run(fixture(version)).status).not.toBe(0);
  });
});
