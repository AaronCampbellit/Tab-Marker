import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { rollupOptions: { input: { popup: resolve('popup.html'), options: resolve('options.html') } } },
});
