/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildSongbook, type SeedFile } from '@songbook/core';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

const seedPath = fileURLToPath(new URL('../data/seed-songbook.json', import.meta.url));

/**
 * Without a DEV_PROXY_TARGET, the dev server's /songbook.json is the frozen
 * seed, published the way the publisher Lambda would publish it. The deployed
 * site's songbook.json comes from DynamoDB, never from the build.
 */
function seedSongbook(): Plugin {
  return {
    name: 'seed-songbook',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/songbook.json', (_req, res) => {
        const { book } = JSON.parse(readFileSync(seedPath, 'utf8')) as SeedFile;
        const published = buildSongbook({ title: book.title, released: book.released, updatedAt: new Date().toISOString() }, book.songs);
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(published));
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // web/.env.local (gitignored), e.g. DEV_PROXY_TARGET=https://<beta hostname>
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), '');
  const target = env.DEV_PROXY_TARGET?.trim();
  return {
    // public/ (copied to the site root as-is) holds the printed editions, melbourne-songs.pdf among them.
    plugins: [react(), tailwindcss(), ...(target ? [] : [seedSongbook()])],
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
      include: ['src/**/*.test.ts'],
    },
  };
});
