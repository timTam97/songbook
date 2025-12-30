# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LaTeX Songbook Style (v4.3) - A LaTeX2e package for creating songbooks with three output formats from a single input file:
- **chordbk**: Words and chords edition (supports `compactsong` two-column layout)
- **wordbk**: Words-only edition
- **overhead**: Overhead transparency masters

## Build Commands

### Generate songbook.sty from source
```bash
latex songbook.ins
```

### Compile a songbook (e.g., sample-sb.tex)
```bash
pdflatex sample-sb.tex
# or
latex sample-sb.tex
```

### Generate indexes
Title/first-line index:
```bash
./mksbtdx sample-sb    # produces sample-sb.tdx from sample-sb.tIdx
```

Key index:
```bash
./mksbkdx sample-sb    # produces sample-sb.kdx from sample-sb.kIdx
```

Artist index:
```bash
./mksbadx sample-sb    # produces sample-sb.adx from sample-sb.aIdx
```

All index scripts use `makeindex` with `songbook.ist` style file.

## File Structure

- `songbook.dtx` - Documented source (literate programming format combining docs + code)
- `songbook.ins` - Installer script to extract .sty from .dtx
- `songbook.sty` - Generated style file (place in LaTeX search path)
- `songbook.ist` - makeindex style file for index generation
- `sample-sb.tex` - Example songbook demonstrating all features
- `contrib/` - User-contributed utilities:
  - `modulate` - Perl script for transposing songs between keys
  - `crd2sb/` - Perl script converting Chord format to Songbook format
  - `texchord.sty` - Guitar chord diagram macros
  - `CarolBook/` - Public domain Christmas carol collection

## Package Options

Select output format in document preamble:
```latex
\usepackage[chordbk]{songbook}           % Words & chords
\usepackage[compactsong,chordbk]{songbook}  % Compact two-column
\usepackage[wordbk]{songbook}            % Words only
\usepackage[overhead]{songbook}          % Transparencies
\usepackage[printallsongs]{songbook}     % Override individual song exclusions
```

## Key Environments and Commands

- `song` environment - Main container; accepts optional `Include?` parameter to exclude songs from output
- `xlatn` environment - Song translations
- `songTranslation` environment - Translation with artist index support
- `\SBRef`, `\SBMargNote` - Reference and margin note commands

## Dependencies

- LaTeX2e with `book` document class
- `fancyhdr` package (for sample-sb.tex headers)
- `conditionals.sty` (included)
- `makeindex` (for index generation)
