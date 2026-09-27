import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { parseSongbook } from './parse.ts';

const VIRTUAL_ID = 'virtual:songbook';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

interface Options {
  /** Absolute path to the LaTeX source of truth. */
  texPath: string;
  /** Optional compiled PDF, published at /<basename> for download. */
  pdfPath?: string;
}

/**
 * `import songbook from 'virtual:songbook'` gives the app the songbook parsed
 * from the .tex at build time. In dev, editing the .tex reloads the page, and
 * a LaTeX construct the parser does not understand fails the build with a
 * file:line message instead of shipping broken lyrics.
 */
export function songbook({ texPath, pdfPath }: Options): Plugin {
  const pdfName = pdfPath ? path.basename(pdfPath) : undefined;

  return {
    name: 'songbook',

    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
    },

    load(id) {
      if (id !== RESOLVED_ID) return undefined;
      this.addWatchFile(texPath);
      const book = parseSongbook(readFileSync(texPath, 'utf8'));
      // JSON.parse of a string literal is faster for engines than an object literal.
      return `export default JSON.parse(${JSON.stringify(JSON.stringify(book))});`;
    },

    configureServer(server) {
      server.watcher.add(texPath);
      server.watcher.on('change', (file) => {
        if (path.resolve(file) !== texPath) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      });
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
