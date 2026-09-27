/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { songbook } from './parser/vite-plugin.ts';

const repoRoot = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    songbook({
      texPath: repoRoot('melbourne-songs.tex'),
      pdfPath: repoRoot('melbourne-songs.pdf'),
    }),
  ],
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
  test: {
    include: ['parser/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
