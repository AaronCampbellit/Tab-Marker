import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const read = file => JSON.parse(readFileSync(resolve(root, file), 'utf8'));
const pkg = read('package.json');
if (typeof pkg.version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(pkg.version)
  || pkg.version.split('.').some(part => Number(part) > 65535) || pkg.version === '0.0.0') {
  throw new Error('package.json must contain a Chrome-compatible major.minor.patch version (1–65535 per nonzero component).');
}

// A release tag records which code shipped with a version. Rebuilding that tag
// remains valid; changing shipped extension/build code requires a new version.
const git = (...args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true });
const top = git('rev-parse', '--show-toplevel');
if (top.status === 0 && resolve(top.stdout.trim()).toLowerCase() === root.toLowerCase()) {
  const tag = `v${pkg.version}`;
  if (git('rev-parse', '--verify', '--quiet', `refs/tags/${tag}`).status === 0) {
    const paths = ['src', 'public', 'scripts', 'popup.html', 'options.html', 'vite.config.ts', 'package.json', 'package-lock.json'];
    const diff = git('diff', '--quiet', tag, '--', ...paths);
    const untracked = git('ls-files', '--others', '--exclude-standard', '--', ...paths);
    if (diff.status !== 0 || untracked.status !== 0 || untracked.stdout.trim()) {
      throw new Error(`Extension/build files changed since ${tag}. Run npm version patch --no-git-tag-version before building or packaging.`);
    }
  }
}

const manifest = read('public/manifest.json');
const marker = read('public/update-status.json');
const lock = read('package-lock.json');
if (!lock.packages?.['']) throw new Error('package-lock.json is missing its root package entry.');
const aligned = manifest.version === pkg.version && marker.version === pkg.version
  && lock.version === pkg.version && lock.packages[''].version === pkg.version;
if (checkOnly && !aligned) throw new Error('Version metadata differs from package.json. Run npm run version:sync.');
if (!checkOnly && !aligned) {
  manifest.version = marker.version = lock.version = lock.packages[''].version = pkg.version;
  for (const [file, value] of [['public/manifest.json', manifest], ['public/update-status.json', marker], ['package-lock.json', lock]]) {
    writeFileSync(resolve(root, file), JSON.stringify(value, null, 2) + '\n');
  }
}
console.log(`TabMarker ${pkg.version}: version metadata ${checkOnly ? 'verified' : 'synchronized'}.`);
