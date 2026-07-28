import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

const packageJson = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
) as { version: string };

function resolveBuildId(): string {
  if (process.env.CAELIAN_BUILD_ID) return process.env.CAELIAN_BUILD_ID;
  try {
    const sha = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], {
      encoding: 'utf8',
    }).trim();
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return `local-${packageJson.version}`;
  }
}

const buildId = resolveBuildId();

export default defineConfig({
  base: './',
  plugins: [vue()],
  define: {
    __CAELIAN_VERSION__: JSON.stringify(packageJson.version),
    __CAELIAN_BUILD_ID__: JSON.stringify(buildId),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    outDir: '.build',
    emptyOutDir: true,
    sourcemap: true,
    manifest: true,
    // Tavern Helper executes the bridge inside a sandboxed script context while
    // panels mount into the parent SillyTavern document. Lazy chunk styles would
    // otherwise be injected into the sandbox instead of the visible host page.
    // Keep JavaScript panels independently lazy-loaded, but publish one explicit
    // stylesheet that the fixed bridge can attach to the host document.
    cssCodeSplit: false,
    rollupOptions: {
      input: {
        demo: fileURLToPath(new URL('./index.html', import.meta.url)),
        alpha: fileURLToPath(
          new URL('./src/bridge/alpha-entry.ts', import.meta.url),
        ),
      },
      output: {
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/chunks/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash][extname]',
        manualChunks(id) {
          if (id.includes('node_modules/vue') || id.includes('node_modules/@vue')) {
            return 'vue';
          }
          if (id.includes('node_modules/dexie')) return 'dexie';
          if (id.includes('node_modules/pinia')) return 'pinia';
          if (id.includes('node_modules/zod')) return 'zod';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
  },
});
