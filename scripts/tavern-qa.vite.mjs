import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  publicDir: false,
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  build: {
    target: 'es2022', outDir: '.tavern-qa', emptyOutDir: true,
    lib: {entry:'scripts/tavern-qa.ts',formats:['es'],fileName:()=> 'qa.js'},
  },
});
