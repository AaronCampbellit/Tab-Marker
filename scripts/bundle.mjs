import { build } from 'esbuild';
await build({ entryPoints: ['src/background/index.ts'], outfile: 'dist/background.js', bundle: true, format: 'esm', target: 'chrome120', sourcemap: true });
await build({ entryPoints: ['src/content/index.ts'], outfile: 'dist/content.js', bundle: true, format: 'iife', target: 'chrome120', sourcemap: true });
