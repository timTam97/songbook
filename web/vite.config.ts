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
      // With a target, dev reads a deployed stage's published book and talks to its admin API.
      // Sign-in works from http://localhost:5173 (beta allows it as a callback), not 127.0.0.1.
      ...(target
        ? {
            proxy: Object.fromEntries(
              ['/songbook.json', '/admin-config.json', '/api'].map((path) => [path, { target, changeOrigin: true, secure: true }]),
            ),
          }
        : {}),
    },
    preview: { host: '127.0.0.1' },
    test: {
      include: ['parser/**/*.test.ts', 'src/**/*.test.ts'],
    },
  };
});
