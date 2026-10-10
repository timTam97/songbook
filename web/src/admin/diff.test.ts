import { describe, expect, it } from 'vitest';
import { diffLines } from './diff.ts';

const render = (before: string[], after: string[]) =>
  diffLines(before, after).map((d) => `${d.kind === 'same' ? ' ' : d.kind === 'added' ? '+' : '-'}${d.text}`);

describe('diffLines', () => {
  it('marks nothing for identical text', () => {
    expect(render(['a', 'b'], ['a', 'b'])).toEqual([' a', ' b']);
  });

  it('shows a changed line as a removal then an addition', () => {
    expect(render(['a', 'b', 'c'], ['a', 'B', 'c'])).toEqual([' a', '-b', '+B', ' c']);
  });

  it('handles insertions and deletions at either end', () => {
    expect(render(['b', 'c'], ['a', 'b', 'c', 'd'])).toEqual(['+a', ' b', ' c', '+d']);
    expect(render(['a', 'b', 'c'], ['b'])).toEqual(['-a', ' b', '-c']);
    expect(render([], ['x'])).toEqual(['+x']);
    expect(render(['x'], [])).toEqual(['-x']);
  });

  it('keeps the longest run of unchanged lines', () => {
    const before = ['{chorus}', 'one', 'two', 'three', '', 'verse'];
    const after = ['verse', '', '{chorus}', 'one', 'two', 'three'];
    expect(diffLines(before, after).filter((d) => d.kind === 'same').map((d) => d.text)).toEqual(['{chorus}', 'one', 'two', 'three']);
  });
});
