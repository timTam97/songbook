import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { buildSongbook } from '@songbook/core';
import type { Plugin } from 'vite';
import { parseSongbook } from './parse.ts';

interface Options {
  /** Absolute path to the LaTeX source, for the dev server's /songbook.json. */
  texPath: string;
  /** Optional compiled PDF, published at /<basename> for download. */
  pdfPath?: string;
  /** Leave /songbook.json to the dev server's proxy (DEV_PROXY_TARGET) instead of serving the .tex. */
  proxied?: boolean;
}

/**
 * Dev and build support while melbourne-songs.tex still exists:
 *  - in dev, /songbook.json is the .tex parsed and published the way the
 *    publisher Lambda would (unless it is proxied to a deployed stage), and
 *    editing the .tex reloads the page. A LaTeX construct the parser does not
 *    understand shows a file:line error instead of the book;
 *  - the PDF is served in dev and copied into the build.
 * The deployed site's songbook.json comes from DynamoDB, never from the build.
 */
export function songbook({ texPath, pdfPath, proxied = false }: Options): Plugin {
  const pdfName = pdfPath ? path.basename(pdfPath) : undefined;

  return {
    name: 'songbook',

    configureServer(server) {
      server.watcher.add(texPath);
      server.watcher.on('change', (file) => {
        if (path.resolve(file) === texPath) server.ws.send({ type: 'full-reload' });
      });
      if (!proxied) {
        server.middlewares.use('/songbook.json', (_req, res) => {
          try {
            const parsed = parseSongbook(readFileSync(texPath, 'utf8'));
            const book = buildSongbook({ title: parsed.title, released: parsed.released, updatedAt: new Date().toISOString() }, parsed.songs);
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-store');
            res.end(JSON.stringify(book));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.end(err instanceof Error ? err.message : String(err));
          }
        });
      }
      if (pdfPath && pdfName) {
        server.middlewares.use(`/${pdfName}`, (_req, res) => {
          res.setHeader('Content-Type', 'application/pdf');
          res.end(readFileSync(pdfPath));
        });
      }
    },

    generateBundle() {
      if (pdfPath && pdfName && existsSync(pdfPath)) {
        this.emitFile({ type: 'asset', fileName: pdfName, source: readFileSync(pdfPath) });
      }
    },
  };
}
