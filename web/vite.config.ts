/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { songbook } from './parser/vite-plugin.ts';

const repoRoot = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));

export default defineConfig(({ mode }) => {
  // web/.env.local (gitignored), e.g. DEV_PROXY_TARGET=https://<beta hostname>
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), '');
  const target = env.DEV_PROXY_TARGET?.trim();
  return {
    plugins: [
      react(),
      tailwindcss(),
      songbook({
        texPath: repoRoot('melbourne-songs.tex'),
        pdfPath: repoRoot('melbourne-songs.pdf'),
        proxied: Boolean(target),
      }),
    ],
    server: {
      host: '127.0.0.1',
      // With a target, dev reads a deployed stage's published book instead of the local .tex.
      ...(target ? { proxy: { '/songbook.json': { target, changeOrigin: true, secure: true } } } : {}),
    },
    preview: { host: '127.0.0.1' },
    test: {
      include: ['parser/**/*.test.ts', 'src/**/*.test.ts'],
    },
  };
});
