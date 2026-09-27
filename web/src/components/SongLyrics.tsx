import type { Line, Section, Segment } from '../lib/songbook.ts';

function Seg({ seg }: { seg: Segment }) {
  const cls = [seg.italic && 'italic', seg.bold && 'font-semibold'].filter(Boolean).join(' ') || undefined;
  return <span className={cls}>{seg.text}</span>;
}

/** Chords sit above the syllable they start on. Only used for lines that carry chords. */
function ChordedLine({ line }: { line: Line }) {
  return (
    <>
      {line.map((seg, k) => (
        <span key={k} className="inline-flex flex-col align-bottom whitespace-pre">
          <span className="font-sans text-[0.75em] leading-tight font-semibold text-amber-700 dark:text-amber-400" aria-hidden={!seg.chord}>
            {seg.chord ?? '\u00A0'}
          </span>
          <Seg seg={seg} />
        </span>
      ))}
    </>
  );
}

function LyricLine({ line }: { line: Line }) {
  const chorded = line.some((seg) => seg.chord !== undefined);
  // Hanging indent: a wrapped line's continuation is indented, so it reads as one line on a phone.
  return (
    <p className="pl-[1.25em] -indent-[1.25em]">
      {chorded ? <ChordedLine line={line} /> : line.map((seg, k) => <Seg key={k} seg={seg} />)}
    </p>
  );
}

export function SongLyrics({ sections }: { sections: Section[] }) {
  return (
    <div className="lyrics space-y-[1.1em] font-serif">
      {sections.map((section, k) => {
        // Choruses stand on their own: same column as verse text, just without a number.
        const name =
          section.kind === 'chorus'
            ? 'Chorus'
            : section.label
              ? `${section.kind === 'verse' ? 'Verse' : 'Part'} ${section.label}`
              : undefined;
        const marker =
          section.kind === 'chorus' || !section.label ? '' : section.kind === 'section' ? `${section.label})` : `${section.label}.`;
        return (
          <section key={k} aria-label={name} className="grid grid-cols-[2.25em_1fr]">
            <span aria-hidden="true" className="pt-[0.2em] font-sans text-[0.8em] font-semibold text-stone-400 tabular-nums dark:text-stone-500">
              {marker}
            </span>
            <div>
              {section.lines.map((line, j) => (
                <LyricLine key={j} line={line} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
