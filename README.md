# Melbourne Songs

A LaTeX songbook for Melbourne church gatherings.

## Build

```bash
pdflatex melbourne-songs.tex
```

## Generate Indexes

```bash
./mksbtdx melbourne-songs    # Title/first-line index
./mksbkdx melbourne-songs    # Key index
./mksbadx melbourne-songs    # Artist index
```

Then recompile to include the indexes.

## Adding Songs

Add songs before `\end{document}` in `melbourne-songs.tex` using:

```latex
\begin{song}{Title}{}
  {\SBPubDom}
  {Author}
  {}
  {}

  \begin{SBVerse}
    Lyrics here...
  \end{SBVerse}

  \begin{SBOpGroup}
    Chorus/refrain here...
  \end{SBOpGroup}
\end{song}
```

## Structure

```
melbourne-songs.tex    # Main songbook source
melbourne-songs.pdf    # Compiled output
songbook.sty           # LaTeX style (required)
samples/               # Original Songbook 4.3 examples
contrib/               # Utilities (chord diagrams, transposition)
```

Built using the [Songbook 4.3](http://www.rath.ca/Misc/Songbook/) LaTeX package.
