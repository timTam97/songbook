# Fonts for the PDF

Latin Modern 2.005 (21 March 2021), the OpenType version of Computer Modern
that the LaTeX songbook was typeset in. Copied unmodified from CTAN
(`fonts/lm/fonts/opentype/public/lm/`) and released under the GUST Font
License (`GUST-FONT-LICENSE.txt`). The PDF embeds subsets of them.

| File | Used for |
| --- | --- |
| `lmroman12-regular.otf` | Lyrics, index, page headers |
| `lmroman12-italic.otf`, `lmroman12-bold.otf`, `lmroman10-bolditalic.otf` | Italic, bold and bold italic lyrics; the index heading |
| `lmroman17-regular.otf` | The title page |
| `lmroman8-regular.otf` | Authors, page footers |
| `lmsans12-regular.otf` | Song titles |
| `lmsans8-regular.otf` | Copyright lines, chords |

The PDF Lambda reads them from `fonts/` next to its bundle (see
`backendFunction`'s `copyFiles` in `infra/lib/song-data.ts`).
